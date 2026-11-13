import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDataset, discoveryReport, extractStandards, findListCodes, sliceStandardText,
} from '../pipeline/extract-standards.mjs';
import { findLocalPdf, pdfPattern } from '../pipeline/fetch-sources.mjs';
import { verifyAll } from '../pipeline/verify.mjs';
import { SAMPLE_MAPPINGS, SAMPLE_PDF_TEXT } from './fixtures/sample-pdftotext.mjs';
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

test('fetch: [별책3]만 잡고 [별책30]·[별책13]은 잡지 않는다', () => {
  assert.ok(pdfPattern(3).test('[별책 3] 기본 교육과정.pdf'));
  assert.equal(findLocalPdf(['[별책30] 기계.pdf', '[별책13] x.pdf', '[별책3] 기본.pdf'], 3), '[별책3] 기본.pdf');
  assert.equal(findLocalPdf(['[별책3] 기본.hwp'], 3), null);
});
