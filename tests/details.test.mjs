import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanText, compareEditions, crossCheckDetails, parseCodes, parseContentSystem, parseStandardNotes, pdfForm,
} from '../pipeline/extract-details.mjs';
import { verifyDetails } from '../pipeline/verify.mjs';
import {
  BOX_TEXTS, HEALTHY_LIVING_CONTENT_SYSTEM, HEALTHY_LIVING_NOTES, JOYFUL_2024_CONTENT_SYSTEM, MATH_CONTENT_SYSTEM,
  MATH_MONEY_NOTES, PE_NOTES, SOCIAL_RELATION_CONTENT_SYSTEM,
} from './fixtures/details-blocks.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const exceptions = JSON.parse(readFileSync(new URL('../pipeline/details-exceptions.json', import.meta.url), 'utf8'));
const ALL_BANDS = ['e1-2', 'e3-4', 'e5-6', 'm1-3', 'h1-3'];
const boxText = (code) => BOX_TEXTS[code];

test('cleanText: HWP 전용 글자를 지면대로 바꾸고, PDF 대조형에서는 지우며, 모르는 글자는 실패한다', () => {
  assert.equal(cleanText('\u{f0810}, ―, /'), '|, ―, /');
  assert.equal(cleanText('포장\uf09e조립'), '포장·조립');
  assert.equal(cleanText('\u{f02b1} 수의 기초'), '① 수의 기초');
  assert.equal(pdfForm(cleanText('\u{f0810}, ―, /')), ', ―, /');
  assert.equal(cleanText('\u{f0810}, ―', { forPdf: true }), ', ―');
  assert.equal(cleanText('지식⋅이해 ･ 과정∙기능'), '지식·이해 · 과정·기능');
  assert.throws(() => cleanText('알 수 없는 \ue000'), /모르는 HWP 전용 글자 U\+E000/);
});

test('내용 체계(행 배치, 실측 수학): 하위 영역 행, 학년군 병합 칸, 빈 칸 생략', () => {
  const cs = parseContentSystem(MATH_CONTENT_SYSTEM, 0, MATH_CONTENT_SYSTEM.length, { where: '수학', bands: ALL_BANDS });
  assert.equal(cs.domains.length, 1);
  const [d] = cs.domains;
  assert.equal(d.domainNo, '01');
  assert.equal(d.domainKorean, '수와 연산');
  assert.deepEqual(d.columns.map((c) => c.gradeBand), ALL_BANDS);
  assert.equal(d.columns[0].label, '초등학교 1~2학년');
  assert.equal(d.coreIdeas.length, 4);
  const basics = d.rows.find((r) => r.subArea === '수의 기초');
  assert.equal(basics.category, '지식·이해');
  // '수의 기초'는 초1~2 칸에만 내용이 있다 — 빈 칸은 싣지 않는다.
  assert.deepEqual(basics.cells, [{ gradeBands: ['e1-2'], items: ['찾기', '변별하기', '비교하기', '짝짓기', '순서짓기'] }]);
  const skills = d.rows.find((r) => r.category === '과정·기능');
  assert.deepEqual(skills.cells.map((c) => c.gradeBands), [['e1-2', 'e3-4', 'e5-6'], ['m1-3', 'h1-3']]);
});

test('내용 체계: 세로쓰기 머리 칸은 예외표의 띄어쓰기 표기를 쓰고, 예외표에 없으면 실패한다', () => {
  const ctx = { where: '사회', bands: ['e3-4', 'e5-6', 'm1-3', 'h1-3'], verticalLabels: exceptions.verticalLabels, usedVerticalLabels: new Set() };
  const cs = parseContentSystem(SOCIAL_RELATION_CONTENT_SYSTEM, 0, SOCIAL_RELATION_CONTENT_SYSTEM.length, ctx);
  assert.equal(cs.domains[0].domainNo, '02');
  assert.deepEqual([...new Set(cs.domains[0].rows.map((r) => r.subArea))], ['도덕적 인성', '사회성']);
  assert.ok(ctx.usedVerticalLabels.has('도덕적인성'));
  assert.throws(() => parseContentSystem(SOCIAL_RELATION_CONTENT_SYSTEM, 0, SOCIAL_RELATION_CONTENT_SYSTEM.length, { ...ctx, verticalLabels: {} }),
    /세로쓰기 머리 칸 '도덕적인성'/);
});

test('내용 체계: 2026 통합교과 열 배치 표와 2024 세 과목 나란히 표(과목 열만)', () => {
  const single = { domainNo: '01', domainKorean: '통합교과 4개 영역 중첩' };
  const hl = parseContentSystem(HEALTHY_LIVING_CONTENT_SYSTEM, 0, HEALTHY_LIVING_CONTENT_SYSTEM.length, { where: '건강한 생활', bands: ['e1-2'], singleDomain: single });
  assert.equal(hl.intro.length, 1);
  const [d] = hl.domains;
  assert.deepEqual(d.rows.map((r) => r.category), ['지식·이해', '과정·기능', '가치·태도']);
  assert.deepEqual(d.standardCodes, ['[2건생01-01]', '[2건생01-02]', '[2건생01-03]', '[2건생01-04]', '[2건생01-05]', '[2건생01-06]']);
  const joy = parseContentSystem(JOYFUL_2024_CONTENT_SYSTEM, 0, JOYFUL_2024_CONTENT_SYSTEM.length, { where: '즐거운 생활(2024-4)', bands: ['e1-2'], singleDomain: single, columnSubject: '즐거운 생활' });
  const know = joy.domains[0].rows.find((r) => r.category === '지식·이해');
  assert.deepEqual(know.cells[0].items.slice(0, 3), ['신체감각', '주변의 아름다움', '관심과 선호']);
  assert.throws(() => parseContentSystem(JOYFUL_2024_CONTENT_SYSTEM, 0, JOYFUL_2024_CONTENT_SYSTEM.length, { where: 'x', bands: ['e1-2'], singleDomain: single, columnSubject: '건강한 생활' }),
    /과목 열 '건강한 생활'을\(를\) 찾지 못했습니다/);
});

test('해설(실측 체육): 영역 안내 → 하위 영역 묶음, 코드 없는 고려 사항은 묶음 전체', () => {
  const notes = parseStandardNotes(PE_NOTES, 0, PE_NOTES.length, { where: '체육', bands: ['e3-4', 'e5-6', 'm1-3', 'h1-3'], boxText });
  assert.equal(notes.sections.length, 1);
  const [sec] = notes.sections;
  assert.equal(sec.gradeBand, 'e3-4');
  assert.equal(sec.domainKorean, '운동');
  assert.equal(sec.intro.length, 1);
  const [g] = sec.groups;
  assert.deepEqual(g.subArea, { no: '1', name: '체력 운동' });
  assert.deepEqual(g.codes, ['[4체육01-01]']);
  assert.ok(g.explanations.every((e) => e.codes.join() === '[4체육01-01]'));
  assert.ok(g.considerations.some((e) => e.codes.length === 0), '코드 없는 고려 사항');
});

test('해설(실측 수학 화폐): 첫머리 코드 오기는 예외표로만 풀리고, 쓰인 항목을 기록한다', () => {
  const ctx = { where: '수학', bands: ALL_BANDS, boxText, codeLeads: exceptions.codeLeads, usedCodeLeads: new Set() };
  const notes = parseStandardNotes(MATH_MONEY_NOTES, 0, MATH_MONEY_NOTES.length, ctx);
  const g = notes.sections[0].groups[0];
  assert.equal(g.subArea.name, '화폐');
  const typo = g.explanations.find((e) => e.text.startsWith('[6수학01-11], [수학01-12]'));
  assert.deepEqual(typo.codes, ['[6수학01-11]', '[6수학01-12]']);
  assert.ok(ctx.usedCodeLeads.has('[6수학01-11], [수학01-12]'));
  assert.throws(() => parseStandardNotes(MATH_MONEY_NOTES, 0, MATH_MONEY_NOTES.length, { ...ctx, codeLeads: {} }),
    /학년군 숫자가 빠진 코드 '\[6수학01-11\], \[수학01-12\]'/);
  assert.deepEqual(parseCodes('[9수학01-11], [9수학01-12]'), ['[9수학01-11]', '[9수학01-12]']);
});

test('해설: 목록 상자 원문이 출시 원문과 다르면 실패한다', () => {
  const ctx = { where: '수학', bands: ALL_BANDS, codeLeads: exceptions.codeLeads, usedCodeLeads: new Set() };
  assert.throws(() => parseStandardNotes(MATH_MONEY_NOTES, 0, MATH_MONEY_NOTES.length, { ...ctx, boxText: (c) => (c === '[6수학01-12]' ? '다른 원문이다.' : BOX_TEXTS[c]) }),
    /\[6수학01-12\] 목록 상자 원문이 출시 원문과 다릅니다/);
  assert.throws(() => parseStandardNotes(MATH_MONEY_NOTES, 0, MATH_MONEY_NOTES.length, { ...ctx, boxText: () => undefined }), /출시 데이터에 없는 성취기준/);
});

test('해설(실측 건강한 생활): 성취기준마다 상자 — 다음 문단은 그 성취기준의 것이고 소제목을 나눈다', () => {
  const ctx = { where: '건강한 생활', bands: ['e1-2'], singleDomain: { domainNo: '01', domainKorean: '통합교과 4개 영역 중첩' }, boxText };
  const notes = parseStandardNotes(HEALTHY_LIVING_NOTES, 0, HEALTHY_LIVING_NOTES.length, ctx);
  const [sec] = notes.sections;
  assert.equal(sec.intro.length, 2);
  const [g] = sec.groups;
  assert.equal(g.codes.length, 6);
  assert.deepEqual(g.explanations.map((e) => `${e.codes} ${e.label}`), [
    '[2건생01-01] 성취기준의 설정 취지 및 의미', '[2건생01-01] 교수·학습의 주안점',
    '[2건생01-02] 성취기준의 설정 취지 및 의미', '[2건생01-02] 교수·학습의 주안점',
  ]);
  assert.ok(g.considerations.filter((e) => e.codes.join() === '[2건생01-02]').some((e) => e.label === '평가 시 고려 사항'));
  // 소제목 없는 문단이 끼면 실패한다.
  const bad = clone(HEALTHY_LIVING_NOTES);
  const k = bad.findIndex((p) => p.text.startsWith('교수⋅학습의 주안점') || p.text.startsWith('교수·학습의 주안점'));
  bad[k].text = '주안점 없이 시작하는 문단이다.';
  assert.throws(() => parseStandardNotes(bad, 0, bad.length, ctx), /소제목으로 시작하지 않는 문단/);
});

test('crossCheckDetails: PDF에 없는 문단을 잡고, HWP 전용 글자는 대조에서 뺀다', () => {
  const notes = parseStandardNotes(PE_NOTES, 0, PE_NOTES.length, { where: '체육', bands: ['e3-4'], boxText });
  const subject = { subjectKorean: '체육', contentSystem: { intro: [], domains: [] }, notes };
  const all = [notes.intro, ...notes.sections.flatMap((s) => [s.intro, ...s.groups.flatMap((g) => [g.intro, g.explanations.map((e) => e.text), g.considerations.map((e) => e.text)])])].flat();
  const pdf = all.join('\n').replace(/(.{30})/g, '$1\n');
  assert.deepEqual(crossCheckDetails([subject], pdf, ''), []);
  const missing = crossCheckDetails([subject], pdf.replace('체력', '채력'), '');
  assert.ok(missing.length > 0);
  const vertical = { subjectKorean: '국어', contentSystem: { intro: [cleanText('\u{f0810}, ―, /, ＼과 같은 여러 가지 선과')], domains: [] }, notes: { intro: [], sections: [] } };
  assert.deepEqual(crossCheckDetails([vertical], '\uf000, ―, /, ＼과 같은 여러 가지 선과', ''), []);
});

test('compareEditions: include·currentOnly 밖 과목은 두 판이 같아야 한다', () => {
  const mk = (id, text) => ({ subjectId: id, subjectKorean: id, contentSystem: { intro: [text], domains: [] }, notes: { intro: [], sections: [] } });
  const cur = [mk('a', '같다.'), mk('b', '최신 문구다.'), mk('new', '신설이다.')];
  const prev = [mk('a', '같다.'), mk('b', '이전 문구다.')];
  const opts = { includeIds: new Set(), currentOnlyIds: new Set(['new']) };
  const errors = compareEditions(cur, prev, opts);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^b: 두 판의 내용 체계·해설이 다릅니다 — 내용 체계 안내 1: 최신 '최신 문구다\.' \/ 이전 '이전 문구다\.'/);
  assert.deepEqual(compareEditions(cur, prev, { ...opts, includeIds: new Set(['b']) }), []);
  assert.match(compareEditions(cur, [...prev, mk('new', '신설이다.')], { ...opts, includeIds: new Set(['b']) })[0], /신설된 과목인데 이전 판에도/);
});

// 출시 데이터 검증기: 정상 데이터는 통과하고, 덮지 못한 코드·영역 불일치·깨진 글자는 실패한다.
const dataDir = new URL('../data/kr/', import.meta.url);
const read = (rel) => JSON.parse(readFileSync(new URL(rel, dataDir), 'utf8'));
test('verifyDetails: 출시 데이터는 통과하고, 변조는 잡는다', () => {
  const cs = read('basic/content-systems.json').subjects;
  const notes = read('basic/standard-notes.json').subjects;
  const { standards } = read('basic/curriculum-standards.json');
  const subjectById = new Map(read('subjects.json').subjects.map((s) => [s.id, s]));
  const ok = verifyDetails('basic', cs, notes, standards, subjectById);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.counts.standardsWithExplanation, 691);

  const n2 = clone(notes);
  const kor = n2.find((s) => s.subjectId === 'korean' && !s.edition);
  kor.sections[0].groups[0].codes.pop();
  kor.sections[0].groups[0].explanations[0].text = '깨진 글자\ufffd다.';
  const c2 = clone(cs);
  c2.find((s) => s.subjectId === 'korean').domains[0].domainKorean = '듣기';
  c2.find((s) => s.subjectId === 'social-studies').domains[0].rows[0].cells[0].gradeBands = ['e1-2'];
  const bad = verifyDetails('basic', c2, n2, standards, subjectById).errors.join('\n');
  assert.match(bad, /\[2국어01-0\d\]이\(가\) 목록 상자에 0번/);
  assert.match(bad, /문장 종결·글자 이상/);
  assert.match(bad, /영역 이름이 성취기준\('듣기·말하기'\)과 다릅니다/);
  assert.match(bad, /칸 학년군 이상\(e1-2\)|열 학년군/);
});

// 개발 PC에 원본 HWP·PDF가 있으면(저장소 부모 폴더) 파이프라인을 끝까지 다시 돌린 결과가 출시 데이터와 같아야 한다.
// 별책 3(기본 교육과정)과 별책 2(특수교육 전문 교과) 둘 다 — 내용 체계·해설과 성격·목표, 교수·학습 및 평가.
const parent = new URL('../../', import.meta.url);
const hwpSources = [
  ['[별책3] 기본 교육과정(nec-2026-2-annex3-hwp).hwp', 'nec-2026-2-annex3-hwp'],
  ['[별책2] 유치원, 공통 및 선택 중심 교육과정(nec-2026-2-annex2-hwp).hwp', 'nec-2026-2-annex2-hwp'],
];
for (const [file, sourceId] of hwpSources) {
  const hasSource = existsSync(new URL(file, parent));
  test(`원본 HWP 재추출이 출시 데이터와 같다 — ${sourceId}(원본이 있을 때만)`, { skip: !hasSource && '원본 HWP 없음' }, async () => {
    const { extractEdition } = await import('../pipeline/extract-details.mjs');
    const { extractGuides } = await import('../pipeline/extract-guides.mjs');
    const { hwpBlocks } = await import('../pipeline/hwp-text.mjs');
    const { annexCategories, loadSubjectConfig, routeCode } = await import('../pipeline/scope.mjs');
    const config = loadSubjectConfig();
    const sources = JSON.parse(readFileSync(new URL('../pipeline/sources.json', import.meta.url), 'utf8'));
    const src = sources.annexes.find((a) => a.id === sourceId);
    const categories = annexCategories(src);
    const subjects = read('subjects.json').subjects;
    const standards = categories.flatMap((c) => read(`${c}/curriculum-standards.json`).standards);
    const texts = new Map(categories.flatMap((c) => read(`${c}/standard-texts.json`).texts).map((t) => [t.key, t.text]));
    const blocks = hwpBlocks(readFileSync(new URL(file, parent)));
    const route = (c) => routeCode(c, src, config);
    const cur = extractEdition({
      blocks, route, subjectsById: new Map(subjects.map((s) => [s.id, s])), standards, texts,
      codeLeads: exceptions.codeLeads, verticalLabels: exceptions.verticalLabels, domainNames: exceptions.domainNames,
    });
    assert.deepEqual(cur.errors, []);
    assert.equal(cur.subjects.length, subjects.filter((s) => categories.includes(s.category)).length);
    const guides = extractGuides(blocks, route, { exceptions: { missingPartHeadings: exceptions.missingPartHeadings, itemNumbering: exceptions.itemNumbering } });
    assert.deepEqual(guides.errors, []);
    for (const category of categories) {
      const shippedCs = read(`${category}/content-systems.json`).subjects.filter((s) => !s.edition);
      const shippedNotes = read(`${category}/standard-notes.json`).subjects.filter((s) => !s.edition);
      const shippedGuides = read(`${category}/subject-guides.json`).subjects.filter((s) => !s.edition);
      for (const s of cur.subjects.filter((x) => x.category === category)) {
        const cs = shippedCs.find((x) => x.subjectId === s.subjectId);
        assert.deepEqual(s.contentSystem.domains.map(({ standardCodes, ...d }) => d), cs.domains, s.subjectKorean);
        assert.deepEqual(s.notes.sections, shippedNotes.find((x) => x.subjectId === s.subjectId).sections, s.subjectKorean);
      }
      for (const g of guides.subjects.filter((x) => x.category === category)) {
        const shipped = shippedGuides.find((x) => x.subjectId === g.subjectId);
        for (const k of ['nature', 'goals', 'teachingLearning', 'assessment']) assert.deepEqual(g[k], shipped[k], `${g.subjectKorean} ${k}`);
      }
    }
    void join;
  });
}
