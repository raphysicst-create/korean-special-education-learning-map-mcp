import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../src/data-store.mjs';
import { ABOUT_URI, createServer, TOOL_NAMES } from '../src/server.mjs';
import {
  canonicalCode, resolveGradeBand, normalizeCode, parseBasicCode,
} from '../src/normalize.mjs';
import { buildFixtureDataDir } from './fixtures/build-fixture.mjs';

const dataDir = buildFixtureDataDir();

async function connect() {
  const server = createServer(createStore(dataDir));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.1' });
  await client.connect(clientTransport);
  return client;
}

const call = async (client, name, args = {}) => client.callTool({ name, arguments: args });
const payload = (r) => JSON.parse(r.content[0].text);

test('normalize: 코드·학년군 해석', () => {
  assert.equal(normalizeCode(' 9 진 01–02 '), '[9진01-02]');
  assert.deepEqual(
    { ...parseBasicCode('[12국01-03]') },
    { gradeBandCode: '12', gradeBand: 'h1-3', gradeBandKorean: '고등학교 1~3학년군', prefix: '국', domainNo: '01', itemNo: '03' }
  );
  for (const [input, id] of [['초3~4', 'e3-4'], ['초등학교 3~4학년군', 'e3-4'], ['3-4', 'e3-4'],
    ['9', 'm1-3'], ['중학교', 'm1-3'], ['고1~3', 'h1-3'], ['e1-2', 'e1-2']]) {
    assert.equal(resolveGradeBand(input), id, input);
  }
  assert.equal(resolveGradeBand('대학'), null);
  assert.equal(parseBasicCode('[09수학04-01]').gradeBand, 'm1-3');
  assert.equal(canonicalCode('09 수학 04-01'), '[9수학04-01]');
  assert.equal(canonicalCode('[12국01-03]'), '[12국01-03]');
});

test('store: manifest 해시가 어긋나면 로드를 거부한다', () => {
  const dir = buildFixtureDataDir();
  writeFileSync(join(dir, 'subjects.json'), '{"subjects":[]}\n');
  assert.throws(() => createStore(dir), /체크섬 불일치/);
});

test('도구 목록과 about 리소스', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOL_NAMES);
  const { contents } = await client.readResource({ uri: ABOUT_URI });
  assert.ok(contents[0].text.includes('제7조 제2호'));
  assert.ok(contents[0].text.includes('일상생활 활동'));
});

test('list_subjects', async () => {
  const p = payload(await call(await connect(), 'list_subjects'));
  assert.deepEqual(p.subjects.map((s) => s.id), ['career-vocation', 'korean']);
  assert.deepEqual(p.subjects.find((s) => s.id === 'korean').gradeBands, ['e3-4']);
});

test('get_grade_band_overview: 무인자는 학년군 목록, 인자는 과목별 영역', async () => {
  const client = await connect();
  const all = payload(await call(client, 'get_grade_band_overview'));
  assert.equal(all.gradeBands.length, 5);
  assert.equal(all.gradeBands.find((b) => b.id === 'm1-3').standardCount, 3);
  const mid = payload(await call(client, 'get_grade_band_overview', { gradeBand: '중학교' }));
  assert.deepEqual(mid.subjects, [{
    subjectId: 'career-vocation', subjectKorean: '진로와 직업', standardCount: 3, domains: ['자기 탐색', '직업 세계'],
  }]);
  const bad = await call(client, 'get_grade_band_overview', { gradeBand: '대학' });
  assert.ok(bad.isError);
});

test('search_standards: 원문 키워드·코드·필터', async () => {
  const client = await connect();
  const byText = payload(await call(client, 'search_standards', { query: '몸짓' }));
  assert.equal(byText.results[0].code, '[4국01-02]');
  assert.ok(byText.results[0].text.includes('몸짓'));
  const byCode = payload(await call(client, 'search_standards', { query: '9진 01-02' }));
  assert.equal(byCode.results[0].code, '[9진01-02]');
  const filtered = payload(await call(client, 'search_standards', { subject: '진로와직업', domain: '직업' }));
  assert.deepEqual(filtered.results.map((r) => r.code), ['[9진02-01]']);
  const none = payload(await call(client, 'search_standards', { query: '우주선' }));
  assert.equal(none.total, 0);
  assert.ok(none.hint);
  const badSubject = await call(client, 'search_standards', { subject: '국오' });
  assert.ok(badSubject.isError);
  assert.ok(badSubject.content[0].text.includes('국어'));
});

test('get_standard: 원문·코드 구조·없는 코드 제안', async () => {
  const client = await connect();
  const p = payload(await call(client, 'get_standard', { code: '4국 01-01' }));
  assert.equal(p.results[0].officialText, '일상생활에서 자주 듣는 말소리에 주의를 기울이며 듣는다.');
  assert.equal(p.results[0].codeStructure.gradeBand, 'e3-4');
  const miss = await call(client, 'get_standard', { code: '[4국01-09]' });
  assert.ok(miss.isError);
  assert.ok(miss.content[0].text.includes('[4국01-01]'));
});

test('get_operation_guidelines: 편성·운영 데이터가 없는 설치본은 오류로 알린다', async () => {
  const r = await call(await connect(), 'get_operation_guidelines', {});
  assert.ok(r.isError);
  assert.ok(r.content[0].text.includes('편성·운영'));
});

test('get_learning_roadmap: 학년군 → 영역 → 성취기준', async () => {
  const client = await connect();
  const p = payload(await call(client, 'get_learning_roadmap', { subject: '국어' }));
  assert.equal(p.standardCount, 3);
  assert.deepEqual(p.gradeBands[0].domains.map((d) => [d.domainKorean, d.standards.length]),
    [['듣기·말하기', 2], ['읽기', 1]]);
  const empty = payload(await call(client, 'get_learning_roadmap', { subject: '국어', gradeBand: '고1~3' }));
  assert.equal(empty.standardCount, 0);
  assert.ok(empty.hint.includes('e3-4'));
});
