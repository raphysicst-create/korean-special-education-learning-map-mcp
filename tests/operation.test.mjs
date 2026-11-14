import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildItems, compareTableTokens, crossCheckPdf, expectedTableTokens, operationCounts, parseOperationSection,
} from '../pipeline/extract-operation.mjs';
import { findLocalPdf, sha256Hex } from '../pipeline/fetch-sources.mjs';
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

test('표 아래 주석이 없어도 배당표 전사를 HWP 칸과 대조한다', () => {
  const noNotes = MIDDLE_SCHOOL_PARAGRAPHS.filter((p) => !/^\s*[①②③]/.test(p));
  assert.equal(parseOperationSection(noNotes, MIDDLE_SCHOOL_TABLES).levels[0].allotment.notes.length, 0);
  const bad = clone(MIDDLE_SCHOOL_TABLES);
  bad.tables['<표 10>'].rows[4].values['1~3학년'] = '467';
  assert.throws(() => parseOperationSection(noNotes, bad), /전사가 HWP 표와 다릅니다/);
});

test('학교급에 편제·배당표·운영 기준 중 하나라도 없으면 실패한다', () => {
  // '나. 교육과정 편성·운영 기준' 절 전체가 빠진 경우(절 끝 머리만 남김).
  const cut = MIDDLE_SCHOOL_PARAGRAPHS.findIndex((p) => /^\s*나\.\s*교육과정\s*편성.?운영\s*기준/.test(p));
  const noCriteria = [...MIDDLE_SCHOOL_PARAGRAPHS.slice(0, cut), MIDDLE_SCHOOL_PARAGRAPHS.at(-1)];
  assert.throws(() => parseOperationSection(noCriteria, MIDDLE_SCHOOL_TABLES), /중학교: 나\. 편성·운영 기준을\(를\) 찾지 못했습니다/);
  const noTable = MIDDLE_SCHOOL_PARAGRAPHS.filter((p) => !/^\s*<표\s*10>/.test(p));
  assert.throws(() => parseOperationSection(noTable, MIDDLE_SCHOOL_TABLES), /표 번호가 없습니다|표가 없습니다/);
});

test('readCompoundFile: 디렉터리 순환은 조용히 넘기지 않고 실패한다', () => {
  // 최소 CFB(v3, 512바이트 섹터): 섹터0 = FAT, 섹터1 = 디렉터리(루트 + 서로를 가리키는 엔트리 둘).
  const buf = Buffer.alloc(512 * 3);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(9, 0x1e); buf.writeUInt16LE(6, 0x20);
  buf.writeUInt32LE(1, 0x2c); buf.writeUInt32LE(1, 0x30); buf.writeUInt32LE(4096, 0x38);
  buf.writeUInt32LE(0xfffffffe, 0x3c); buf.writeUInt32LE(0xfffffffe, 0x44);
  buf.fill(0xff, 0x4c, 0x200); buf.writeUInt32LE(0, 0x4c);
  const fat = 512; buf.fill(0xff, fat, fat + 512);
  buf.writeUInt32LE(0xfffffffd, fat); buf.writeUInt32LE(0xfffffffe, fat + 4);
  const dir = 1024;
  const entry = (i, name, type, left, right, child) => {
    const o = dir + i * 128;
    buf.write(name, o, 'utf16le'); buf.writeUInt16LE((name.length + 1) * 2, o + 64); buf[o + 66] = type;
    buf.writeUInt32LE(left, o + 68); buf.writeUInt32LE(right, o + 72); buf.writeUInt32LE(child, o + 76);
    buf.writeUInt32LE(0xfffffffe, o + 116); buf.writeUInt32LE(0, o + 120);
  };
  entry(0, 'Root Entry', 5, 0xffffffff, 0xffffffff, 1);
  entry(1, 'A', 2, 2, 0xffffffff, 0xffffffff);
  entry(2, 'B', 2, 1, 0xffffffff, 0xffffffff);
  entry(3, '', 0, 0xffffffff, 0xffffffff, 0xffffffff);
  assert.throws(() => readCompoundFile(buf), /두 번 연결/);
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
// 다른 판본 HWP가 함께 있어도 fetch와 같은 규칙(출처 id 꼬리표 → 고정 해시)으로 고른다.
const pdfDir = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', '..');
const hwpSource = JSON.parse(readFileSync(new URL('../pipeline/sources.json', import.meta.url), 'utf8'))
  .annexes.find((a) => a.role === 'operation');
const hwpName = existsSync(pdfDir)
  ? findLocalPdf(readdirSync(pdfDir), hwpSource.annexNo, 'hwp', hwpSource.id,
    (f) => sha256Hex(readFileSync(join(pdfDir, f))) === hwpSource.sha256)
  : null;
test('원본 HWP 재추출이 출시 데이터와 같다(원본이 있을 때만)', { skip: !hwpName && '원본 HWP 없음' }, () => {
  const tablesConfig = JSON.parse(readFileSync(new URL('../pipeline/operation-tables.json', import.meta.url), 'utf8'));
  const op = parseOperationSection(hwpParagraphs(readFileSync(join(pdfDir, hwpName))), tablesConfig);
  const shipped = JSON.parse(readFileSync(new URL('../data/kr/operation-guidelines.json', import.meta.url), 'utf8'));
  assert.deepEqual(op.levels, shipped.levels);
});
