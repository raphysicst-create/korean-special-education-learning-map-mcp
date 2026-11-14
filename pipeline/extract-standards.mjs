#!/usr/bin/env node
// 별책 PDF에서 성취기준 골격(코드·학년군·영역·과목)과 원문을 한 번에 추출한다.
// 직업계 MCP와 달리 상류 골격 데이터(DECK6)가 없으므로 코드 목록도 PDF에서 직접 찾는다.
//
//   npm run pipeline:discover  — 코드 접두어·학년군·영역 실측 보고서만 .cache/discovery-report.json에 쓴다
//   npm run pipeline:extract   — pipeline/subjects.json 대응표로 data/kr/ 산출물을 쓴다
//   npm run pipeline:extract -- --record-gates — 산출 수량을 pipeline/gates.json에 기록
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_SOURCE, GRADE_BANDS, canonicalCode, gradeBandByCode, normalizeCode, normalizeRoman,
} from '../src/normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

export const MAX_TEXT = 700;
const FALLBACK_WINDOW = 1200;
const PAGE_NUMBER_LINE = /^(?:\d{1,4}|[ivxlcdm]{1,7})$/i;
const RUNNING_HEAD_MIN_REPEAT = 3;
export const UNMAPPED_GLYPH = /[-�]/;

// 성취기준 본문 뒤에 붙는 절(해설·고려 사항·다음 영역·다음 학년군·교수학습)을 잘라낸다.
// 2022 개정 교과 교육과정 공통 조판 기준의 초안이다 — 실측 후 보강할 것.
const SECTION_CUT_PATTERNS = [
  /\(\s*[가나다라]\s*\)/,
  /성취기준\s*해설/,
  /적용\s*시\s*고려/,
  /<\s*성취기준/,
  /<\s*[가-힣]{1,4}\s*활동\s*>/,
  // 다음 영역 머리글 '(2) 읽기' — 줄 첫머리만.
  /(?:^|\n)[ \t]*\(\s*\d{1,2}\s*\)\s*\S/,
  // 학년군 머리글 '[초등학교 3~4학년]'·'[중학교 1~3학년]'.
  /(?:^|\n)[ \t]*\[\s*(?:초등학교|중학교|고등학교)/,
  // 해설·고려 사항 글머리표.
  /(?:^|\n)[ \t]*[•◦▪○●]/,
  /(?:^|\n)[ \t]*\d\s*\.\s*교수/,
  // 다음 성취기준 코드 행(다른 접두어라 목록에서 빠졌을 때의 안전망).
  new RegExp(`(?:^|\\n)[ \\t]*${CODE_SOURCE}`),
];
const SECTION_CUT_PATTERNS_G = SECTION_CUT_PATTERNS.map((p) => new RegExp(p.source, `${p.flags}g`));
const DOMAIN_HEADING = /^[ \t]*\(\s*(\d{1,2})\s*\)\s*([^\n]{1,40}?)\s*$/gm;

// 가운뎃점 이형(U+30FB·FF65·22C5·2219, 한글 아래아 U+318D)은 PDF 글꼴에 따라 섞여 나온다
// — U+00B7로 통일한다. 원문 표기의 '보이는 글자'는 바뀌지 않는다.
const MIDDLE_DOTS = /[・･⋅∙ㆍ]/g;

export function normalizeWhitespace(value) {
  return value.normalize('NFC').replace(MIDDLE_DOTS, '·').replace(/\s+/g, ' ').trim();
}

/** pdftotext -layout 출력에서 반복 머리글·쪽 번호를 제거한다(직업계 MCP와 동일 규칙). */
export function stripPageFurniture(rawText) {
  const pages = rawText.split('\f');
  if (pages.length < RUNNING_HEAD_MIN_REPEAT) return rawText;
  const headCount = new Map();
  for (const page of pages) {
    const first = page.split(/\r?\n/).find((line) => line.trim());
    if (first) headCount.set(first.trim(), (headCount.get(first.trim()) ?? 0) + 1);
  }
  return pages
    .map((page) => {
      const lines = page.split(/\r?\n/);
      let start = 0;
      while (start < lines.length && !lines[start].trim()) start += 1;
      if (start < lines.length && (headCount.get(lines[start].trim()) ?? 0) >= RUNNING_HEAD_MIN_REPEAT) {
        lines[start] = '';
      }
      let end = lines.length - 1;
      while (end >= 0 && !lines[end].trim()) end -= 1;
      if (end >= 0 && PAGE_NUMBER_LINE.test(lines[end].trim())) lines[end] = '';
      return lines.join('\n');
    })
    .join('\n');
}

// 성취기준 목록은 줄 첫머리(들여쓰기 0~1칸)에 놓인다. 내용 체계 표의 '성취기준' 열은
// 40칸 넘게 들여써져 나오므로(2026-2호 통합교과 실측) 들여쓰기로 걸러낸다.
export const MAX_LIST_INDENT = 8;

/** 줄 첫머리면 들여쓰기 칸 수, 아니면 -1. */
function lineIndent(text, idx) {
  let indent = 0;
  for (let i = idx - 1; i >= 0 && text[i] !== '\n'; i -= 1) {
    if (!/\s/.test(text[i])) return -1;
    indent += 1;
  }
  return indent;
}

function hasUnclosedParen(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '（') depth += 1;
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

export function sliceStandardText(fullText, startIdx, endIdx) {
  let chunk = fullText.slice(startIdx, endIdx);
  for (const pattern of SECTION_CUT_PATTERNS_G) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(chunk)) !== null) {
      if (!hasUnclosedParen(chunk.slice(0, m.index))) {
        chunk = chunk.slice(0, m.index);
        break;
      }
      pattern.lastIndex = m.index + 1;
    }
  }
  return normalizeWhitespace(chunk);
}

// 코드 바로 뒤에 붙은 조사 — '[4국01-01]과 연계하여' 같은 상호참조를 가른다. 조사 뒤가
// 공백·문장부호·끝일 때만 조사로 본다 — '[6실과01-02]가정생활에 …'의 '가'는 조사가 아니다.
const PARTICLE_AFTER_CODE =
  /^(?:(?:은|는|이|가|과|와|을|를|의|에|로|으로|및|도|만|에서|에게|에는|에도|과의|와의|까지|부터|처럼|보다)(?=[\s,.)·]|$)|[,.)·~∼-])/;

/**
 * 줄 첫머리(들여쓰기 MAX_LIST_INDENT 이하)의 코드를 성취기준 목록 항목으로 본다.
 * 해설의 '• [4국01-01] …', 내용 체계 표 속 코드는 줄 첫머리가 아니거나 들여쓰기가 깊어 빠진다.
 * 코드 뒤 공백이 빠진 '[12진로06-01]자신이 …'도 받되, 뒤에 조사가 붙은 상호참조
 * '[4국01-01]과 연계하여'는 버리고 rejected로 돌려준다(목록 항목이 따로 없으면 누락 의심).
 */
export function findListCodes(norm) {
  return scanListCodes(norm).codes;
}

function scanListCodes(norm) {
  const re = new RegExp(CODE_SOURCE, 'g');
  const codes = [];
  const rejected = [];
  let m;
  while ((m = re.exec(norm)) !== null) {
    const indent = lineIndent(norm, m.index);
    if (indent < 0 || indent > MAX_LIST_INDENT) continue;
    const end = m.index + m[0].length;
    const after = norm[end];
    const entry = {
      code: normalizeCode(m[0]),
      bandCode: m[1], prefix: m[2], domainNo: m[3], itemNo: m[4],
      start: m.index, end,
    };
    if (after === undefined || /\s/.test(after) || !PARTICLE_AFTER_CODE.test(norm.slice(end, end + 4))) {
      codes.push(entry);
    } else {
      rejected.push({ code: entry.code, context: normalizeWhitespace(norm.slice(m.index, end + 30)) });
    }
  }
  return { codes, rejected };
}

// '3. 교수·학습 및 평가' 절의 번호 머리글 — 영역이 아니다.
const NON_DOMAIN_HEADING = /^(?:교수·학습|평가)/;

export function findDomainHeadings(norm) {
  const out = [];
  DOMAIN_HEADING.lastIndex = 0;
  let m;
  while ((m = DOMAIN_HEADING.exec(norm)) !== null) {
    const name = normalizeWhitespace(m[2]);
    // 머리글은 짧은 명사구다 — 문장 종결이나 코드가 섞이면 머리글이 아니다.
    if (!name || /[다.]$/.test(name) || /\[/.test(name) || NON_DOMAIN_HEADING.test(name)) continue;
    out.push({ number: Number(m[1]), name, start: m.index });
  }
  return out;
}

// 과목마다 '2. 내용 체계 및 성취기준'(과학은 '내용 체계와 성취기준') 절이 있다. 영역 머리글은
// 이 절 안에서만 찾는다 — 앞 과목의 꼬리 절이나 목표 목록의 '(1) …'이 새어 들지 않게 한다.
const STANDARDS_SECTION = /^[ \t]*\d\s*\.\s*내용\s*체계\s*(?:및|와|과)\s*성취기준/gm;

export function findStandardsSections(norm) {
  STANDARDS_SECTION.lastIndex = 0;
  return [...norm.matchAll(STANDARDS_SECTION)].map((m) => m.index);
}

/** 코드 앞쪽, 같은 성취기준 절 안에서 영역 번호가 일치하는 가장 가까운 머리글을 찾는다. */
function domainFor(headings, pos, floor) {
  const target = Number(pos.domainNo);
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    const h = headings[i];
    if (h.start >= pos.start) continue;
    if (h.start < floor) break;
    if (h.number === target) return h.name;
  }
  return null;
}

/**
 * 원시 PDF 텍스트 → 성취기준 레코드(과목 미배정). 같은 코드(canonicalCode 기준 — '[09…]'와
 * '[9…]'는 같은 코드)가 목록 항목으로 두 번 이상 나오면 첫 번째를 쓰고 duplicates로 보고한다.
 * 통합교과는 목록 뒤에 성취기준마다 해설 머리로 코드·원문을 한 번 더 싣는다 — 원문이 같으면
 * sameText(무해), 다르면 충돌로 buildDataset이 출시를 막는다.
 * rejected: 조사가 붙어 버린 줄 첫머리 코드 중 목록 항목으로는 한 번도 나오지 않은 것(누락 의심).
 */
export function extractStandards(pdfText) {
  const norm = normalizeRoman(stripPageFurniture(pdfText).normalize('NFC'));
  const { codes, rejected } = scanListCodes(norm);
  const headings = findDomainHeadings(norm);
  const sections = findStandardsSections(norm);
  const records = [];
  const seen = new Map();
  const duplicates = [];
  for (const [i, pos] of codes.entries()) {
    const floor = sections.filter((s) => s < pos.start).at(-1) ?? 0;
    const next = codes[i + 1];
    const endIdx = next ? next.start : Math.min(norm.length, pos.end + FALLBACK_WINDOW);
    const text = sliceStandardText(norm, pos.end, endIdx);
    const canon = canonicalCode(pos.code);
    if (seen.has(canon)) {
      const first = seen.get(canon);
      duplicates.push({ code: pos.code, firstCode: first.code, sameText: first.text === text, text });
      continue;
    }
    const record = {
      code: pos.code, bandCode: pos.bandCode, prefix: pos.prefix,
      domainNo: pos.domainNo, itemNo: pos.itemNo,
      domainKorean: domainFor(headings, pos, floor), text, offset: pos.start,
    };
    seen.set(canon, record);
    records.push(record);
  }
  const unresolved = rejected.filter((r) => !seen.has(canonicalCode(r.code)));
  return { records, duplicates, rejected: unresolved };
}

/** 과목·학년군·영역마다 순번이 01부터 빠짐없이 이어지는지 본다(중간 누락 탐지). */
export function numberingGaps(items) {
  const groups = new Map();
  for (const r of items) {
    const k = `${r.prefix ?? r.subjectId}|${r.bandCode ?? r.gradeBand}|${r.domainNo}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(Number(r.itemNo));
  }
  const gaps = [];
  for (const [group, nums] of groups) {
    const have = new Set(nums);
    const missing = [];
    for (let n = 1; n <= Math.max(...nums); n += 1) if (!have.has(n)) missing.push(n);
    if (missing.length) gaps.push({ group, missing });
  }
  return gaps;
}

/** 실측 보고서: 과목 대응표를 사람이 채우기 위한 근거. */
export function discoveryReport(records, duplicates, rejected = []) {
  const byPrefix = new Map();
  for (const r of records) {
    if (!byPrefix.has(r.prefix)) {
      byPrefix.set(r.prefix, { prefix: r.prefix, count: 0, bandCodes: new Set(), domains: new Set(), samples: [] });
    }
    const p = byPrefix.get(r.prefix);
    p.count += 1;
    p.bandCodes.add(r.bandCode);
    if (r.domainKorean) p.domains.add(r.domainKorean);
    if (p.samples.length < 3) p.samples.push({ code: r.code, text: r.text.slice(0, 80) });
  }
  const knownBands = new Set(GRADE_BANDS.flatMap((b) => [b.code, ...(b.aliases ?? [])]));
  return {
    totalStandards: records.length,
    repeatedCodes: [...new Set(duplicates.filter((d) => d.sameText).map((d) => d.code))],
    duplicateCodes: [...new Set(duplicates.filter((d) => !d.sameText).map((d) => d.code))],
    rejectedCodes: rejected,
    numberingGaps: numberingGaps(records),
    unknownBandCodes: [...new Set(records.map((r) => r.bandCode).filter((c) => !knownBands.has(c)))],
    missingDomain: records.filter((r) => !r.domainKorean).map((r) => r.code),
    suspicious: records
      .filter((r) => !r.text || r.text.length > MAX_TEXT || UNMAPPED_GLYPH.test(r.text))
      .map((r) => ({ code: r.code, length: r.text.length, preview: r.text.slice(0, 80) })),
    prefixes: [...byPrefix.values()].map((p) => ({
      ...p, bandCodes: [...p.bandCodes].sort((a, b) => a - b || a.localeCompare(b)), domains: [...p.domains],
    })),
  };
}

/**
 * 레코드 + 과목 대응표 + 수동 예외 → 출시 데이터. 원문이 확보되지 않은 성취기준은
 * 출시하지 않고 failures로 돌려준다(원문 범위 = 출시 범위). 같은 코드가 다른 원문으로 두 번
 * 나온 충돌(duplicates 중 sameText=false)은 exceptions에 원문을 적어 확정하기 전까지 출시하지 않는다.
 */
export function buildDataset(records, { category, sourceId, mappings, exceptions = {}, duplicates = [] }) {
  const failures = [];
  const standards = [];
  const texts = [];
  const subjects = new Map();
  const conflicts = new Set(duplicates.filter((d) => !d.sameText).map((d) => canonicalCode(d.code)));
  for (const r of records) {
    const map = mappings[r.prefix];
    if (!map) { failures.push({ code: r.code, reason: 'unmapped-prefix', prefix: r.prefix }); continue; }
    const band = gradeBandByCode(r.bandCode);
    if (!band) { failures.push({ code: r.code, reason: 'unknown-grade-band', bandCode: r.bandCode }); continue; }
    const key = `${category}:${r.code}`;
    const override = exceptions[key] ?? exceptions[r.code];
    // 예외 값은 원문 문자열이거나 { text?, domainKorean? } — domainKorean만 고칠 수도 있다.
    const overrideText = typeof override === 'string' ? override : override?.text;
    const text = overrideText ?? r.text;
    if (conflicts.has(canonicalCode(r.code)) && overrideText === undefined) {
      const later = duplicates.find((d) => !d.sameText && canonicalCode(d.code) === canonicalCode(r.code));
      failures.push({ code: r.code, reason: 'conflicting-duplicate', preview: `${r.text.slice(0, 40)} ↔ ${later.text.slice(0, 40)}` });
      continue;
    }
    // 영역 머리글이 없는 과목(통합교과: 4개 영역 중첩)은 대응표의 domainKorean을 쓴다.
    const domainKorean = (typeof override === 'object' && override?.domainKorean) || map.domainKorean || r.domainKorean;
    if (typeof text !== 'string' || !text.trim()) { failures.push({ code: r.code, reason: 'empty-text' }); continue; }
    if (text.length > MAX_TEXT) { failures.push({ code: r.code, reason: 'suspiciously-long', preview: text.slice(0, 80) }); continue; }
    if (UNMAPPED_GLYPH.test(text)) { failures.push({ code: r.code, reason: 'unmapped-glyph', preview: text.slice(0, 80) }); continue; }
    if (!domainKorean) { failures.push({ code: r.code, reason: 'missing-domain' }); continue; }

    if (!subjects.has(map.id)) {
      subjects.set(map.id, {
        id: map.id, subjectKorean: map.subjectKorean, category, codePrefix: r.prefix,
        sourceId, gradeBands: new Set(), standardCount: 0,
        ...(map.note ? { note: map.note } : {}),
      });
    }
    const subject = subjects.get(map.id);
    subject.gradeBands.add(band.id);
    subject.standardCount += 1;
    standards.push({
      key, code: r.code, category, subjectId: map.id, subjectKorean: map.subjectKorean,
      gradeBand: band.id, gradeBandKorean: band.labelKorean,
      domainNo: r.domainNo, domainKorean, itemNo: r.itemNo, sourceId,
    });
    texts.push({
      key, text: normalizeWhitespace(text), sourceId,
      locator: overrideText !== undefined ? 'manual-exception' : 'pattern-match',
    });
  }
  const bandOrder = new Map(GRADE_BANDS.map((b) => [b.id, b.order]));
  const sortKey = (s) => [bandOrder.get(s.gradeBand), s.subjectId, s.domainNo, s.itemNo];
  standards.sort((a, b) => {
    const [x, y] = [sortKey(a), sortKey(b)];
    for (let i = 0; i < x.length; i += 1) {
      if (x[i] < y[i]) return -1;
      if (x[i] > y[i]) return 1;
    }
    return 0;
  });
  texts.sort((a, b) => a.key.localeCompare(b.key, 'ko'));
  return {
    subjects: [...subjects.values()].map((s) => ({
      ...s, gradeBands: [...s.gradeBands].sort((a, b) => bandOrder.get(a) - bandOrder.get(b)),
    })).sort((a, b) => a.id.localeCompare(b.id, 'en')),
    standards, texts, failures,
  };
}

function pdftotext(pdfPath) {
  return execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', pdfPath, '-'], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

function main() {
  const discover = process.argv.includes('--discover');
  const recordGates = process.argv.includes('--record-gates');
  const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
  const pdfPaths = JSON.parse(readFileSync(join(repoRoot, '.cache', 'pdf-paths.json'), 'utf8'));
  const { mappings } = JSON.parse(readFileSync(join(here, 'subjects.json'), 'utf8'));
  const exceptions = JSON.parse(readFileSync(join(here, 'exceptions.json'), 'utf8'));

  const allSubjects = [];
  const gates = { release: null, categories: {} };
  let failed = 0;
  for (const annex of sources.annexes) {
    const pdfPath = pdfPaths[annex.id];
    if (!pdfPath) throw new Error(`${annex.id}의 PDF 경로가 없습니다 — pipeline:fetch를 먼저 실행하세요.`);
    const { records, duplicates, rejected } = extractStandards(pdftotext(pdfPath));

    if (discover) {
      const report = discoveryReport(records, duplicates, rejected);
      writeJson(join(repoRoot, '.cache', `discovery-${annex.id}.json`), report);
      console.error(`✓ ${annex.id}: 성취기준 후보 ${report.totalStandards}건, 접두어 ${report.prefixes.length}종`);
      for (const p of report.prefixes) {
        console.error(`  - ${p.prefix}: ${p.count}건 · 학년군 코드 ${p.bandCodes.join('/')} · 예) ${p.samples[0]?.code} ${p.samples[0]?.text}`);
      }
      if (report.unknownBandCodes.length) console.error(`  ⚠ 미지 학년군 코드: ${report.unknownBandCodes.join(', ')}`);
      if (report.repeatedCodes.length) console.error(`  · 같은 원문 반복(해설 머리) ${report.repeatedCodes.length}종 — 무해`);
      if (report.duplicateCodes.length) console.error(`  ⚠ 원문이 다른 중복 코드 ${report.duplicateCodes.length}종: ${report.duplicateCodes.join(' ')}`);
      if (report.rejectedCodes.length) console.error(`  ⚠ 조사가 붙어 버린 줄 첫머리 코드(목록 항목 없음 — 누락 의심) ${report.rejectedCodes.length}건: ${report.rejectedCodes.map((r) => r.context).join(' / ')}`);
      if (report.numberingGaps.length) console.error(`  ⚠ 순번 결번 ${report.numberingGaps.length}묶음: ${report.numberingGaps.map((g) => `${g.group}→${g.missing.join(',')}`).join(' ')}`);
      if (report.missingDomain.length) console.error(`  ⚠ 영역 미확인 ${report.missingDomain.length}건 (대응표 domainKorean으로 채울 과목인지 확인)`);
      if (report.suspicious.length) console.error(`  ⚠ 원문 이상 ${report.suspicious.length}건`);
      continue;
    }

    const built = buildDataset(records, {
      category: annex.category, sourceId: annex.id, mappings, exceptions, duplicates,
    });
    for (const r of rejected) {
      built.failures.push({ code: r.code, reason: 'rejected-list-code', preview: r.context });
    }
    for (const g of numberingGaps(records)) {
      built.failures.push({ code: g.group, reason: 'numbering-gap', preview: `결번 ${g.missing.join(',')}` });
    }
    const dir = join(repoRoot, 'data', 'kr', annex.category);
    writeJson(join(dir, 'curriculum-standards.json'), {
      version: 'kr-special-standards-v1', category: annex.category, standards: built.standards,
    });
    writeJson(join(dir, 'standard-texts.json'), {
      version: 'kr-special-standard-texts-v1',
      sourceNote: `${annex.notice} 【별책 ${annex.annexNo}】 ${annex.titleKorean} PDF에서 추출한 성취기준 본문. 저작권법 제7조 제2호에 따라 보호받지 않는 고시 원문이며 정확성·추적성을 위해 출처를 표기한다.`,
      texts: built.texts,
    });
    allSubjects.push(...built.subjects);
    gates.categories[annex.category] = {
      subjects: built.subjects.length, standards: built.standards.length,
      bySubject: Object.fromEntries(built.subjects.map((s) => [s.id, s.standardCount])),
    };
    console.error(`✓ ${annex.id}: 과목 ${built.subjects.length} · 성취기준 ${built.standards.length}건 기록`);
    if (built.failures.length) {
      failed += built.failures.length;
      console.error(`✗ 미해결 ${built.failures.length}건 — subjects.json·exceptions.json 보정 후 재실행:`);
      for (const f of built.failures.slice(0, 50)) {
        console.error(`  - ${f.code} [${f.reason}]${f.preview ? ` ${f.preview}…` : ''}${f.prefix ? ` 접두어=${f.prefix}` : ''}`);
      }
    }
  }
  if (discover) return;
  writeJson(join(repoRoot, 'data', 'kr', 'subjects.json'), { version: 'kr-special-subjects-v1', subjects: allSubjects });
  if (recordGates) {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    gates.release = `v${pkg.version}`;
    writeJson(join(here, 'gates.json'), gates);
    console.error('✓ pipeline/gates.json 갱신');
  }
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
