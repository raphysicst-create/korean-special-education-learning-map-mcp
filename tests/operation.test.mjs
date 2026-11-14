import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildItems, compareTableTokens, crossCheckPdf, expectedTableTokens, operationCounts, parseOperationSection,
} from '../pipeline/extract-operation.mjs';
import { hwpParagraphs, paraText, readCompoundFile } from '../pipeline/hwp-text.mjs';
import { verifyOperation } from '../pipeline/verify.mjs';
import { MIDDLE_SCHOOL_PARAGRAPHS, MIDDLE_SCHOOL_TABLES } from './fixtures/operation-paragraphs.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));

test('paraText: 확장 제어 문자(8 WCHAR)를 건너뛰고 탭·강제 줄바꿈을 남긴다', () => {
  const units = [0x6559, 9, 0, 0, 0, 0, 0, 0, 0, 0x6c34, 11, 0, 0, 0, 0, 0, 0, 0, 10, 0xac00, 13];
  const buf = Buffer.alloc(units.length * 2);
  units.forEach((u, i) => buf.writeUInt16LE(u, i * 2));
  assert.equal(paraText(buf), '教\t水\n가');
});

test('readCompoundFile: OLE 복합 문서가 아니면 거부한다', () => {
  assert.throws(() => readCompoundFile(Buffer.from('%PDF-1.6')), /OLE 복합 문서가 아닙니다/);
});

test('buildItems: 번호 계층(1) > 가) > (1))을 세우고 개정 표시만 있는 문단은 앞 항목에 붙인다', () => {
  const items = buildItems([' 1) 하나다.', '  가) 둘이다.', '   (1) 셋이다.', '<개정 2026. 1. 21.>', ' 2) 넷이다.']);
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].children[0].text, '셋이다. <개정 2026. 1. 21.>');
  assert.equal(items[1].no, '2)');
  assert.throws(() => buildItems(['번호 없는 문단이다.']), /번호 없는 문단/);
});

test('실측 발췌(중학교): 편제·배당표·주석·운영 기준을 구조화한다', () => {
  const op = parseOperationSection(MIDDLE_SCHOOL_PARAGRAPHS, MIDDLE_SCHOOL_TABLES);
  assert.equal(op.levels.length, 1);
  const [mid] = op.levels;
  assert.equal(mid.id, 'middle');
  assert.equal(mid.partA, '가. 편제와 시간 배당 기준');
  assert.deepEqual(mid.organization.items.map((i) => i.no), ['가)', '나)', '다)', '라)', '마)']);
  assert.equal(mid.organization.items[2].text, '선택 교과는 정보통신활용, 생활영어, 보건 등의 과목으로 한다.');
  assert.equal(mid.allotment.tableNo, '<표 10>');
  assert.equal(mid.allotment.notes.length, 3);
  assert.equal(mid.criteria.items.length, 10);
  const nine = mid.criteria.items[8];
  assert.deepEqual(nine.children.map((c) => c.no), ['가)', '나)']);
  assert.deepEqual(nine.children[0].children.map((c) => c.no), ['(1)', '(2)']);
  assert.ok(mid.criteria.items[9].children[0].text.endsWith('운영한다. <개정 2024.8.16.>'));
  // 가운뎃점 이형(⋅)은 U+00B7로 통일된다.
  assert.ok(mid.criteria.items[3].text.includes('학생·교사·학부모'));
  assert.deepEqual(operationCounts(op), { schoolLevels: 1, organizationItems: 5, criteriaItems: 17, tables: 1 });
});

test('배당표 전사가 HWP 표 칸과 한 칸이라도 다르면 실패한다', () => {
  const bad = clone(MIDDLE_SCHOOL_TABLES);
  bad.tables['<표 10>'].rows[4].values['1~3학년'] = '467';
  assert.throws(() => parseOperationSection(MIDDLE_SCHOOL_PARAGRAPHS, bad), /전사가 HWP 표와 다릅니다.*진로와 직업|467/);
  const table = MIDDLE_SCHOOL_TABLES.tables['<표 10>'];
  assert.match(compareTableTokens(table, expectedTableTokens(table).slice(0, -1)), /HWP="\(없음\)"/);
});

test('crossCheckPdf: PDF에 없는 조항을 잡는다', () => {
  const op = parseOperationSection(MIDDLE_SCHOOL_PARAGRAPHS, MIDDLE_SCHOOL_TABLES);
  const pdfLike = MIDDLE_SCHOOL_PARAGRAPHS.join('\n');
  assert.deepEqual(crossCheckPdf(op, pdfLike), []);
  const missing = crossCheckPdf(op, pdfLike.replace('자유학기를', '자율학기를'));
  assert.ok(missing.some((m) => m.includes('운영 기준')), missing.join('\n'));
});

test('verifyOperation: 배당표 합계·조항 번호 이상을 잡는다', () => {
  const op = parseOperationSection(MIDDLE_SCHOOL_PARAGRAPHS, MIDDLE_SCHOOL_TABLES);
  const data = { levels: [
    { ...clone(op.levels[0]), id: 'elementary' }, clone(op.levels[0]), { ...clone(op.levels[0]), id: 'high' },
  ] };
  assert.deepEqual(verifyOperation(data), []);
  data.levels[1].allotment.rows[0].values['1~3학년'] = '375';
  data.levels[1].criteria.items[1].no = '3)';
  const errors = verifyOperation(data);
  assert.ok(errors.some((e) => e.includes('교과(군) 합 2415')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('2번째 항목 번호가 3)')), errors.join('\n'));
});

// 개발 PC에 원본 HWP가 있으면(저장소 부모 폴더) 출시 데이터와 끝까지 다시 맞춰 본다. CI에는 없어 건너뛴다.
const pdfDir = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', '..');
const hwpName = existsSync(pdfDir) ? readdirSync(pdfDir).find((f) => /\[\s*별\s*책\s*1\s*\].*\.hwp$/.test(f)) : null;
test('원본 HWP 재추출이 출시 데이터와 같다(원본이 있을 때만)', { skip: !hwpName && '원본 HWP 없음' }, () => {
  const tablesConfig = JSON.parse(readFileSync(new URL('../pipeline/operation-tables.json', import.meta.url), 'utf8'));
  const op = parseOperationSection(hwpParagraphs(readFileSync(join(pdfDir, hwpName))), tablesConfig);
  const shipped = JSON.parse(readFileSync(new URL('../data/kr/operation-guidelines.json', import.meta.url), 'utf8'));
  assert.deepEqual(op.levels, shipped.levels);
});
