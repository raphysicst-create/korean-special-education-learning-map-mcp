import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDataset, discoveryReport, extractStandards, findListCodes, numberingGaps, sliceStandardText,
} from '../pipeline/extract-standards.mjs';
import { findLocalPdf, pdfPattern } from '../pipeline/fetch-sources.mjs';
import { verifyAll } from '../pipeline/verify.mjs';
import {
  REAL_MAPPINGS, REAL_PDF_TEXT, SAMPLE_MAPPINGS, SAMPLE_PDF_TEXT,
} from './fixtures/sample-pdftotext.mjs';
import { buildFixtureDataDir } from './fixtures/build-fixture.mjs';

const byCode = (records) => new Map(records.map((r) => [r.code, r]));

test('extract: 줄 첫머리 코드만 목록 항목으로 잡고 해설 속 상호참조는 제외한다', () => {
  const { records, duplicates } = extractStandards(SAMPLE_PDF_TEXT);
  assert.deepEqual(records.map((r) => r.code),
    ['[4국01-01]', '[4국01-02]', '[4국02-01]', '[9진01-01]', '[9진01-02]', '[9진02-01]']);
  assert.deepEqual(duplicates, []);
});

test('extract: 줄바꿈된 본문을 잇고 해설·활동·교수학습 절을 잘라낸다', () => {
  const m = byCode(extractStandards(SAMPLE_PDF_TEXT).records);
  assert.equal(m.get('[4국01-01]').text, '일상생활에서 자주 듣는 말소리에 주의를 기울이며 듣는다.');
  assert.equal(m.get('[4국01-02]').text, '자신의 요구를 말이나 몸짓으로 표현한다.');
  assert.equal(m.get('[9진01-02]').text, '자신이 할 수 있는 일과 도움이 필요한 일을 구분한다.');
  assert.equal(m.get('[9진02-01]').text, '지역사회의 다양한 직업을 조사한다.');
});

test('extract: 쪽 머리글·쪽 번호가 본문에 섞이지 않는다', () => {
  for (const r of extractStandards(SAMPLE_PDF_TEXT).records) {
    assert.ok(!r.text.includes('기본 교육과정'), r.code);
    assert.ok(!/\s1[234]$/.test(r.text), r.code);
  }
});

test('extract: 영역 번호가 일치하는 머리글로 영역명을 붙인다(쪽 경계 넘어도)', () => {
  const m = byCode(extractStandards(SAMPLE_PDF_TEXT).records);
  assert.equal(m.get('[4국01-02]').domainKorean, '듣기·말하기');
  assert.equal(m.get('[4국02-01]').domainKorean, '읽기');
  assert.equal(m.get('[9진02-01]').domainKorean, '직업 세계');
});

test('findListCodes: 공백·대시 이형이 섞인 코드를 정규화한다', () => {
  const codes = findListCodes('\n[ 12 국 01 – 03 ] 본문이다.\n');
  assert.equal(codes[0].code, '[12국01-03]');
  assert.equal(codes[0].bandCode, '12');
});

test('sliceStandardText: 열린 괄호 안의 줄 첫머리 ")"는 헤딩으로 오인하지 않는다', () => {
  const text = '도구(가위\n) 를 사용한다.\n(가) 성취기준 해설';
  assert.equal(sliceStandardText(text, 0, text.length), '도구(가위 ) 를 사용한다.');
});

test('discoveryReport: 접두어별 수량·학년군 코드·표본을 보고한다', () => {
  const { records, duplicates } = extractStandards(SAMPLE_PDF_TEXT);
  const report = discoveryReport(records, duplicates);
  assert.equal(report.totalStandards, 6);
  const kor = report.prefixes.find((p) => p.prefix === '국');
  assert.equal(kor.count, 3);
  assert.deepEqual(kor.bandCodes, ['4']);
  assert.deepEqual(report.unknownBandCodes, []);
});

test('buildDataset: 대응표에 없는 접두어는 출시하지 않고 실패로 보고한다', () => {
  const { records } = extractStandards(SAMPLE_PDF_TEXT);
  const built = buildDataset(records, {
    category: 'basic', sourceId: 's', mappings: { 국: SAMPLE_MAPPINGS.국 },
  });
  assert.equal(built.standards.length, 3);
  assert.equal(built.failures.filter((f) => f.reason === 'unmapped-prefix').length, 3);
});

test('buildDataset: 수동 예외가 원문을 덮어쓰고 locator를 남긴다', () => {
  const { records } = extractStandards(SAMPLE_PDF_TEXT);
  const built = buildDataset(records, {
    category: 'basic', sourceId: 's', mappings: SAMPLE_MAPPINGS,
    exceptions: { '[4국02-01]': '그림을 보고 낱말을 읽는다.' },
  });
  const t = built.texts.find((x) => x.key === 'basic:[4국02-01]');
  assert.equal(t.text, '그림을 보고 낱말을 읽는다.');
  assert.equal(t.locator, 'manual-exception');
});

test('buildDataset: 미지 학년군 코드는 실패로 보고한다', () => {
  const built = buildDataset(
    [{ code: '[7국01-01]', bandCode: '7', prefix: '국', domainNo: '01', itemNo: '01', domainKorean: '읽기', text: '읽는다.' }],
    { category: 'basic', sourceId: 's', mappings: SAMPLE_MAPPINGS }
  );
  assert.equal(built.failures[0].reason, 'unknown-grade-band');
});

test('verify: 원문 누락·절단 의심을 잡는다', () => {
  const dir = buildFixtureDataDir();
  const textsPath = join(dir, 'basic', 'standard-texts.json');
  const data = JSON.parse(readFileSync(textsPath, 'utf8'));
  data.texts[0].text = '일상생활에서 자주 듣는 말소리에';
  data.texts.pop();
  writeFileSync(textsPath, JSON.stringify(data));
  const { errors } = verifyAll(dir, null);
  assert.ok(errors.some((e) => e.includes('절단 의심')));
  assert.ok(errors.some((e) => e.includes('원문 없는 성취기준')));
});

test('verify: gates.json 수량과 어긋나면 실패한다', () => {
  const dir = buildFixtureDataDir();
  const { errors } = verifyAll(dir, { categories: { basic: { standards: 99, bySubject: { korean: 3 } } } });
  assert.ok(errors.some((e) => e.includes('기대 99')));
  assert.ok(!errors.some((e) => e.includes('korean')));
});

test('실측 발췌: 내용 체계 표 속 코드는 버리고, 해설 머리 반복은 같은 원문이면 무해로 본다', () => {
  const { records, duplicates } = extractStandards(REAL_PDF_TEXT);
  const m = byCode(records);
  assert.equal(m.get('[2바생01-01]').text, '생활에 필요한 자조 기술을 바르게 익힌다.');
  assert.equal(m.get('[2바생01-03]').text, '나의 선호나 필요에 따라 능동적으로 선택한다.');
  assert.deepEqual(duplicates.map((d) => [d.code, d.sameText]), [['[2바생01-01]', true]]);
  const report = discoveryReport(records, duplicates);
  assert.deepEqual(report.repeatedCodes, ['[2바생01-01]']);
  assert.deepEqual(report.duplicateCodes, []);
});

test('실측 발췌: 코드 뒤 공백이 빠진 목록 항목도 받되, 조사가 붙은 상호참조는 받지 않는다', () => {
  const m = byCode(extractStandards(REAL_PDF_TEXT).records);
  assert.equal(m.get('[12진로06-01]').text, '자신이 선택한 지역사회 전환 기관의 이용 정보를 다양한 방법으로 조사한다.');
  assert.equal(m.get('[12진로06-01]').domainKorean, '진로 준비');
  assert.equal(m.get('[12진로06-03]').text, '교내외 현장실습 등으로 지역사회 전환 기관에서 필요한 생활 기능을 익혀 진로를 준비한다.');
  assert.deepEqual(findListCodes('\n[4국01-01]과 연계하여 지도한다.\n'), []);
});

test('실측 발췌: 09 학년군 코드는 중학교로, 가운뎃점 이형은 U+00B7로 통일한다', () => {
  const { records } = extractStandards(REAL_PDF_TEXT);
  const m = byCode(records);
  assert.equal(m.get('[09수학04-01]').domainKorean, '규칙성');
  assert.equal(m.get('[12생영02-01]').text, '실물·그림·사진 등에 있는 낱말·어구·문장을 읽는다.');
  assert.deepEqual(discoveryReport(records, []).unknownBandCodes, []);
  const built = buildDataset(records, { category: 'basic', sourceId: 's', mappings: REAL_MAPPINGS });
  assert.deepEqual(built.failures, []);
  const math = built.standards.find((s) => s.code === '[09수학04-01]');
  assert.equal(math.gradeBand, 'm1-3');
  assert.equal(built.subjects.find((s) => s.id === 'mathematics').note, '수학 비고');
});

test('buildDataset: 영역 머리글이 없는 과목은 대응표의 domainKorean을 쓴다', () => {
  const { records } = extractStandards(REAL_PDF_TEXT);
  const built = buildDataset(records, { category: 'basic', sourceId: 's', mappings: REAL_MAPPINGS });
  const right = built.standards.filter((s) => s.subjectId === 'right-living');
  assert.equal(right.length, 3);
  assert.ok(right.every((s) => s.domainKorean === '통합교과 4개 영역 중첩'));
});

test('공백 없는 목록 항목: 본문이 조사 같은 글자로 시작해도 버리지 않는다', () => {
  const text = '\n (1) 기본생활\n [6실과01-01] 옷의 종류를 안다.\n [6실과01-02]가정생활에 필요한 도구를 안다.\n'
    + ' [6실과01-03]이웃과 인사한다.\n';
  const m = byCode(extractStandards(text).records);
  assert.equal(m.get('[6실과01-02]').text, '가정생활에 필요한 도구를 안다.');
  assert.equal(m.get('[6실과01-03]').text, '이웃과 인사한다.');
  assert.deepEqual(extractStandards('\n[2국어01-01]이야기를 듣는다.\n').records.map((r) => r.code), ['[2국어01-01]']);
});

test('조사가 붙은 줄 첫머리 코드는 버리되, 목록 항목이 따로 없으면 rejected로 알린다', () => {
  const lone = extractStandards('\n[4국어01-01]과 연계하여 지도한다.\n');
  assert.deepEqual(lone.records, []);
  assert.deepEqual(lone.rejected.map((r) => r.code), ['[4국어01-01]']);
  const listed = extractStandards('\n[4국어01-01] 듣는다.\n[4국어01-01]과 연계하여 지도한다.\n');
  assert.deepEqual(listed.rejected, []);
});

test('공백 없는 목록 항목이 먼저면, 뒤의 같은 코드 줄이 그 자리를 빼앗지 않고 충돌로 잡힌다', () => {
  const text = '\n (6) 진로 준비\n [12진로06-01]자신이 선택한 기관을 조사한다.\n\n (가) 성취기준 해설\n'
    + ' [12진로06-01] 은 성인기 생활을 위한 것이다.\n';
  const { records, duplicates } = extractStandards(text);
  assert.equal(byCode(records).get('[12진로06-01]').text, '자신이 선택한 기관을 조사한다.');
  assert.deepEqual(duplicates.map((d) => [d.code, d.sameText]), [['[12진로06-01]', false]]);
  const mappings = { 진로: { id: 'career-vocation', subjectKorean: '진로와 직업' } };
  const blocked = buildDataset(records, { category: 'basic', sourceId: 's', mappings, duplicates });
  assert.equal(blocked.failures[0].reason, 'conflicting-duplicate');
  assert.equal(blocked.standards.length, 0);
  const resolved = buildDataset(records, {
    category: 'basic', sourceId: 's', mappings, duplicates,
    exceptions: { '[12진로06-01]': '자신이 선택한 기관을 조사한다.' },
  });
  assert.deepEqual(resolved.failures, []);
});

test('영역 머리글은 같은 과목의 성취기준 절 안에서만 찾는다(앞 과목 꼬리·끼어든 코드 무관)', () => {
  const text = [
    '2. 내용 체계 및 성취기준', '(1) 듣기·말하기', '[4국어01-01] 듣는다.',
    '3. 교수·학습 및 평가', '(1) 평가의 방향', '1. 성격 및 목표',
    '2. 내용 체계와 성취기준', '(2) 도형', '[4수학02-01] 본다.', '[4국어01-02] 은 참고한다.',
    '[4수학02-02] 그린다.', '[4수학01-01] 수를 센다.',
  ].join('\n');
  const m = byCode(extractStandards(text).records);
  assert.equal(m.get('[4국어01-01]').domainKorean, '듣기·말하기');
  assert.equal(m.get('[4수학02-02]').domainKorean, '도형');
  assert.equal(m.get('[4수학01-01]').domainKorean, null);
});

test('09와 9로 적힌 같은 코드는 하나로 보고 다른 원문이면 충돌로 잡는다', () => {
  const { records, duplicates } = extractStandards('\n[09수학04-01] 짝짓는다.\n[9수학04-01] 센다.\n');
  assert.deepEqual(records.map((r) => r.code), ['[09수학04-01]']);
  assert.deepEqual(duplicates.map((d) => [d.code, d.firstCode, d.sameText]), [['[9수학04-01]', '[09수학04-01]', false]]);
});

test('numberingGaps: 영역 안 순번 결번을 찾는다', () => {
  const recs = ['01', '03'].map((itemNo) => ({ prefix: '국어', bandCode: '4', domainNo: '01', itemNo }));
  assert.deepEqual(numberingGaps(recs), [{ group: '국어|4|01', missing: [2] }]);
});

test('buildDataset: 영역명만 고치는 예외는 원문을 건드리지 않는다', () => {
  const { records } = extractStandards(SAMPLE_PDF_TEXT);
  const built = buildDataset(records, {
    category: 'basic', sourceId: 's', mappings: SAMPLE_MAPPINGS,
    exceptions: { '[4국02-01]': { domainKorean: '읽기 영역' } },
  });
  assert.deepEqual(built.failures, []);
  assert.equal(built.standards.find((s) => s.code === '[4국02-01]').domainKorean, '읽기 영역');
  const t = built.texts.find((x) => x.key === 'basic:[4국02-01]');
  assert.equal(t.text, '그림이나 사진을 보고 낱말을 읽는다.');
  assert.equal(t.locator, 'pattern-match');
});

test('verify: 순번 결번을 누락 의심으로 잡는다', () => {
  const dir = buildFixtureDataDir();
  const stdPath = join(dir, 'basic', 'curriculum-standards.json');
  const data = JSON.parse(readFileSync(stdPath, 'utf8'));
  data.standards = data.standards.filter((s) => s.code !== '[4국01-01]');
  writeFileSync(stdPath, JSON.stringify(data));
  const { errors } = verifyAll(dir, null);
  assert.ok(errors.some((e) => e.includes('순번 결번') && e.includes('korean|e3-4|01')), errors.join('\n'));
});

test('fetch: [별책3]만 잡고 [별책30]·[별책13]은 잡지 않는다', () => {
  assert.ok(pdfPattern(3).test('[별책 3] 기본 교육과정.pdf'));
  assert.equal(findLocalPdf(['[별책30] 기계.pdf', '[별책13] x.pdf', '[별책3] 기본.pdf'], 3), '[별책3] 기본.pdf');
  assert.equal(findLocalPdf(['[별책3] 기본.hwp'], 3), null);
});
