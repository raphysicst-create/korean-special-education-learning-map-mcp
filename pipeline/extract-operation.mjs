#!/usr/bin/env node
// 【별책 1】 총론 Ⅲ-3 '기본 교육과정 편성·운영'(초·중·고)을 data/kr/operation-guidelines.json으로 만든다.
//   npm run pipeline:operation [-- --record-gates]
//
// 조항 원문은 HWP 문단에서 가져온다 — 총론 PDF는 글자 단위로 줄을 바꿔('학부모에 / 게')
// 줄 이음을 되살릴 수 없기 때문이다. 배당 기준표는 operation-tables.json(사람 전사)을 쓰되
// HWP 표 칸 목록과 낱낱이 대조한다. 끝으로 같은 고시의 PDF와 글자 단위(공백 제외)로 대조한다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWhitespace } from './extract-standards.mjs';
import { hwpParagraphs } from './hwp-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const SECTION_START = /^\s*3\.\s*기본\s*교육과정\s*편성.?운영\s*$/;
const SECTION_END = /^\s*Ⅳ\.\s*학교\s*교육과정\s*지원/;
const LEVEL_HEADING = /^\s*\S?\s*(초등학교|중학교|고등학교)\s*$/u;
const PART_A = /^\s*가\.\s*편제와\s*(시간|학점)\s*배당\s*기준\s*$/;
const PART_B = /^\s*나\.\s*교육과정\s*편성.?운영\s*기준\s*$/;
const ORGANIZATION = /^\s*1\)\s*편제\s*$/;
const ALLOTMENT = /^\s*2\)\s*(시간|학점)\s*배당\s*기준\s*$/;
const TABLE_LABEL = /^\s*(<표\s*\d+>)\s*(<[^>]+>)?\s*$/;
const NOTE = /^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/;
const ITEM = /^\s*(\d{1,2}\)|[가-하]\)|\(\d{1,2}\))\s*(.+)$/s;
const MARKER_ONLY = /^\s*<(?:개정|신설|삭제)[^>]*>\s*$/;
const HANGUL_ORDER = '가나다라마바사아자차카타파하';

const clean = (s) => normalizeWhitespace(s.replace(/\n/g, ' '));

function itemRank(no) {
  if (/^\d/.test(no)) return 1;
  if (/^[가-하]/.test(no)) return 2;
  return 3;
}

/** 번호 매긴 문단들 → 계층 목록. '<개정 …>'만 있는 문단은 앞 항목 끝에 붙인다. */
export function buildItems(paragraphs) {
  const root = [];
  const stack = [];
  let last = null;
  for (const raw of paragraphs) {
    if (MARKER_ONLY.test(raw)) {
      if (!last) throw new Error(`앞 항목 없는 개정 표시: ${raw}`);
      last.text = `${last.text} ${clean(raw)}`;
      continue;
    }
    const m = ITEM.exec(raw);
    if (!m) throw new Error(`번호 없는 문단(구조 해석 실패): ${raw.slice(0, 60)}`);
    const item = { no: m[1], text: clean(m[2]) };
    const rank = itemRank(item.no);
    while (stack.length && stack.at(-1).rank >= rank) stack.pop();
    if (stack.length) (stack.at(-1).item.children ??= []).push(item);
    else root.push(item);
    stack.push({ rank, item });
    last = item;
  }
  return root;
}

/** 표 정의(사람 전사) → HWP 칸 목록에 나와야 할 낱말들. */
export function expectedTableTokens(table) {
  const tokens = ['구 분', ...table.columns, '교', '과', '(군)'];
  for (const [i, row] of table.rows.entries()) {
    tokens.push(row.label);
    if (i === 0 && table.breakdown) {
      for (const list of Object.values(table.breakdown)) for (const b of list) tokens.push(`${b.label} ${b.value}`);
    }
    for (const col of table.columns) if (row.values[col] !== undefined) tokens.push(row.values[col]);
  }
  for (const t of table.totals) {
    tokens.push(t.label);
    for (const col of table.columns) tokens.push(t.values[col]);
  }
  return tokens;
}

/** HWP 칸 목록과 전사 표를 순서까지 같게 대조한다. 다르면 첫 불일치를 알린다. */
export function compareTableTokens(table, hwpTokens) {
  const expected = expectedTableTokens(table).map(clean);
  const actual = hwpTokens.map(clean).filter(Boolean);
  for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
    if (expected[i] !== actual[i]) {
      return `칸 ${i + 1}번째: 전사="${expected[i] ?? '(없음)'}" HWP="${actual[i] ?? '(없음)'}"`;
    }
  }
  return null;
}

/** 편성·운영 절 문단 → 학교급별 구조. tablesConfig는 operation-tables.json. */
export function parseOperationSection(paragraphs, tablesConfig) {
  const start = paragraphs.findLastIndex((p) => SECTION_START.test(p));
  if (start < 0) throw new Error("'3. 기본 교육과정 편성·운영' 절을 찾지 못했습니다.");
  let end = paragraphs.findIndex((p, i) => i > start && SECTION_END.test(p));
  if (end < 0) end = paragraphs.length;
  const sectionTitle = clean(paragraphs[start]);
  const body = paragraphs.slice(start + 1, end).filter((p) => p.trim());

  const levels = [];
  let level = null;
  let mode = null;
  let buf = [];
  let table = null;
  const flush = () => {
    if (!level || !mode) return;
    if (mode === 'organization') level.organization.items = buildItems(buf);
    if (mode === 'criteria') level.criteria.items = buildItems(buf);
    if (mode === 'notes') level.allotment.notes = buf.map((p) => clean(p));
    buf = [];
  };
  for (const p of body) {
    const lh = LEVEL_HEADING.exec(p);
    if (lh) {
      flush();
      const cfg = tablesConfig.levels[lh[1]];
      if (!cfg) throw new Error(`operation-tables.json levels에 ${lh[1]}이(가) 없습니다.`);
      level = {
        id: cfg.id, labelKorean: lh[1], gradeBands: cfg.gradeBands,
        ...(cfg.note ? { note: cfg.note } : {}),
        partA: null, organization: { title: null, items: [] },
        allotment: null, criteria: { title: null, items: [] },
      };
      levels.push(level);
      mode = null;
      continue;
    }
    if (!level) throw new Error(`학교급 머리 앞 문단: ${p.slice(0, 40)}`);
    if (PART_A.test(p)) { flush(); level.partA = clean(p); mode = null; continue; }
    if (ORGANIZATION.test(p)) { flush(); level.organization.title = clean(p); mode = 'organization'; continue; }
    if (ALLOTMENT.test(p)) {
      flush();
      level.allotment = { title: clean(p), tableNo: null, amendment: null, unit: null, columns: [], columnByGradeBand: tablesConfig.levels[level.labelKorean].columnByGradeBand, groupLabel: null, rows: [], totals: [], notes: [] };
      mode = 'allotment-label';
      continue;
    }
    if (PART_B.test(p)) { flush(); level.criteria.title = clean(p); mode = 'criteria'; continue; }
    if (mode === 'allotment-label') {
      const t = TABLE_LABEL.exec(p);
      if (!t) throw new Error(`배당 기준 다음에 표 번호가 없습니다: ${p.slice(0, 40)}`);
      const tableNo = t[1].replace(/\s+/g, ' ');
      table = tablesConfig.tables[tableNo];
      if (!table) throw new Error(`operation-tables.json에 ${tableNo} 전사가 없습니다.`);
      Object.assign(level.allotment, {
        tableNo, amendment: t[2] ?? null, unit: table.unit, columns: table.columns, groupLabel: table.groupLabel,
        rows: table.rows, ...(table.breakdown ? { breakdown: table.breakdown } : {}), totals: table.totals,
      });
      mode = 'table';
      continue;
    }
    if (mode === 'table') {
      if (NOTE.test(p)) {
        const diff = compareTableTokens(table, buf);
        if (diff) throw new Error(`${level.allotment.tableNo} 전사가 HWP 표와 다릅니다 — ${diff}`);
        buf = [p];
        mode = 'notes';
      } else {
        buf.push(p);
      }
      continue;
    }
    if (mode === 'notes' && !NOTE.test(p)) throw new Error(`표 주석 사이의 예상 밖 문단: ${p.slice(0, 40)}`);
    if (!mode) throw new Error(`구조 밖 문단: ${p.slice(0, 40)}`);
    buf.push(p);
  }
  flush();
  return { sectionTitle, levels };
}

/** 모든 원문(항목·주석·표 칸)이 같은 고시 PDF 텍스트에 공백 무시로 들어 있는지 본다. */
export function crossCheckPdf(op, pdfText) {
  const squash = (s) => normalizeWhitespace(s).replace(/\s+/g, '');
  const pdf = squash(pdfText);
  const missing = [];
  const check = (label, text) => { if (!pdf.includes(squash(text))) missing.push(`${label}: ${text.slice(0, 50)}`); };
  const walk = (items, label) => {
    for (const it of items ?? []) { check(label, `${it.no}${it.text}`); walk(it.children, label); }
  };
  for (const l of op.levels) {
    walk(l.organization.items, `${l.labelKorean} 편제`);
    walk(l.criteria.items, `${l.labelKorean} 운영 기준`);
    for (const n of l.allotment.notes) check(`${l.labelKorean} 표 주석`, n);
    for (const r of [...l.allotment.rows, ...l.allotment.totals]) check(`${l.labelKorean} 표 칸`, r.label);
  }
  return missing;
}

function countItems(items) {
  return (items ?? []).reduce((n, it) => n + 1 + countItems(it.children), 0);
}

export function operationCounts(op) {
  return {
    schoolLevels: op.levels.length,
    organizationItems: op.levels.reduce((n, l) => n + countItems(l.organization.items), 0),
    criteriaItems: op.levels.reduce((n, l) => n + countItems(l.criteria.items), 0),
    tables: op.levels.filter((l) => l.allotment).length,
  };
}

export { HANGUL_ORDER };

function main() {
  const recordGates = process.argv.includes('--record-gates');
  const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
  const paths = JSON.parse(readFileSync(join(repoRoot, '.cache', 'pdf-paths.json'), 'utf8'));
  const tablesConfig = JSON.parse(readFileSync(join(here, 'operation-tables.json'), 'utf8'));
  const hwpSource = sources.annexes.find((a) => a.role === 'operation');
  const pdfSource = sources.annexes.find((a) => a.role === 'operation-check');
  if (!paths[hwpSource?.id] || !paths[pdfSource?.id]) throw new Error('별책 1 파일 경로가 없습니다 — pipeline:fetch를 먼저 실행하세요.');

  const op = parseOperationSection(hwpParagraphs(readFileSync(paths[hwpSource.id])), tablesConfig);
  const pdfText = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', paths[pdfSource.id], '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const missing = crossCheckPdf(op, pdfText);
  if (missing.length) {
    console.error(`✗ PDF 대조 실패 ${missing.length}건:`);
    for (const m of missing.slice(0, 30)) console.error(`  - ${m}`);
    process.exit(1);
  }
  const out = {
    version: 'kr-special-operation-v1',
    sourceId: hwpSource.id,
    checkedAgainst: pdfSource.id,
    sourceNotice: `${hwpSource.notice} 【별책 ${hwpSource.annexNo}】 ${hwpSource.titleKorean}`,
    section: `Ⅲ. 학교급별 교육과정 편성·운영의 기준 > ${op.sectionTitle}`,
    pages: '49~55',
    levels: op.levels,
  };
  const dest = join(repoRoot, 'data', 'kr', 'operation-guidelines.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
  const counts = operationCounts(op);
  console.error(`✓ 편성·운영: 학교급 ${counts.schoolLevels} · 편제 ${counts.organizationItems}항 · 운영 기준 ${counts.criteriaItems}항 · 배당표 ${counts.tables}개 (PDF 대조 통과)`);
  if (recordGates) {
    const gatesPath = join(here, 'gates.json');
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8'));
    gates.operation = counts;
    writeFileSync(gatesPath, `${JSON.stringify(gates, null, 1)}\n`);
    console.error('✓ pipeline/gates.json operation 갱신');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
