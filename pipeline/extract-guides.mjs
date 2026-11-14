#!/usr/bin/env node
// 과목별 '1. 성격 및 목표'와 '3. 교수·학습 및 평가'를 HWP에서 추출한다(【별책 3】 기본 교육과정,
// 【별책 2】 특수교육 전문 교과).
//   npm run pipeline:guides [-- --record-gates]
//
// 과목 절은 extract-details와 같은 방식으로 찾는다('가. 내용 체계'가 있는 2절 → 목록 상자 코드로 과목을
// 정한다). 1절은 그 앞의 '1. 성격 및 목표' 글상자부터 '2. 내용 체계' 글상자까지, 3절은 '3. 교수·학습 및
// 평가' 글상자부터 다음 글상자(다음 과목 제목 등)나 표까지다. 구조 해석은 엄격하다 — 모르는 머리글,
// 번호 건너뜀, 절 안의 표·글상자 글자는 실패한다. 추출한 모든 문단은 같은 고시의 PDF와 글자 대조한다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hwpBlocks } from './hwp-text.mjs';
import { classifySection, cleanText, findSubjectSections, pdfChecker } from './extract-details.mjs';
import { annexCategories, loadSubjectConfig, mergedMappings, routeCode } from './scope.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const BOX_S1 = /^1\.\s*성격\s*및\s*목표$/;
const BOX_S2 = /^2\.\s*내용\s*체계/;
const BOX_S3 = /^3\.\s*교수·학습\s*및\s*평가$/;
const LETTER_HEADING = /^([가-하])\.\s*(\S.{0,30})$/;
const PART_HEADING = /^\((\d{1,2})\)\s*(\S.{0,20})$/;
const GOAL_ITEM = /^\((\d{1,2})\)\s*(\S.*)$/;
const ITEM = /^\(([가-힣])\)\s*(\S.*)$/;
// (가)~(하) 다음은 (거)(너)…로 잇는다.
export const ITEM_ORDER = [...'가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허'];
// 3절의 부분 머리글 → 조회용 id. 이 밖의 머리글은 실패한다.
export const PART_IDS = new Map([
  ['교수·학습의 방향', 'direction'], ['교수·학습 방법', 'methods'],
  ['평가의 방향', 'direction'], ['평가 방법', 'methods'],
]);

/** 문단의 글상자(표 아닌 컨트롤) 글자 — 머리말·꼬리말 등은 빼고 글상자(gso)만. */
export function boxTexts(p) {
  return p.ctrls.filter((c) => c.id === 'gso ').flatMap((c) => (c.texts ?? []).map((t) => cleanText(t))).filter(Boolean);
}
const hasBox = (p, re) => boxTexts(p).some((t) => re.test(t));
const tableIn = (p) => p.ctrls.some((c) => c.id === 'tbl ');

/** 과목 절 경계: { s1, s2, s3, e3 } — 각 글상자 문단 번호와 3절 끝(다음 글상자·표가 있는 문단, 없으면 문서 끝). */
export function guideBounds(blocks, section) {
  let s1 = -1;
  let s2 = -1;
  for (let k = section.a; k >= 0; k -= 1) {
    if (s2 < 0 && hasBox(blocks[k], BOX_S2)) s2 = k;
    if (hasBox(blocks[k], BOX_S1)) { s1 = k; break; }
  }
  if (s1 < 0 || s2 < 0) throw new Error(`과목 절(${section.a})의 '1. 성격 및 목표'·'2. 내용 체계' 글상자를 찾지 못했습니다.`);
  let s3 = -1;
  for (let k = section.b; k < blocks.length; k += 1) {
    if (hasBox(blocks[k], BOX_S3)) { s3 = k; break; }
    if (k > section.end) break;
  }
  if (s3 < 0) throw new Error(`과목 절(${section.a}) 뒤에 '3. 교수·학습 및 평가' 글상자가 없습니다.`);
  let e3 = blocks.length;
  for (let k = s3 + 1; k < blocks.length; k += 1) {
    if (boxTexts(blocks[k]).length || tableIn(blocks[k])) { e3 = k; break; }
  }
  return { s1, s2, s3, e3 };
}

/** 절 안의 문단 글자 목록. 표나 글상자 글자가 있으면 실패(이 절들에는 없다 — 실측). */
function paragraphs(blocks, from, to, where) {
  const out = [];
  for (let k = from; k < to; k += 1) {
    const p = blocks[k];
    if (tableIn(p)) throw new Error(`${where}: 절 안의 표(${k})`);
    if (boxTexts(p).length) throw new Error(`${where}: 절 안의 글상자 글자 '${boxTexts(p).join(' ').slice(0, 30)}'(${k})`);
    const t = cleanText(p.text);
    if (t) out.push(t);
  }
  return out;
}

/**
 * 번호 항목 + 번호 없는 하위 문단 → [{ no, text, subItems? }]. 번호는 원문대로 두고, 바로 앞 항목의 다음
 * 번호가 아니면 실패한다 — 원문의 결번·중복 번호는 allowOdd(no)가 true일 때만(details-exceptions.json itemNumbering).
 */
function pushItem(list, no, text, order, where, allowOdd = () => false) {
  const want = order(list.length ? order.indexOf(list.at(-1).no) + 1 : 0);
  if (no !== want && !(list.length && allowOdd(no))) {
    throw new Error(`${where}: ${list.length + 1}번째 항목 번호가 ${no}입니다(기대 ${want}) — 원문의 결번·중복이라면 details-exceptions.json itemNumbering에 근거와 함께 적으세요.`);
  }
  list.push({ no, text });
}
const goalOrder = Object.assign((i) => `(${i + 1})`, { indexOf: (no) => Number(/\d+/.exec(no)[0]) - 1 });
const itemOrder = Object.assign((i) => `(${ITEM_ORDER[i]})`, { indexOf: (no) => ITEM_ORDER.indexOf(no.slice(1, -1)) });

/**
 * '1. 성격 및 목표' 문단들 → { nature: { sections: [{ heading, paragraphs }] }, goals: { heading, overall, items } }.
 * 머리글: '가. 성격'(교과) 또는 '가. 통합교과의 성격'·'나. ○○과의 성격'(통합교과), 마지막이 '○. 목표'.
 */
export function parseNatureGoals(paras, where) {
  const nature = { sections: [] };
  let goals = null;
  let current = null;
  const letters = [];
  for (const t of paras) {
    const h = LETTER_HEADING.exec(t);
    if (h && !/다\.$/.test(t)) {
      if (h[1] !== ITEM_ORDER[letters.length]) throw new Error(`${where}: 1절 머리글 순서 '${t}'`);
      letters.push(h[1]);
      const name = h[2].trim();
      if (goals) throw new Error(`${where}: '목표' 뒤의 머리글 '${t}'`);
      if (name === '목표') { goals = { heading: t, overall: [], items: [] }; current = null; continue; }
      if (!/성격$/.test(name)) throw new Error(`${where}: 모르는 1절 머리글 '${t}'`);
      current = { heading: t, paragraphs: [] };
      nature.sections.push(current);
      continue;
    }
    if (goals) {
      const m = GOAL_ITEM.exec(t);
      if (m) { pushItem(goals.items, `(${m[1]})`, m[2].trim(), goalOrder, `${where} 목표`); continue; }
      if (goals.items.length) throw new Error(`${where}: 세부 목표 뒤의 번호 없는 문단 '${t.slice(0, 40)}'`);
      goals.overall.push(t);
      continue;
    }
    if (!current) throw new Error(`${where}: 1절 머리글 전의 문단 '${t.slice(0, 40)}'`);
    current.paragraphs.push(t);
  }
  if (!nature.sections.length || nature.sections.some((s) => !s.paragraphs.length)) throw new Error(`${where}: 성격 문단이 없습니다.`);
  if (!goals || !goals.overall.length || !goals.items.length) throw new Error(`${where}: 목표(총괄·세부)가 없습니다.`);
  return { nature, goals };
}

/**
 * '3. 교수·학습 및 평가' 문단들 → { teachingLearning, assessment }. 각각 { heading, parts: [{ id, heading, items }] }.
 * 항목은 '(가) …'이고 번호 없는 문단은 바로 앞 항목의 subItems다.
 * 원문 오류는 allow(종류, 자리)가 true일 때만 받는다(details-exceptions.json):
 *  - 'missingPartHeadings', 그룹('teachingLearning'): 첫 부분 머리글('(1) …의 방향') 누락 → heading: null
 *  - 'itemNumbering', '그룹.부분|번호'('teachingLearning.direction|(파)'): 항목 번호 결번·중복
 */
export function parseTeachingAssessment(paras, where, allow = () => false) {
  const out = {};
  let group = null;
  let part = null;
  for (const t of paras) {
    const h = LETTER_HEADING.exec(t);
    if (h && !/다\.$/.test(t)) {
      const name = h[2].replace(/\s+/g, ' ').trim();
      const key = name === '교수·학습' ? 'teachingLearning' : name === '평가' ? 'assessment' : null;
      if (!key) throw new Error(`${where}: 모르는 3절 머리글 '${t}'`);
      if (out[key]) throw new Error(`${where}: 3절 머리글 '${t}'이(가) 두 번 나옵니다.`);
      if (key === 'assessment' && !out.teachingLearning) throw new Error(`${where}: '가. 교수·학습'보다 '평가'가 먼저 나옵니다.`);
      group = { heading: t, parts: [] };
      out[key] = group;
      part = null;
      continue;
    }
    const ph = PART_HEADING.exec(t);
    if (ph && !/다\.$/.test(t)) {
      if (!group) throw new Error(`${where}: 3절 머리글 전의 '${t}'`);
      const name = ph[2].replace(/\s+/g, ' ').trim();
      const id = PART_IDS.get(name);
      if (!id || !name.startsWith(group === out.assessment ? '평가' : '교수·학습')) throw new Error(`${where}: 모르는 3절 부분 머리글 '${t}'`);
      if (Number(ph[1]) !== group.parts.length + 1) throw new Error(`${where}: 부분 머리글 번호 '${t}'`);
      part = { id, heading: t, items: [] };
      group.parts.push(part);
      continue;
    }
    if (!part && group && !group.parts.length && ITEM.test(t)) {
      const key = group === out.assessment ? 'assessment' : 'teachingLearning';
      if (!allow('missingPartHeadings', key)) throw new Error(`${where}: ${group.heading} 아래 첫 부분 머리글 없이 항목이 나옵니다 '${t.slice(0, 30)}' — 원문 누락이라면 details-exceptions.json missingPartHeadings에 근거와 함께 적으세요.`);
      part = { id: 'direction', heading: null, items: [] };
      group.parts.push(part);
    }
    if (!part) throw new Error(`${where}: 부분 머리글 전의 문단 '${t.slice(0, 40)}'`);
    const m = ITEM.exec(t);
    if (m) { pushItem(part.items, `(${m[1]})`, m[2].trim(), itemOrder, `${where} ${part.heading ?? group.heading}`, (no) => allow('itemNumbering', `${group === out.assessment ? 'assessment' : 'teachingLearning'}.${part.id}|${no}`)); continue; }
    const last = part.items.at(-1);
    if (!last) throw new Error(`${where} ${part.heading}: 항목 전의 번호 없는 문단 '${t.slice(0, 40)}'`);
    (last.subItems ??= []).push(t);
  }
  for (const key of ['teachingLearning', 'assessment']) {
    const g = out[key];
    if (!g) throw new Error(`${where}: 3절에 '${key === 'assessment' ? '나. 평가' : '가. 교수·학습'}'이(가) 없습니다.`);
    if (g.parts.map((p) => p.id).join(',') !== 'direction,methods') throw new Error(`${where}: ${g.heading}의 부분 구성이 (1) 방향·(2) 방법이 아닙니다.`);
    for (const p of g.parts) if (!p.items.length) throw new Error(`${where}: ${p.heading} 항목 없음`);
  }
  return out;
}

/** 과목 하나 → 안내 데이터. allow: parseTeachingAssessment 참고. */
export function parseGuide(blocks, bounds, where, allow) {
  const s1 = paragraphs(blocks, bounds.s1 + 1, bounds.s2, `${where} 1절`);
  const s3 = paragraphs(blocks, bounds.s3 + 1, bounds.e3, `${where} 3절`);
  return { ...parseNatureGoals(s1, where), ...parseTeachingAssessment(s3, where, allow) };
}

/**
 * 3절 끝 뒤에 3절 항목처럼 보이는 문단이 남았는지(끝을 너무 일찍 잡았는지) 본다 — 다음 과목 1절 전까지.
 */
function danglingAfter(blocks, e3, nextS1) {
  for (let k = e3; k < nextS1; k += 1) {
    const t = cleanText(blocks[k].text);
    if (ITEM.test(t) || /^\(\d\)\s*(교수·학습|평가)/.test(t) || /^[가나]\.\s*(교수·학습|평가)$/.test(t)) return `${k}: ${t.slice(0, 40)}`;
  }
  return null;
}

/**
 * 한 판의 HWP → 과목별 안내. route는 classifySection 참고. exceptions는 details-exceptions.json의
  * { missingPartHeadings, itemNumbering } — 키는 '과목 id[@판]|자리'(예: 'joyful-living@2024-4|teachingLearning',
 * 'information-processing|teachingLearning.direction|(파)')이고, 쓰인 키는 used에 '종류:키'로 기록한다.
 */
export function extractGuides(blocks, route, { edition = null, exceptions = {}, used = new Set() } = {}) {
  const sections = findSubjectSections(blocks);
  const out = [];
  const errors = [];
  let skipped = 0;
  const bounds = [];
  for (const section of sections) {
    const hit = classifySection(blocks, section, route);
    if (hit.outOfScope) { skipped += 1; continue; }
    const b = guideBounds(blocks, section);
    bounds.push(b);
    const where = hit.map.subjectKorean;
    if (out.some((s) => s.subjectId === hit.map.id)) { errors.push(`${where}: 과목 절이 두 번 나왔습니다.`); continue; }
    // 판을 밝힌 키('과목@판|자리')가 먼저, 없으면 판 없는 키('과목|자리')가 두 판 모두에 적용된다.
    const allow = (kind, spot) => {
      const keys = [...(edition ? [`${hit.map.id}@${edition}|${spot}`] : []), `${hit.map.id}|${spot}`];
      const key = keys.find((k) => exceptions[kind]?.[k]);
      if (!key) return false;
      used.add(`${kind}:${key}`);
      return true;
    };
    out.push({ subjectId: hit.map.id, subjectKorean: hit.map.subjectKorean, category: hit.category, ...parseGuide(blocks, b, where, allow) });
  }
  // 3절 끝 검사: 다음 과목(범위 밖 포함)의 1절 글상자 전까지 3절 항목 같은 문단이 없어야 한다.
  const s1All = [];
  for (let k = 0; k < blocks.length; k += 1) if (hasBox(blocks[k], BOX_S1)) s1All.push(k);
  for (const [i, b] of bounds.entries()) {
    const next = s1All.find((k) => k > b.e3) ?? blocks.length;
    const d = danglingAfter(blocks, b.e3, next);
    if (d) errors.push(`${out[i].subjectKorean}: 3절 끝(${b.e3}) 뒤에 3절 항목 같은 문단 — ${d}`);
  }
  return { subjects: out, errors, skipped };
}

/** 안내 데이터의 모든 문장 [이름표, 글자]. */
export function flattenGuide(g) {
  const out = [];
  for (const s of g.nature.sections) {
    out.push([s.heading, '']);
    s.paragraphs.forEach((t, i) => out.push([`${s.heading} ${i + 1}`, t]));
  }
  out.push([g.goals.heading, '']);
  g.goals.overall.forEach((t, i) => out.push([`총괄 목표 ${i + 1}`, t]));
  g.goals.items.forEach((it) => out.push([`목표 ${it.no}`, it.text]));
  for (const group of [g.teachingLearning, g.assessment]) {
    out.push([group.heading, '']);
    for (const p of group.parts) {
      out.push([p.heading ?? `(${p.id} 머리글 없음)`, '']);
      for (const it of p.items) {
        out.push([`${group.heading} ${p.heading} ${it.no}`, it.text]);
        (it.subItems ?? []).forEach((t, i) => out.push([`${group.heading} ${p.heading} ${it.no}-${i + 1}`, t]));
      }
    }
  }
  return out;
}

export function crossCheckGuides(subjects, pdfLayout, pdfRaw) {
  const inPdf = pdfChecker(pdfLayout, pdfRaw);
  const missing = [];
  for (const s of subjects) {
    for (const [label, text] of flattenGuide(s)) {
      if (!text && / 머리글 없음\)$/.test(label)) continue;
      // 글자가 없는 줄은 머리글 자체(이름표)를 대조한다.
      if (!inPdf(text || label)) missing.push(`${s.subjectKorean} ${label}: ${(text || label).slice(0, 60)}`);
    }
  }
  return missing;
}

export function guideCounts(subjects) {
  const cur = subjects.filter((s) => !s.edition);
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const items = (g) => g.parts.reduce((n, p) => n + p.items.length, 0);
  const subs = (s) => [s.teachingLearning, s.assessment].reduce((n, g) => n + g.parts.reduce((m, p) => m + p.items.reduce((k, it) => k + (it.subItems?.length ?? 0), 0), 0), 0);
  const one = (s) => ({
    natureParagraphs: sum(s.nature.sections, (x) => x.paragraphs.length),
    goalItems: s.goals.items.length,
    teachingItems: items(s.teachingLearning),
    assessmentItems: items(s.assessment),
    subItems: subs(s),
  });
  const totals = { subjects: cur.length };
  for (const s of cur) for (const [k, v] of Object.entries(one(s))) totals[k] = (totals[k] ?? 0) + v;
  const prev = subjects.filter((s) => s.edition).sort((a, b) => a.subjectId.localeCompare(b.subjectId, 'en'));
  return { ...totals, previousEdition: Object.fromEntries(prev.map((s) => [s.subjectId, one(s)])) };
}

function pdftotext(path, mode) {
  return execFileSync('pdftotext', ['-enc', 'UTF-8', mode, path, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

function main() {
  const recordGates = process.argv.includes('--record-gates');
  const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
  const paths = JSON.parse(readFileSync(join(repoRoot, '.cache', 'pdf-paths.json'), 'utf8'));
  const config = loadSubjectConfig();
  const dataDir = join(repoRoot, 'data', 'kr');
  const { subjects } = JSON.parse(readFileSync(join(dataDir, 'subjects.json'), 'utf8'));
  const fail = (title, list) => {
    if (!list.length) return;
    console.error(`✗ ${title} ${list.length}건:`);
    for (const m of list.slice(0, 40)) console.error(`  - ${m}`);
    process.exit(1);
  };
  const { missingPartHeadings = {}, itemNumbering = {} } = JSON.parse(readFileSync(join(here, 'details-exceptions.json'), 'utf8'));
  const guideExceptions = { missingPartHeadings, itemNumbering };
  const usedMissing = new Set();
  const gatesGuides = {};
  for (const src of sources.annexes.filter((a) => a.role === 'details')) {
    const sameAnnex = (role) => sources.annexes.find((a) => a.role === role && a.annexNo === src.annexNo);
    const prevSrc = sameAnnex('details-previous');
    const pdfSrc = sameAnnex('standards');
    const prevPdfSrc = sameAnnex('standards-previous');
    for (const s of [src, pdfSrc, prevSrc, prevPdfSrc].filter(Boolean)) {
      if (!paths[s.id]) throw new Error(`${s.id} 파일 경로가 없습니다 — pipeline:fetch를 먼저 실행하세요.`);
    }
    const categories = annexCategories(src);
    const label = `【별책 ${src.annexNo}】`;
    const mine = subjects.filter((s) => categories.includes(s.category));
    const cur = extractGuides(hwpBlocks(readFileSync(paths[src.id])), (c) => routeCode(c, src, config), { exceptions: guideExceptions, used: usedMissing });
    fail(`${label} 구조 검사 실패`, cur.errors);
    const got = new Set(cur.subjects.map((s) => s.subjectId));
    fail(`${label} 과목 누락`, mine.filter((s) => !got.has(s.id)).map((s) => `${s.subjectKorean}: HWP에서 성격·목표/교수·학습 및 평가를 찾지 못했습니다.`));
    fail(`${label} PDF 대조 실패(최신 판)`, crossCheckGuides(cur.subjects, pdftotext(paths[pdfSrc.id], '-layout'), pdftotext(paths[pdfSrc.id], '-raw')));

    let prevSubjects = [];
    if (prevSrc) {
      // 이전 판을 함께 싣는 과목은 details-previous include와 같다(내용 체계·해설과 같은 판 구성).
      const merged = mergedMappings(categories, config);
      const idsOf = (list) => new Set((list ?? []).map((p) => merged[p].id));
      const include = idsOf(prevSrc.include?.prefixes);
      const currentOnly = idsOf(prevPdfSrc?.currentOnly?.prefixes);
      const prev = extractGuides(hwpBlocks(readFileSync(paths[prevSrc.id])), (c) => routeCode(c, prevSrc, config), { edition: prevSrc.edition, exceptions: guideExceptions, used: usedMissing });
      fail(`${label} 구조 검사 실패(이전 판)`, prev.errors);
      const prevById = new Map(prev.subjects.map((s) => [s.subjectId, s]));
      const same = (a, b) => JSON.stringify(flattenGuide(a)) === JSON.stringify(flattenGuide(b));
      const errors = [];
      for (const c of cur.subjects) {
        const p = prevById.get(c.subjectId);
        if (currentOnly.has(c.subjectId)) { if (p) errors.push(`${c.subjectKorean}: 최신 판 신설 과목인데 이전 판에도 있습니다.`); continue; }
        if (!p) { errors.push(`${c.subjectKorean}: 이전 판에 없습니다.`); continue; }
        if (include.has(c.subjectId) && same(c, p)) errors.push(`${c.subjectKorean}: 두 판의 성격·목표·교수·학습 및 평가가 같은데 include에 있습니다.`);
        if (!include.has(c.subjectId) && !same(c, p)) {
          const [fa, fb] = [flattenGuide(c), flattenGuide(p)];
          const i = fa.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(fb[j]));
          errors.push(`${c.subjectKorean}: 두 판이 다릅니다 — ${fa[i]?.[0] ?? fb[i]?.[0]}: 최신 '${(fa[i]?.[1] ?? '').slice(0, 40)}' / 이전 '${(fb[i]?.[1] ?? '').slice(0, 40)}'`);
        }
      }
      for (const p of prev.subjects) if (!got.has(p.subjectId)) errors.push(`${p.subjectKorean}: 이전 판에만 있습니다.`);
      fail(`${label} 판본 비교 실패`, errors);
      prevSubjects = prev.subjects.filter((s) => include.has(s.subjectId));
      if (prevSubjects.length) fail(`${label} PDF 대조 실패(이전 판)`, crossCheckGuides(prevSubjects, pdftotext(paths[prevPdfSrc.id], '-layout'), pdftotext(paths[prevPdfSrc.id], '-raw')));
      prevSubjects = prevSubjects.map((s) => ({ ...s, edition: prevSrc.edition, editionNote: prevSrc.editionNote, sourceId: prevSrc.id }));
      console.error(`✓ ${prevSrc.id}: 두 판 비교 통과 — 이전 판 함께 수록 ${prevSubjects.map((s) => s.subjectKorean).join(', ') || '없음'}, 나머지 과목은 두 판이 같음`);
    }

    const all = [...cur.subjects.map((s) => ({ ...s, sourceId: src.id })), ...prevSubjects];
    const order = (a, b) => a.subjectId.localeCompare(b.subjectId, 'en') || (a.edition ? 1 : 0) - (b.edition ? 1 : 0);
    for (const category of categories) {
      const info = config.categories[category];
      const list = all.filter((s) => s.category === category).sort(order);
      const doc = {
        version: 'kr-special-subject-guides-v1', category,
        sourceNote: `${src.notice} ${label} ${src.titleKorean}${info.subjectGroupKorean ? ` 중 특수교육 전문 교과(${info.subjectGroupKorean})` : ''} HWP에서 추출하고 같은 고시의 PDF와 글자 대조한 과목별 '1. 성격 및 목표'와 '3. 교수·학습 및 평가' 원문. 저작권법 제7조에 따라 보호받지 않는 고시 원문이며 정확성·추적성을 위해 출처를 표기한다.`,
        subjects: list.map(({ category: _c, ...s }) => ({
          subjectId: s.subjectId, subjectKorean: s.subjectKorean, sourceId: s.sourceId,
          ...(s.edition ? { edition: s.edition, editionNote: s.editionNote } : {}),
          nature: s.nature, goals: s.goals, teachingLearning: s.teachingLearning, assessment: s.assessment,
        })),
      };
      writeFileSync(join(dataDir, category, 'subject-guides.json'), `${JSON.stringify(doc, null, 1)}\n`);
      const counts = guideCounts(list);
      gatesGuides[category] = counts;
      console.error(`✓ ${category}: 성격·목표, 교수·학습 및 평가 ${counts.subjects}과목 · 성격 ${counts.natureParagraphs}문단 · 세부 목표 ${counts.goalItems} · 교수·학습 ${counts.teachingItems}항 · 평가 ${counts.assessmentItems}항 · 하위 문단 ${counts.subItems} (PDF 대조 통과)`);
    }
    if (cur.skipped) console.error(`  · ${label} 범위 밖 과목 절 ${cur.skipped}개 건너뜀(subjects.json outOfScope)`);
  }
  fail('예외표 정리 필요', Object.entries(guideExceptions).flatMap(([kind, table]) => Object.keys(table)
    .filter((k) => !usedMissing.has(`${kind}:${k}`))
    .map((k) => `details-exceptions.json ${kind} '${k}'이(가) 쓰이지 않습니다.`)));
  if (recordGates) {
    const gatesPath = join(here, 'gates.json');
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8'));
    gates.guides = gatesGuides;
    writeFileSync(gatesPath, `${JSON.stringify(gates, null, 1)}\n`);
    console.error('✓ pipeline/gates.json guides 갱신');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
