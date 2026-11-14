#!/usr/bin/env node
// 【별책 3】 기본 교육과정의 '가. 내용 체계'(핵심 아이디어·내용 요소 표)와 '나. 성취기준'의
// 영역 안내·성취기준 해설·성취기준 적용 시 고려 사항을 HWP에서 추출한다.
//   npm run pipeline:details [-- --record-gates]
//
// 원문은 HWP 문단·표 칸에서 가져온다 — PDF는 단어 중간에서 줄을 바꾸고 표 칸을 섞어 내보내기 때문이다.
// 추출 결과는 같은 고시의 PDF와 글자 단위(공백 제외)로 대조하고, 성취기준 목록 상자의 원문은 출시
// 성취기준 원문과 대조한다. 구조 해석은 엄격하다 — 모르는 머리글·글자·표 모양은 실패로 알린다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalCode, normalizeCode, resolveGradeBand } from '../src/normalize.mjs';
import { normalizeWhitespace, stripPageFurniture } from './extract-standards.mjs';
import { hwpBlocks } from './hwp-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

export const CATEGORIES = ['지식·이해', '과정·기능', '가치·태도'];

// HWP 전용(사용자 정의 영역) 글자 — 지면 이미지와 대조해 정했다. PDF 텍스트에는 나오지 않거나
// 다른 글자로 나온다.
//   U+F0810 '|'(세로선, 국어 [2국어03-02] 고려 사항의 '|, ―, /, ＼' — PDF 텍스트에 없음)
//   U+F09E  '·'(가운뎃점, 수학 [12수학04-03] 고려 사항의 '포장·조립' — PDF 텍스트에는 'ž'로 나옴)
//   U+F02B1~F02B9 네모 숫자 — 하위 영역 머리글(수학 '\u{f02b1} 수의 기초' 등) 번호. ①~⑨로 바꾼다.
const PUA_MAP = new Map([[0xf0810, '|'], [0xf09e, '·']]);
const BOXED_DIGIT_BASE = 0xf02b0;
// PDF 쪽에서 Symbol 글꼴 가운뎃점은 'ž'(U+017E)로, 세로선은 U+F000(전용 영역)으로 나오므로 대조 때
// 지운다(교육과정 원문에 ž는 없다). HWP 쪽 전용 글자도 대조형에서 지우므로 양쪽이 맞는다.
const PDF_SYMBOL_ARTIFACTS = /[ž\ue000-\uf8ff]/g;
const isPua = (cp) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;

// 출시 텍스트 → PDF 대조용 텍스트(HWP 전용 글자를 지운 것). 둘이 다를 때만 기록한다.
const PDF_FORM = new Map();

/**
 * HWP 문단 글자 → 출시 텍스트. forPdf면 HWP 전용 글자를 지운다(PDF 텍스트에 없으므로 대조용).
 * 네모 숫자는 동그라미 숫자(①~⑨)로 바꾼다. 모르는 전용 글자는 실패시킨다.
 */
export function cleanText(raw, { forPdf = false } = {}) {
  const s = String(raw ?? '').normalize('NFC').replace(/\n/g, ' ');
  let out = '';
  let pdf = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (!isPua(cp)) { out += ch; pdf += ch; continue; }
    if (PUA_MAP.has(cp)) { out += PUA_MAP.get(cp); continue; }
    if (cp > BOXED_DIGIT_BASE && cp <= BOXED_DIGIT_BASE + 9) { out += String.fromCodePoint(0x2460 + cp - BOXED_DIGIT_BASE - 1); continue; }
    throw new Error(`모르는 HWP 전용 글자 U+${cp.toString(16).toUpperCase()}: ${s.slice(0, 60)}`);
  }
  const clean = normalizeWhitespace(out);
  const pdfClean = normalizeWhitespace(pdf);
  if (pdfClean !== clean) PDF_FORM.set(clean, pdfClean);
  return forPdf ? pdfClean : clean;
}

/** 출시 텍스트의 PDF 대조형(HWP 전용 글자에서 온 글자를 뺀 것). */
export const pdfForm = (text) => PDF_FORM.get(text) ?? text;

const squash = (s) => cleanText(s).replace(/\s+/g, '');
const stripBullet = (s) => s.replace(/^[·•∙◦▪]\s*/, '');

/** 표 칸 → 문단 글자 배열(빈 문단 제외). */
const cellParas = (cell) => cell.paras.map((p) => cleanText(p.text)).filter(Boolean);

/** 머리 칸 글자. 한 글자씩 세로로 쓴 칸('자⏎율⏎성')은 붙여 쓴다. */
const isVertical = (cell) => {
  const parts = cellParas(cell);
  return parts.length > 1 && parts.every((p) => [...p].length <= 1);
};
function labelText(cell) {
  const parts = cellParas(cell);
  return isVertical(cell) ? parts.join('') : parts.join(' ');
}

/**
 * 하위 영역 머리 칸 → 출시 표기. 세로쓰기 칸은 띄어쓰기가 사라지므로 예외표(verticalLabels)의 표기를
 * 쓴다 — 없으면 실패. ctx.verticalLabels·usedVerticalLabels.
 */
function subAreaLabel(cell, ctx) {
  const text = cleanText(labelText(cell));
  if (!text || !isVertical(cell)) return text;
  const fix = ctx.verticalLabels?.[text];
  if (!fix) throw new Error(`${ctx.where}: 세로쓰기 머리 칸 '${text}' — details-exceptions.json verticalLabels에 띄어쓰기 표기를 근거와 함께 적으세요.`);
  if (fix.label.replace(/\s+/g, '') !== text) throw new Error(`${ctx.where}: verticalLabels '${text}' → '${fix.label}'은(는) 글자가 다릅니다.`);
  ctx.usedVerticalLabels?.add(text);
  return fix.label;
}

/**
 * 내용 요소·핵심 아이디어 칸 → 항목 배열. 항목은 글머리표(∙)로 시작하는 문단이다. 글머리표 없는
 * 문단은 앞 항목을 문단 나눔으로 줄바꿈한 것이라(진로와 직업 '∙ 미래 변화에 따른 새로운 직업 / 조사하기')
 * 앞 항목에 잇는다. 첫 문단에 글머리표가 없으면 실패한다.
 */
function cellItems(cell, where) {
  const items = [];
  for (const p of cellParas(cell)) {
    if (/^[·•∙]/.test(p)) items.push(stripBullet(p));
    else if (items.length) items[items.length - 1] = `${items.at(-1)} ${p}`;
    else throw new Error(`${where}: 글머리표 없이 시작하는 칸 '${p.slice(0, 40)}'`);
  }
  return items;
}

const SECTION_A = /^가\.\s*내용\s*체계$/;
const SECTION_B = /^나\.\s*성취기준$/;
const SECTION_END_PARA = /^가\.\s*교수/;
const SECTION_END_BOX = /^3\.\s*교수/;
const DOMAIN_HEADING = /^\((\d{1,2})\)\s*(\S.{0,38})$/;
const BAND_HEADING = /^\[\s*(초등학교|중학교|고등학교)\s*(\d)\s*[~∼]\s*(\d)\s*학년\s*\]$/;
const SUBAREA_HEADING = /^([①-⑨])\s*(\S.{0,30})$/;
const PART_GA = /^\(가\)\s*성취기준\s*해설$/;
const PART_NA = /^\(나\)\s*성취기준\s*적용\s*시\s*고려\s*사항$/;
const CODE_ONE = '\\[\\s*\\d{1,2}\\s*[가-힣]{2}\\s*\\d{2}\\s*[-‐‑–—−]\\s*\\d{2}\\s*\\]';
// 문단 첫머리 코드는 학년군 숫자가 빠진 오기('[수학01-12]')까지 잡아서 예외표로만 풀어 준다 — 조용히
// 코드 없는 문단(묶음 전체)으로 넘어가지 않게.
const CODE_LOOSE = '\\[\\s*\\d{0,2}\\s*[가-힣]{2}\\s*\\d{2}\\s*[-‐‑–—−]\\s*\\d{2}\\s*\\]';
const CODE_LEAD = new RegExp(`^(${CODE_LOOSE}(?:\\s*,\\s*${CODE_LOOSE})*)\\s*`);
const BOX_LINE = new RegExp(`^(${CODE_ONE})\\s*(.+)$`);

// 2026-2호 통합교과(건강한 생활·즐거운 생활)는 성취기준마다 해설·고려 사항을 소제목으로 나눈다.
export const EXPLANATION_LABELS = ['성취기준의 설정 취지 및 의미', '교수·학습의 주안점'];
export const CONSIDERATION_LABELS = [
  '장애에 따른 특별한 지원 안내', '평가 시 고려 사항', '다른 통합교과 및 범교과와의 연계 안내',
  '다른 통합교과 및 범교과와의 연계', '교사 수준의 성취기준 재구성 안내',
];

/**
 * 문단 첫머리 코드 부분 → 코드 배열. 학년군 숫자가 빠진 코드가 있으면 예외표(details-exceptions.json
 * codeLeads)에 그 첫머리가 있어야 하고, 쓰인 항목은 used에 기록한다.
 */
export function parseCodes(lead, codeLeads = {}, used = new Set()) {
  const codes = lead.match(new RegExp(CODE_LOOSE, 'g'));
  if (codes.every((c) => /^\[\s*\d/.test(c))) return codes.map((c) => normalizeCode(c));
  const key = normalizeWhitespace(lead);
  const fix = codeLeads[key];
  if (!fix) throw new Error(`학년군 숫자가 빠진 코드 '${key}' — 원문 오기라면 details-exceptions.json codeLeads에 근거와 함께 적으세요.`);
  used.add(key);
  return fix.codes.map((c) => normalizeCode(c));
}

/** 문서 → 과목별 절 경계 [{ a, b, end }]: '가. 내용 체계', '나. 성취기준', 끝(3. 교수·학습 글상자). */
export function findSubjectSections(blocks) {
  const text = (p) => cleanText(p.text);
  const out = [];
  for (let k = 0; k < blocks.length; k += 1) {
    if (!SECTION_A.test(text(blocks[k]))) continue;
    const b = blocks.findIndex((p, j) => j > k && SECTION_B.test(text(p)));
    if (b < 0) throw new Error(`'가. 내용 체계'(${k}) 뒤에 '나. 성취기준'이 없습니다.`);
    const end = blocks.findIndex((p, j) => j > b && (SECTION_END_PARA.test(text(p))
      || p.ctrls.some((c) => c.id !== 'tbl ' && c.texts?.some((t) => SECTION_END_BOX.test(cleanText(t))))));
    if (end < 0) throw new Error(`'나. 성취기준'(${b}) 뒤에 '3. 교수·학습 및 평가'가 없습니다.`);
    const next = out.at(-1);
    if (next && k < next.end) throw new Error(`과목 절이 겹칩니다(${k}).`);
    out.push({ a: k, b, end });
  }
  return out;
}

/** 절 안 성취기준 목록 상자(1x1 표)의 코드 접두어 → 과목 접두어 하나. */
function sectionPrefix(blocks, { b, end }) {
  const prefixes = new Set();
  for (let k = b; k < end; k += 1) {
    for (const c of blocks[k].ctrls) {
      if (c.id !== 'tbl ' || c.rows !== 1 || c.cols !== 1) continue;
      for (const p of cellParas(c.cells[0])) {
        const m = BOX_LINE.exec(p);
        if (m) prefixes.add(normalizeCode(m[1]).replace(/^\[\d+/, '').slice(0, 2));
      }
    }
  }
  if (prefixes.size !== 1) throw new Error(`절(${b}~${end})의 성취기준 접두어가 하나가 아닙니다: ${[...prefixes].join(',')}`);
  return [...prefixes][0];
}

function grid(table) {
  const g = Array.from({ length: table.rows }, () => Array(table.cols).fill(null));
  for (const cell of table.cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c += 1) {
        if (g[r][c]) throw new Error(`표 칸이 겹칩니다: r${r}c${c}`);
        g[r][c] = cell;
      }
    }
  }
  return g;
}

/**
 * 내용 체계 표 하나 → { coreIdeas, columns, rows, standardCodes? }.
 *  - 행 배치(교과 대부분): 1행 '핵심 아이디어 | 내용', 이어 '범주 | 내용 요소' 머리 행들(학교급·학년),
 *    범주(지식·이해/과정·기능/가치·태도) 행. 범주 왼쪽·오른쪽 머리 칸(사회 '자율성', 수학 '수의 기초')은 subArea.
 *  - 열 배치(2026 통합교과): '핵심 아이디어 | 범주 | 내용 요소 | 성취기준' 머리 행 아래 범주 행.
 * ctx: { where, bands(과목 학년군), columnSubject?(2024 통합교과 표에서 고를 과목 열 이름) }
 */
export function parseContentTable(table, ctx) {
  const where = ctx.where;
  const g = grid(table);
  const sq = (cell) => (cell ? squash(labelText(cell)) : '');
  const isCategory = (cell) => CATEGORIES.includes(cleanText(labelText(cell)).replace(/\s+/g, ''));
  const core = table.cells.find((c) => sq(c) === '핵심아이디어');
  const content = table.cells.find((c) => sq(c) === '내용요소');
  if (!core || !content) throw new Error(`${where}: 표에 '핵심 아이디어'·'내용 요소' 머리 칸이 없습니다.`);
  const categoryCells = table.cells.filter(isCategory);
  if (categoryCells.length < 3) throw new Error(`${where}: 범주 칸이 3개보다 적습니다.`);
  const firstCatRow = Math.min(...categoryCells.map((c) => c.row));

  // 열 배치(2026 통합교과)
  if (core.row === 0 && content.row === 0) {
    const coreCell = g[1]?.[core.col];
    const stdHead = table.cells.find((c) => c.row === 0 && sq(c) === '성취기준');
    if (!coreCell || !stdHead || ctx.bands.length !== 1) throw new Error(`${where}: 열 배치 표 모양이 예상과 다릅니다.`);
    const rows = [];
    for (const cat of categoryCells.sort((a, b) => a.row - b.row)) {
      const v = g[cat.row][content.col];
      rows.push({ category: cleanText(labelText(cat)).replace(/\s+/g, ''), cells: [{ gradeBands: [...ctx.bands], items: cellItems(v, `${where} ${labelText(cat)}`) }] });
    }
    const std = g[1][stdHead.col];
    const standardCodes = cellParas(std).map((p) => {
      const m = BOX_LINE.exec(p);
      if (!m) throw new Error(`${where}: 성취기준 열 문단 '${p.slice(0, 30)}'`);
      return normalizeCode(m[1]);
    });
    return { coreIdeas: cellItems(coreCell, `${where} 핵심 아이디어`), columns: [{ gradeBand: ctx.bands[0], label: null }], rows, standardCodes };
  }

  // 행 배치
  const coreValue = g[core.row][core.col + core.colSpan];
  if (!coreValue) throw new Error(`${where}: 핵심 아이디어 내용 칸이 없습니다.`);
  const valueStart = content.col;
  const valueEnd = content.col + content.colSpan;
  if (valueEnd !== table.cols) throw new Error(`${where}: 내용 요소 열이 표 오른쪽 끝까지 가지 않습니다.`);
  const columns = [];
  for (let c = valueStart; c < valueEnd; c += 1) {
    const parts = [];
    for (let r = content.row + 1; r < firstCatRow; r += 1) {
      const cell = g[r][c];
      const t = cell ? cleanText(labelText(cell)) : '';
      if (t && parts.at(-1) !== t) parts.push(t);
    }
    const label = parts.join(' ');
    columns.push({ col: c, label });
  }
  let keep = columns;
  if (ctx.columnSubject) {
    keep = columns.filter((c) => c.label.replace(/\s+/g, '') === ctx.columnSubject.replace(/\s+/g, ''));
    if (keep.length !== 1) throw new Error(`${where}: 과목 열 '${ctx.columnSubject}'을(를) 찾지 못했습니다(열: ${columns.map((c) => c.label).join(', ')}).`);
    keep = [{ ...keep[0], gradeBand: ctx.bands[0] }];
  } else {
    for (const c of keep) {
      c.gradeBand = resolveGradeBand(c.label.replace(/\s+/g, ''));
      if (!c.gradeBand || !ctx.bands.includes(c.gradeBand)) throw new Error(`${where}: 열 머리 '${c.label}'을(를) 과목 학년군(${ctx.bands.join(',')})으로 풀 수 없습니다.`);
    }
    const seen = keep.map((c) => c.gradeBand);
    if (new Set(seen).size !== seen.length) throw new Error(`${where}: 학년군 열이 겹칩니다(${seen.join(',')}).`);
  }
  const keepCols = new Set(keep.map((c) => c.col));
  const bandOf = new Map(keep.map((c) => [c.col, c.gradeBand]));

  const rows = [];
  for (let r = firstCatRow; r < table.rows; r += 1) {
    const labels = [];
    for (let c = 0; c < valueStart; c += 1) {
      const cell = g[r][c];
      if (cell && !labels.includes(cell)) labels.push(cell);
    }
    const cat = labels.find(isCategory);
    if (!cat) throw new Error(`${where}: ${r}행에 범주 칸이 없습니다.`);
    const others = labels.filter((x) => x !== cat).map((x) => subAreaLabel(x, ctx)).filter(Boolean);
    if (others.length > 1) throw new Error(`${where}: ${r}행 머리 칸이 여럿입니다(${others.join(',')}).`);
    const cells = [];
    const seenCells = new Set();
    for (let c = valueStart; c < valueEnd; c += 1) {
      const cell = g[r][c];
      if (!cell || seenCells.has(cell)) continue;
      seenCells.add(cell);
      if (cell.rowSpan > 1) throw new Error(`${where}: 내용 칸이 여러 행에 걸칩니다(r${cell.row}c${cell.col}).`);
      const bands = [];
      for (let x = cell.col; x < cell.col + cell.colSpan; x += 1) if (keepCols.has(x)) bands.push(bandOf.get(x));
      if (!bands.length) continue;
      if (ctx.columnSubject && cell.colSpan > 1) throw new Error(`${where}: 과목 열을 넘는 병합 칸(r${cell.row}c${cell.col}).`);
      const items = cellItems(cell, `${where} ${r}행`);
      if (items.length) cells.push({ gradeBands: bands, items });
    }
    rows.push({ category: cleanText(labelText(cat)).replace(/\s+/g, ''), ...(others.length ? { subArea: others[0] } : {}), cells });
  }
  return {
    coreIdeas: cellItems(coreValue, `${where} 핵심 아이디어`),
    columns: keep.map((c) => ({ gradeBand: c.gradeBand, label: c.label })),
    rows,
  };
}

/**
 * '가. 내용 체계' 절 → { intro, domains }. 영역 머리글 '(N) 영역명' 다음의 표가 그 영역의 내용 체계다.
 * 머리글이 없는 과목(통합교과)은 표 하나가 대응표의 영역 하나다.
 */
export function parseContentSystem(blocks, from, to, ctx) {
  const intro = [];
  const domains = [];
  let heading = null;
  for (let k = from + 1; k < to; k += 1) {
    const p = blocks[k];
    const t = cleanText(p.text);
    const tables = p.ctrls.filter((c) => c.id === 'tbl ');
    const h = DOMAIN_HEADING.exec(t);
    if (h && !tables.length) {
      heading = { domainNo: h[1].padStart(2, '0'), domainKorean: h[2].trim() };
      continue;
    }
    if (t) {
      if (heading || domains.length) throw new Error(`${ctx.where}: 내용 체계 표 사이의 예상 밖 문단 '${t.slice(0, 40)}'`);
      intro.push(t);
    }
    for (const table of tables) {
      const d = heading ?? (ctx.singleDomain ? { ...ctx.singleDomain } : null);
      if (!d) throw new Error(`${ctx.where}: 영역 머리글 없이 표가 나왔습니다.`);
      if (domains.some((x) => x.domainNo === d.domainNo)) throw new Error(`${ctx.where}: 영역 ${d.domainNo}의 표가 둘입니다.`);
      domains.push({ ...d, ...parseContentTable(table, { ...ctx, where: `${ctx.where} (${Number(d.domainNo)}) ${d.domainKorean}` }) });
      heading = null;
    }
  }
  if (heading) throw new Error(`${ctx.where}: 영역 '${heading.domainKorean}'에 표가 없습니다.`);
  return { intro, domains };
}

function splitLabel(text, labels, where) {
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  const hit = sorted.find((l) => text.startsWith(l) && /^\s/.test(text.slice(l.length)));
  if (!hit) throw new Error(`${where}: 소제목으로 시작하지 않는 문단 '${text.slice(0, 40)}'`);
  return { label: hit, text: text.slice(hit.length).trim() };
}

/**
 * '나. 성취기준' 절 → { intro, sections }. 절(section)은 학년군·영역 하나로 영역 안내(intro)와 묶음들을
 * 갖는다. 묶음(group)은 하위 영역(수학 '① 수의 기초' 등, 없으면 영역 전체) 하나의 성취기준 목록 상자와
 * 그 안내·성취기준 해설·적용 시 고려 사항이다. 해설·고려 사항 문단은 첫머리의 코드([코드], [코드] …)로
 * 성취기준을 가리킨다 — 코드가 없는 고려 사항은 묶음 전체에 해당한다(codes: []).
 * 2026-2호 통합교과처럼 성취기준마다 상자가 따로 있으면 그 상자 다음 문단은 그 성취기준의 것이고
 * 소제목('평가 시 고려 사항' 등)을 label로 나눈다.
 * ctx: { where, bands, singleDomain?, boxText(code) → 출시 원문 }
 */
export function parseStandardNotes(blocks, from, to, ctx) {
  const intro = [];
  const sections = [];
  let band = null;
  let domain = null;
  let subArea = null;
  let section = null;
  let group = null;
  let part = null;
  let current = null; // 현재 상자의 코드(묶음 전체 또는 한 성취기준)
  const where = () => `${ctx.where} ${band ?? ''} ${domain ? `(${Number(domain.domainNo)}) ${domain.domainKorean}` : ''}${subArea ? ` ${subArea.no} ${subArea.name}` : ''}`.replace(/\s+/g, ' ').trim();
  const close = () => { group = null; part = null; current = null; };
  const openSection = () => {
    if (section) return section;
    const d = domain ?? ctx.singleDomain;
    const gb = band ?? (ctx.bands.length === 1 ? ctx.bands[0] : null);
    if (!d || !gb) throw new Error(`${where()}: 학년군·영역 머리글 없이 내용이 나왔습니다.`);
    if (sections.some((s) => s.gradeBand === gb && s.domainNo === d.domainNo)) throw new Error(`${where()}: 같은 학년군·영역 절이 두 번 나왔습니다.`);
    section = { gradeBand: gb, domainNo: d.domainNo, domainKorean: d.domainKorean, intro: [], groups: [] };
    sections.push(section);
    return section;
  };
  const open = () => {
    if (group) return group;
    const s = openSection();
    group = { ...(subArea ? { subArea: { ...subArea } } : {}), intro: [], codes: [], explanations: [], considerations: [] };
    s.groups.push(group);
    return group;
  };
  for (let k = from + 1; k < to; k += 1) {
    const p = blocks[k];
    const t = cleanText(p.text);
    const boxes = p.ctrls.filter((c) => c.id === 'tbl ');
    for (const c of p.ctrls) {
      if (c.id !== 'tbl ' && c.texts?.some((x) => cleanText(x))) throw new Error(`${where()}: 글상자 안 글자 '${cleanText(c.texts.join(' ')).slice(0, 40)}'`);
    }
    let m;
    if (!boxes.length && (m = BAND_HEADING.exec(t))) {
      band = resolveGradeBand(`${m[1]}${m[2]}~${m[3]}`);
      if (!band || !ctx.bands.includes(band)) throw new Error(`${ctx.where}: 학년군 머리글 '${t}'을(를) 풀 수 없습니다.`);
      domain = null; subArea = null; section = null; close();
      continue;
    }
    if (!boxes.length && (m = DOMAIN_HEADING.exec(t)) && !/다\.$/.test(t)) {
      domain = { domainNo: m[1].padStart(2, '0'), domainKorean: m[2].trim() };
      subArea = null; section = null; close();
      continue;
    }
    if (!boxes.length && (m = SUBAREA_HEADING.exec(t))) {
      subArea = { no: String(m[1].codePointAt(0) - 0x2460 + 1), name: m[2].trim() };
      close();
      continue;
    }
    if (PART_GA.test(t) || PART_NA.test(t)) {
      if (!group || !group.codes.length) throw new Error(`${where()}: 성취기준 목록 상자보다 '${t}'이(가) 먼저 나왔습니다.`);
      const next = PART_GA.test(t) ? 'ga' : 'na';
      if (next === 'ga' && part !== null) throw new Error(`${where()}: '(가) 성취기준 해설'이 거듭 나왔습니다.`);
      if (next === 'na' && part === 'na') throw new Error(`${where()}: '(나) 고려 사항'이 거듭 나왔습니다.`);
      part = next;
      continue;
    }
    if (t) {
      if (!band && !domain && !sections.length && !ctx.singleDomain) { intro.push(t); continue; }
      if (part === null) {
        // 하위 영역 머리글 전·상자 전의 문단은 영역 안내, 하위 영역 안의 문단은 그 묶음 안내다.
        if (!group && !subArea) openSection().intro.push(t);
        else open().intro.push(t);
      } else {
        const g = group;
        const lead = CODE_LEAD.exec(t);
        const perStandard = current && current.length < g.codes.length;
        let codes;
        if (lead) codes = parseCodes(lead[1], ctx.codeLeads, ctx.usedCodeLeads);
        else if (part === 'ga') {
          if (current?.length !== 1) throw new Error(`${where()}: 코드 없는 해설 문단(가리킬 성취기준이 하나가 아님) '${t.slice(0, 40)}'`);
          codes = [...current];
        } else codes = perStandard ? [...current] : [];
        const outside = codes.filter((c) => !g.codes.some((x) => canonicalCode(x) === canonicalCode(c)));
        if (outside.length) throw new Error(`${where()}: 묶음 밖 코드 ${outside.join(',')} — '${t.slice(0, 40)}'`);
        const entry = perStandard && !lead
          ? { codes, ...splitLabel(t, part === 'ga' ? EXPLANATION_LABELS : CONSIDERATION_LABELS, where()) }
          : { codes, text: t };
        (part === 'ga' ? g.explanations : g.considerations).push(entry);
      }
    }
    for (const box of boxes) {
      if (box.rows !== 1 || box.cols !== 1) throw new Error(`${where()}: 성취기준 절 안의 ${box.rows}x${box.cols} 표`);
      const codes = [];
      for (const line of cellParas(box.cells[0])) {
        const bm = BOX_LINE.exec(line);
        if (!bm) throw new Error(`${where()}: 목록 상자 문단이 코드로 시작하지 않습니다 '${line.slice(0, 30)}'`);
        const code = normalizeCode(bm[1]);
        const shipped = ctx.boxText(code);
        if (shipped === undefined) throw new Error(`${where()}: 출시 데이터에 없는 성취기준 ${code}`);
        if (shipped.replace(/\s+/g, '') !== cleanText(bm[2]).replace(/\s+/g, '')) {
          throw new Error(`${where()}: ${code} 목록 상자 원문이 출시 원문과 다릅니다.\n  HWP: ${cleanText(bm[2])}\n  출시: ${shipped}`);
        }
        codes.push(code);
      }
      const g = open();
      if (!g.codes.length) { g.codes = codes; current = codes; part = null; continue; }
      const sub = codes.every((c) => g.codes.includes(c));
      if (!sub) throw new Error(`${where()}: 한 묶음 안에 다른 성취기준 상자(${codes.join(',')})`);
      current = codes;
      part = null;
    }
  }
  for (const s of sections) {
    if (!s.groups.length) throw new Error(`${ctx.where} ${s.gradeBand} ${s.domainKorean}: 성취기준 목록 상자가 없습니다.`);
    for (const g of s.groups) {
      if (!g.codes.length) throw new Error(`${ctx.where} ${s.gradeBand} ${s.domainKorean} ${g.subArea?.name ?? ''}: 성취기준 목록 상자가 없습니다.`);
    }
  }
  return { intro, sections };
}

/** 해설 묶음을 절 정보(학년군·영역)와 함께 펼친다. */
export function* eachGroup(notes) {
  for (const s of notes.sections) for (const g of s.groups) yield { section: s, group: g };
}

/** 과목 하나: 내용 체계 + 해설·고려 사항. ctx: { subject, bands, standards(그 과목·판 성취기준), texts } */
export function parseSubject(blocks, section, ctx) {
  const singleDomain = ctx.subject.domainKorean ? { domainNo: '01', domainKorean: ctx.subject.domainKorean } : null;
  const base = { where: `${ctx.subject.subjectKorean}${ctx.edition ? `(${ctx.edition})` : ''}`, bands: ctx.bands, singleDomain };
  const cs = parseContentSystem(blocks, section.a, section.b, { ...base, columnSubject: ctx.columnSubject, verticalLabels: ctx.verticalLabels, usedVerticalLabels: ctx.usedVerticalLabels });
  const notes = parseStandardNotes(blocks, section.b, section.end, { ...base, boxText: ctx.boxText, codeLeads: ctx.codeLeads, usedCodeLeads: ctx.usedCodeLeads });
  return { contentSystem: cs, notes };
}

/** 추출 결과를 출시 성취기준과 맞춰 본다 — 영역 이름·번호, 상자 코드 전량·1회, 통합교과 표의 성취기준 열. */
export function checkAgainstStandards(subjectId, parsed, standards, where) {
  const errors = [];
  const byCode = new Map(standards.map((s) => [canonicalCode(s.code), s]));
  const domains = new Map(standards.map((s) => [s.domainNo, s.domainKorean]));
  const sameName = (a, b) => normalizeWhitespace(a).replace(/\s+/g, '') === normalizeWhitespace(b).replace(/\s+/g, '');
  const csDomains = parsed.contentSystem.domains;
  for (const d of csDomains) {
    if (!domains.has(d.domainNo)) errors.push(`${where}: 내용 체계 영역 ${d.domainNo} ${d.domainKorean}이(가) 성취기준에 없습니다.`);
    else if (!sameName(domains.get(d.domainNo), d.domainKorean)) errors.push(`${where}: 영역 ${d.domainNo} 이름 불일치 — 내용 체계 '${d.domainKorean}', 성취기준 '${domains.get(d.domainNo)}'`);
    if (d.standardCodes) {
      const want = standards.map((s) => canonicalCode(s.code)).sort().join(',');
      const got = d.standardCodes.map(canonicalCode).sort().join(',');
      if (want !== got) errors.push(`${where}: 내용 체계 표의 성취기준 열이 성취기준 목록과 다릅니다.`);
    }
  }
  for (const no of domains.keys()) if (!csDomains.some((d) => d.domainNo === no)) errors.push(`${where}: 영역 ${no}의 내용 체계 표가 없습니다.`);
  const seen = new Map();
  for (const sec of parsed.notes.sections) {
    if (!sameName(domains.get(sec.domainNo) ?? '', sec.domainKorean)) errors.push(`${where}: 해설 절 영역 '${sec.domainKorean}'이(가) 성취기준 영역 '${domains.get(sec.domainNo)}'과 다릅니다.`);
    for (const g of sec.groups) {
      for (const c of g.codes) {
        const s = byCode.get(canonicalCode(c));
        if (!s) { errors.push(`${where}: 상자 코드 ${c}이(가) 이 과목 성취기준에 없습니다.`); continue; }
        seen.set(canonicalCode(c), (seen.get(canonicalCode(c)) ?? 0) + 1);
        if (s.gradeBand !== sec.gradeBand || s.domainNo !== sec.domainNo) errors.push(`${where}: ${c}의 학년군·영역(${s.gradeBand} ${s.domainNo})이 절(${sec.gradeBand} ${sec.domainNo})과 다릅니다.`);
      }
    }
  }
  for (const [code] of byCode) {
    const n = seen.get(code) ?? 0;
    if (n !== 1) errors.push(`${where}: ${code}이(가) 성취기준 목록 상자에 ${n}번 나옵니다(1번이어야 함).`);
  }
  return errors;
}

/** PDF(-layout·-raw) 글자 대조: 추출한 모든 문장·항목이 공백을 빼고 PDF 어딘가에 그대로 있어야 한다. */
export function crossCheckDetails(subjects, pdfLayout, pdfRaw) {
  const prep = (s) => normalizeWhitespace(stripPageFurniture(s)).replace(PDF_SYMBOL_ARTIFACTS, '').replace(/\s+/g, '');
  const hay = [prep(pdfLayout), prep(pdfRaw)];
  const missing = [];
  const check = (label, text) => {
    const needle = pdfForm(text).replace(/\s+/g, '');
    if (needle && !hay.some((h) => h.includes(needle))) missing.push(`${label}: ${text.slice(0, 60)}`);
  };
  for (const s of subjects) {
    const w = s.subjectKorean;
    for (const t of s.contentSystem.intro) check(`${w} 내용 체계 안내`, t);
    for (const d of s.contentSystem.domains) {
      d.coreIdeas.forEach((t) => check(`${w} ${d.domainKorean} 핵심 아이디어`, t));
      for (const r of d.rows) {
        if (r.subArea) check(`${w} ${d.domainKorean} 하위 영역`, r.subArea);
        for (const c of r.cells) c.items.forEach((t) => check(`${w} ${d.domainKorean} ${r.category}`, t));
      }
    }
    for (const t of s.notes.intro) check(`${w} 성취기준 안내`, t);
    for (const sec of s.notes.sections) {
      const ws = `${w} ${sec.gradeBand} ${sec.domainKorean}`;
      sec.intro.forEach((t) => check(`${ws} 영역 안내`, t));
      for (const g of sec.groups) {
        if (g.subArea) check(`${ws} 하위 영역 머리글`, g.subArea.name);
        g.intro.forEach((t) => check(`${ws} ${g.subArea?.name ?? ''} 안내`, t));
        for (const e of [...g.explanations, ...g.considerations]) check(`${ws} ${e.codes.join(',')}`, e.label ? `${e.label} ${e.text}` : e.text);
      }
    }
  }
  return missing;
}

/**
 * 두 판 비교(양방향): include 밖·currentOnly 밖 과목은 내용 체계·해설이 같아야 한다.
 * 이전 판의 통합교과 내용 체계는 세 과목을 한 표에 나란히 실었으므로 과목 열만 비교한다.
 */
/** 과목 추출 결과를 [이름표, 글자] 목록으로 편다 — 판본 비교·차이 보고용. */
export function flattenDetails(s) {
  const out = [];
  s.contentSystem.intro.forEach((t, i) => out.push([`내용 체계 안내 ${i + 1}`, t]));
  for (const d of s.contentSystem.domains) {
    out.push([`${d.domainKorean} 핵심 아이디어`, d.coreIdeas.join(' / ')]);
    for (const r of d.rows) out.push([`${d.domainKorean} ${r.subArea ?? ''} ${r.category}`, r.cells.map((c) => `${c.gradeBands.join('+')}: ${c.items.join(' / ')}`).join(' | ')]);
  }
  s.notes.intro.forEach((t, i) => out.push([`성취기준 안내 ${i + 1}`, t]));
  for (const { section: sec, group: g } of eachGroup(s.notes)) {
    if (sec.groups[0] === g) sec.intro.forEach((t, i) => out.push([`${sec.gradeBand} ${sec.domainKorean} 영역 안내 ${i + 1}`, t]));
    const w = `${sec.gradeBand} ${sec.domainKorean}${g.subArea ? ` ${g.subArea.name}` : ''}`;
    out.push([`${w} 상자`, g.codes.join(',')]);
    g.intro.forEach((t, i) => out.push([`${w} 안내 ${i + 1}`, t]));
    g.explanations.forEach((e, i) => out.push([`${w} 해설 ${i + 1}`, `${e.codes.join(',')} ${e.label ?? ''} ${e.text}`]));
    g.considerations.forEach((e, i) => out.push([`${w} 고려 사항 ${i + 1}`, `${e.codes.join(',')} ${e.label ?? ''} ${e.text}`]));
  }
  return out;
}

export function compareEditions(current, previous, { includeIds, currentOnlyIds }) {
  const errors = [];
  const flat = flattenDetails;
  const diff = (a, b) => {
    const fa = flat(a);
    const fb = flat(b);
    for (let i = 0; i < Math.max(fa.length, fb.length); i += 1) {
      const [la, ta] = fa[i] ?? ['(없음)', ''];
      const [lb, tb] = fb[i] ?? ['(없음)', ''];
      if (la !== lb || ta !== tb) return `${la === lb ? la : `${la} ↔ ${lb}`}: 최신 '${ta.slice(0, 50)}' / 이전 '${tb.slice(0, 50)}'`;
    }
    return null;
  };
  const prevById = new Map(previous.map((s) => [s.subjectId, s]));
  for (const cur of current) {
    if (includeIds.has(cur.subjectId)) continue;
    const prev = prevById.get(cur.subjectId);
    if (currentOnlyIds.has(cur.subjectId)) {
      if (prev) errors.push(`${cur.subjectKorean}: 최신 판에서 신설된 과목인데 이전 판에도 있습니다.`);
      continue;
    }
    if (!prev) { errors.push(`${cur.subjectKorean}: 이전 판에 없습니다.`); continue; }
    const d = diff(cur, prev);
    if (d) errors.push(`${cur.subjectKorean}: 두 판의 내용 체계·해설이 다릅니다 — ${d}`);
  }
  for (const prev of previous) {
    if (!current.some((c) => c.subjectId === prev.subjectId)) errors.push(`${prev.subjectKorean}: 이전 판에만 있습니다.`);
  }
  return errors;
}

export function detailCounts(subjects) {
  const cur = subjects.filter((s) => !s.edition);
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const items = (s) => sum(s.contentSystem.domains, (d) => d.coreIdeas.length + sum(d.rows, (r) => sum(r.cells, (c) => c.items.length)));
  const explained = new Set();
  for (const s of cur) for (const { group: g } of eachGroup(s.notes)) for (const e of g.explanations) e.codes.forEach((c) => explained.add(canonicalCode(c)));
  const groups = (s) => [...eachGroup(s.notes)].map((x) => x.group);
  return {
    contentSystemSubjects: cur.length,
    contentSystemDomains: sum(cur, (s) => s.contentSystem.domains.length),
    contentItems: sum(cur, items),
    noteSections: sum(cur, (s) => s.notes.sections.length),
    noteGroups: sum(cur, (s) => groups(s).length),
    explanations: sum(cur, (s) => sum(groups(s), (g) => g.explanations.length)),
    considerations: sum(cur, (s) => sum(groups(s), (g) => g.considerations.length)),
    standardsWithExplanation: explained.size,
    previousEdition: Object.fromEntries(subjects.filter((s) => s.edition).sort((a, b) => a.subjectId.localeCompare(b.subjectId, 'en')).map((s) => [s.subjectId, {
      contentItems: items(s),
      explanations: sum(groups(s), (g) => g.explanations.length),
      considerations: sum(groups(s), (g) => g.considerations.length),
    }])),
  };
}

function pdftotext(path, mode) {
  return execFileSync('pdftotext', ['-enc', 'UTF-8', mode, path, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

/** 한 판의 HWP 전체 → 과목별 추출 결과. */
export function extractEdition({ blocks, mappings, subjectsById, standards, texts, edition, combinedIntegrated, codeLeads = {}, usedCodeLeads = new Set(), verticalLabels = {}, usedVerticalLabels = new Set() }) {
  const out = [];
  const errors = [];
  for (const section of findSubjectSections(blocks)) {
    const prefix = sectionPrefix(blocks, section);
    const map = mappings[prefix];
    if (!map) throw new Error(`대응표에 없는 접두어 '${prefix}'`);
    const subject = subjectsById.get(map.id);
    const mine = standards.filter((s) => s.subjectId === map.id && (s.edition ?? null) === (edition ?? null));
    const bands = subject?.gradeBands ?? [...new Set(mine.map((s) => s.gradeBand))];
    const textByCode = new Map(mine.map((s) => [canonicalCode(s.code), texts.get(s.key)]));
    const ctx = {
      subject: { ...map, subjectKorean: map.subjectKorean }, bands, edition,
      columnSubject: combinedIntegrated && map.domainKorean ? map.subjectKorean : undefined,
      boxText: (code) => textByCode.get(canonicalCode(code)),
      codeLeads, usedCodeLeads, verticalLabels, usedVerticalLabels,
    };
    const parsed = parseSubject(blocks, section, ctx);
    const where = `${map.subjectKorean}${edition ? `(${edition})` : ''}`;
    errors.push(...checkAgainstStandards(map.id, parsed, mine, where));
    out.push({ subjectId: map.id, subjectKorean: map.subjectKorean, ...parsed });
  }
  return { subjects: out, errors };
}

function main() {
  const recordGates = process.argv.includes('--record-gates');
  const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
  const paths = JSON.parse(readFileSync(join(repoRoot, '.cache', 'pdf-paths.json'), 'utf8'));
  const { mappings } = JSON.parse(readFileSync(join(here, 'subjects.json'), 'utf8'));
  const { codeLeads, verticalLabels } = JSON.parse(readFileSync(join(here, 'details-exceptions.json'), 'utf8'));
  const usedCodeLeads = new Set();
  const usedVerticalLabels = new Set();
  const exceptions = { codeLeads, usedCodeLeads, verticalLabels, usedVerticalLabels };
  const dataDir = join(repoRoot, 'data', 'kr');
  const { subjects } = JSON.parse(readFileSync(join(dataDir, 'subjects.json'), 'utf8'));
  const { standards } = JSON.parse(readFileSync(join(dataDir, 'basic', 'curriculum-standards.json'), 'utf8'));
  const texts = new Map(JSON.parse(readFileSync(join(dataDir, 'basic', 'standard-texts.json'), 'utf8')).texts.map((t) => [t.key, t.text]));
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));

  const src = sources.annexes.find((a) => a.role === 'details');
  const prevSrc = sources.annexes.find((a) => a.role === 'details-previous');
  const pdfSrc = sources.annexes.find((a) => a.role === 'standards');
  const prevPdfSrc = sources.annexes.find((a) => a.role === 'standards-previous');
  for (const s of [src, pdfSrc, prevSrc, prevPdfSrc].filter(Boolean)) {
    if (!paths[s.id]) throw new Error(`${s.id} 파일 경로가 없습니다 — pipeline:fetch를 먼저 실행하세요.`);
  }

  const fail = (title, list) => {
    if (!list.length) return;
    console.error(`✗ ${title} ${list.length}건:`);
    for (const m of list.slice(0, 40)) console.error(`  - ${m}`);
    process.exit(1);
  };

  const blocks = hwpBlocks(readFileSync(paths[src.id]));
  const cur = extractEdition({ blocks, mappings, subjectsById, standards, texts, ...exceptions });
  fail('성취기준 대조 실패', cur.errors);
  if (cur.subjects.length !== subjects.length) fail('과목 수 불일치', [`HWP ${cur.subjects.length}과목, 출시 ${subjects.length}과목`]);
  fail('PDF 대조 실패(최신 판)', crossCheckDetails(cur.subjects, pdftotext(paths[pdfSrc.id], '-layout'), pdftotext(paths[pdfSrc.id], '-raw')));

  let prevSubjects = [];
  if (prevSrc) {
    // 이전 판 성취기준이 따로 있는 과목(standards-previous include)과 내용 체계·해설이 다른 과목(details-previous
    // include)은 다를 수 있다 — 2026-2호는 바른 생활·슬기로운 생활의 성취기준은 그대로 두고 해설 문구만 다듬었다.
    const prefixOf = (code) => normalizeCode(code).replace(/^\[\d+/, '').slice(0, 2);
    const stdInclude = new Set(prevPdfSrc?.include?.prefixes ?? []);
    const include = new Set(prevSrc.include?.prefixes ?? []);
    const notListed = [...stdInclude].filter((p) => !include.has(p));
    fail('이전 판 설정 오류', notListed.map((p) => `성취기준 이전 판 과목 '${p}'이(가) details-previous include에 없습니다.`));
    const currentOnly = new Set(prevPdfSrc?.currentOnly?.prefixes ?? []);
    const idsOf = (set) => new Set([...set].map((p) => mappings[p].id));
    const prevBlocks = hwpBlocks(readFileSync(paths[prevSrc.id]));
    // 비교를 위해 이전 판 전 과목을 뽑는다. 이전 판 성취기준은 stdInclude 과목만 따로 있고, 나머지는 최신 판과 같다.
    const prevStandards = standards.filter((s) => s.edition === prevSrc.edition
      || (!s.edition && !stdInclude.has(prefixOf(s.code)) && !currentOnly.has(prefixOf(s.code))));
    const asPrev = prevStandards.map((s) => (s.edition ? s : { ...s, edition: prevSrc.edition }));
    const all = extractEdition({
      blocks: prevBlocks, mappings, subjectsById, standards: asPrev, texts, edition: prevSrc.edition, combinedIntegrated: true, ...exceptions,
    });
    fail('성취기준 대조 실패(이전 판)', all.errors);
    fail('판본 비교 실패', compareEditions(cur.subjects, all.subjects, { includeIds: idsOf(include), currentOnlyIds: idsOf(currentOnly) }));
    prevSubjects = all.subjects.filter((s) => idsOf(include).has(s.subjectId));
    if (prevSubjects.length !== include.size) fail('이전 판 과목 누락', [`include ${include.size}과목 중 ${prevSubjects.length}과목만 이전 판 HWP에서 찾았습니다.`]);
    // include 과목은 실제로 달라야 한다 — 같은데 include에 두면 같은 내용을 두 번 싣게 된다.
    const curById = new Map(cur.subjects.map((s) => [s.subjectId, s]));
    const same = prevSubjects.filter((p) => curById.has(p.subjectId)
      && JSON.stringify(flattenDetails(p)) === JSON.stringify(flattenDetails(curById.get(p.subjectId))));
    fail('이전 판 설정 오류', same.map((s) => `${s.subjectKorean}: 두 판의 내용 체계·해설이 같은데 include에 있습니다.`));
    fail('PDF 대조 실패(이전 판)', crossCheckDetails(prevSubjects, pdftotext(paths[prevPdfSrc.id], '-layout'), pdftotext(paths[prevPdfSrc.id], '-raw')));
    prevSubjects = prevSubjects.map((s) => ({ ...s, edition: prevSrc.edition, editionNote: prevSrc.editionNote, sourceId: prevSrc.id }));
  }

  fail('예외표 정리 필요', [
    ...Object.keys(codeLeads).filter((k) => !usedCodeLeads.has(k)).map((k) => `details-exceptions.json codeLeads '${k}'이(가) 쓰이지 않습니다.`),
    ...Object.keys(verticalLabels).filter((k) => !usedVerticalLabels.has(k)).map((k) => `details-exceptions.json verticalLabels '${k}'이(가) 쓰이지 않습니다.`),
  ]);
  const all = [...cur.subjects.map((s) => ({ ...s, sourceId: src.id })), ...prevSubjects];
  const order = (a, b) => a.subjectId.localeCompare(b.subjectId, 'en') || (a.edition ? 1 : 0) - (b.edition ? 1 : 0);
  const head = (s) => ({ subjectId: s.subjectId, subjectKorean: s.subjectKorean, sourceId: s.sourceId, ...(s.edition ? { edition: s.edition, editionNote: s.editionNote } : {}) });
  const sourceNote = `${src.notice} 【별책 3】 기본 교육과정 HWP에서 추출하고 같은 고시의 PDF와 글자 대조한 원문. 저작권법 제7조에 따라 보호받지 않는 고시 원문이며 정확성·추적성을 위해 출처를 표기한다.`;
  const contentSystems = {
    version: 'kr-special-content-systems-v1', category: 'basic', sourceNote,
    subjects: [...all].sort(order).map((s) => ({
      ...head(s),
      intro: s.contentSystem.intro,
      domains: s.contentSystem.domains.map(({ standardCodes, ...d }) => d),
    })),
  };
  const standardNotes = {
    version: 'kr-special-standard-notes-v1', category: 'basic', sourceNote,
    subjects: [...all].sort(order).map((s) => ({ ...head(s), intro: s.notes.intro, sections: s.notes.sections })),
  };
  writeFileSync(join(dataDir, 'basic', 'content-systems.json'), `${JSON.stringify(contentSystems, null, 1)}\n`);
  writeFileSync(join(dataDir, 'basic', 'standard-notes.json'), `${JSON.stringify(standardNotes, null, 1)}\n`);
  const counts = detailCounts(all);
  console.error(`✓ 내용 체계 ${counts.contentSystemSubjects}과목 ${counts.contentSystemDomains}영역 항목 ${counts.contentItems}개 · 해설 ${counts.explanations}문단(성취기준 ${counts.standardsWithExplanation}개) · 고려 사항 ${counts.considerations}문단 (PDF 대조·판본 비교 통과)`);
  if (recordGates) {
    const gatesPath = join(here, 'gates.json');
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8'));
    gates.details = counts;
    writeFileSync(gatesPath, `${JSON.stringify(gates, null, 1)}\n`);
    console.error('✓ pipeline/gates.json details 갱신');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
