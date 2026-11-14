// 출시 데이터(data/kr) 자체에 대한 회귀 테스트. 수량은 pipeline/gates.json과,
// 원문 표본은 국가교육위원회 고시 제2026-2호 반영본 【별책 3】 PDF와 대조한 값이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../src/data-store.mjs';
import { createServer } from '../src/server.mjs';

const gates = JSON.parse(readFileSync(new URL('../pipeline/gates.json', import.meta.url), 'utf8'));
const store = createStore();

async function connect() {
  const server = createServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'data-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}
const call = async (client, name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

test('data: 과목·성취기준 수가 gates.json과 같다', () => {
  const basic = gates.categories.basic;
  const current = store.allStandards.filter((s) => !s.edition);
  assert.equal(current.length, basic.standards);
  assert.equal(store.allStandards.length - current.length, Object.values(basic.previousEdition ?? {}).reduce((n, v) => n + v, 0));
  assert.equal(store.subjects.length, basic.subjects);
  for (const s of store.subjects) assert.equal(s.standardCount, basic.bySubject[s.id], s.id);
  assert.equal(store.manifest.counts.standards, basic.standards);
});

test('data: 모든 성취기준에 원문·영역·학년군이 있고 원문은 마침표로 끝난다', () => {
  for (const s of store.allStandards) {
    const text = store.textsByKey.get(s.key);
    assert.ok(text && /[다요]\.$/.test(text), s.key);
    assert.ok(s.domainKorean, s.key);
    assert.ok(s.gradeBand, s.key);
  }
});

test('data: 원문 표본이 고시 PDF와 같다', async () => {
  const client = await connect();
  const cases = [
    ['[2건생01-01]', '몸의 움직임을 자유롭게 경험한다.', 'e1-2'],
    ['[12진로06-01]', '자신이 선택한 지역사회 전환 기관의 이용 정보를 다양한 방법으로 조사한다.', 'h1-3'],
    ['[4과학01-04]', '소리가 나는 물체는 떨림이 있음을 알고, 생활 주변의 소리를 듣고 큰 소리와 작은 소리, 높은 소리와 낮은 소리로 구분한다.', 'e3-4'],
    ['[9사회02-03]', '주변 사람들의 사회적 상호 작용 모습을 조사하고 사회적 관계를 형성하려는 마음을 가진다.', 'm1-3'],
    ['[09생영02-02]', '알파벳 대문자·소문자를 구별하여 읽고 활용한다.', 'm1-3'],
  ];
  for (const [code, text, band] of cases) {
    const r = (await call(client, 'get_standard', { code })).results[0];
    assert.equal(r.officialText, text, code);
    assert.equal(r.gradeBand, band, code);
  }
});

test('data: 09 코드는 9로도 찾고, 2026-2호 개정 과목에는 시행 시기 안내가 붙는다', async () => {
  const client = await connect();
  const math = await call(client, 'get_standard', { code: '9수학04-01' });
  assert.equal(math.results[0].code, '[09수학04-01]');
  assert.equal(math.results[0].domainKorean, '규칙성');
  const subjects = (await call(client, 'list_subjects')).subjects;
  assert.ok(subjects.find((s) => s.id === 'healthy-living').note.includes('2028년 3월 1일'));
  assert.ok(subjects.find((s) => s.id === 'joyful-living').note.includes('제2024-4호'));
  const joyful = await call(client, 'get_learning_roadmap', { subject: '즐거운 생활' });
  assert.equal(joyful.standardCount, 6);
  assert.ok(joyful.note);
});

test('data: 09 코드는 검색(완전·부분 일치)과 없는 코드 제안에서도 9와 같게 다룬다', async () => {
  const client = await connect();
  const exact = await call(client, 'search_standards', { query: '[9생영01-01]' });
  assert.equal(exact.results[0].code, '[09생영01-01]');
  const partial = await call(client, 'search_standards', { query: '[9수학04' });
  assert.deepEqual(partial.results.map((r) => r.code), ['[09수학04-01]', '[09수학04-02]', '[09수학04-03]']);
  const zero = await call(client, 'search_standards', { query: '09생영01' });
  assert.ok(zero.total > 0 && zero.results.every((r) => r.code.startsWith('[09생영01')));
  const miss = await client.callTool({ name: 'get_standard', arguments: { code: '9수학04-09' } });
  assert.ok(miss.isError);
  assert.ok(miss.content[0].text.includes('[09수학04-0'), miss.content[0].text);
});

test('data: get_operation_guidelines — 학교급 목록·학년군 초점·부분 조회', async () => {
  const client = await connect();
  const overview = await call(client, 'get_operation_guidelines');
  assert.deepEqual(overview.schoolLevels.map((l) => [l.id, l.allotment.tableNo, l.allotment.unit]),
    [['elementary', '<표 9>', '시간'], ['middle', '<표 10>', '시간'], ['high', '<표 11>', '학점']]);
  assert.equal(overview.schoolLevels[2].allotment.total.values['1~3학년'], '192');

  const e34 = await call(client, 'get_operation_guidelines', { schoolLevel: '초3~4' });
  assert.equal(e34.schoolLevel, '초등학교');
  assert.deepEqual(e34.focus, { gradeBand: 'e3-4', column: '3~4학년' });
  assert.equal(e34.allotment.rows.find((r) => r.label === '국어').values['3~4학년'], '340');
  assert.equal(e34.criteria.items.length, 12);
  assert.ok(e34.note.includes('2028년 3월 1일'));

  const midCriteria = await call(client, 'get_operation_guidelines', { schoolLevel: '중학교', part: '운영 기준' });
  assert.ok(midCriteria.criteria && !midCriteria.allotment && !midCriteria.organization);
  assert.ok(midCriteria.criteria.items[8].text.includes('자유학기'));

  const bad = await client.callTool({ name: 'get_operation_guidelines', arguments: { schoolLevel: '대학교' } });
  assert.ok(bad.isError);
});

test('data: get_grade_band_overview가 그 학년군의 배당 기준을 함께 준다', async () => {
  const client = await connect();
  const e12 = await call(client, 'get_grade_band_overview', { gradeBand: '초1~2' });
  assert.equal(e12.allotment.column, '1~2학년');
  assert.deepEqual(e12.allotment.groups.find((g) => g.label === '건강한 생활'), { label: '건강한 생활', value: '120' });
  assert.ok(e12.allotment.note.includes('2028년 3월 1일'));
  const h = await call(client, 'get_grade_band_overview', { gradeBand: '고1~3' });
  assert.equal(h.allotment.unit, '학점');
  assert.deepEqual(h.allotment.totals.at(-1), { label: '총 이수 학점', value: '192' });
});

test('data: 즐거운 생활은 최신 판(2026-2)과 시행 중인 이전 판(2024-4)을 구분해 함께 준다', async () => {
  const client = await connect();
  const both = (await call(client, 'get_standard', { code: '2즐생01-06' })).results;
  assert.deepEqual(both.map((r) => [r.edition ?? 'current', r.officialText]), [
    ['current', '다양한 예술 활동을 즐긴다.'],
    ['2024-4', '신체활동을 적극적으로 즐긴다.'],
  ]);
  assert.ok(both[1].editionNote.includes('2028년 3월 1일 전까지'));
  const onlyOld = (await call(client, 'get_standard', { code: '[2즐생01-09]' })).results;
  assert.deepEqual(onlyOld.map((r) => [r.edition, r.officialText]), [['2024-4', '다양한 놀이에 재미있게 참여한다.']]);

  const joyful = (await call(client, 'list_subjects')).subjects.find((s) => s.id === 'joyful-living');
  assert.equal(joyful.standardCount, 6);
  assert.equal(joyful.previousEdition.edition, '2024-4');
  assert.equal(joyful.previousEdition.standardCount, 9);

  const roadmap = await call(client, 'get_learning_roadmap', { subject: '즐거운 생활' });
  assert.equal(roadmap.standardCount, 6);
  assert.equal(roadmap.previousEdition.standardCount, 9);
  assert.equal(roadmap.previousEdition.gradeBands[0].domains[0].standards[8].code, '[2즐생01-09]');
  // 다른 과목 로드맵에는 previousEdition이 없다.
  assert.equal((await call(client, 'get_learning_roadmap', { subject: '바른 생활' })).previousEdition, undefined);

  const hit = await call(client, 'search_standards', { query: '신체활동을 적극적으로' });
  assert.deepEqual(hit.results.map((r) => [r.code, r.edition]), [['[2즐생01-06]', '2024-4']]);
  const e12 = await call(client, 'get_grade_band_overview', { gradeBand: 'e1-2' });
  assert.equal(e12.subjects.find((s) => s.subjectId === 'joyful-living').standardCount, 6);
});
