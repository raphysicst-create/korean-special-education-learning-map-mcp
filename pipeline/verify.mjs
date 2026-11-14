#!/usr/bin/env node
// 산출물 전수 검증 + data/kr/manifest.json 기록. 데이터 변경 후 반드시 실행한다.
//   npm run pipeline:verify        — 검증 통과 시 manifest 갱신
//   npm run pipeline:verify:check  — manifest를 쓰지 않고, 현재 파일 해시와 일치하는지만 확인(CI용)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADE_BANDS, canonicalCode, parseBasicCode } from '../src/normalize.mjs';
import { numberingGaps } from './extract-standards.mjs';
import { HANGUL_ORDER, operationCounts } from './extract-operation.mjs';
import { CATEGORIES, detailCounts, domainNameMatches } from './extract-details.mjs';
import { ITEM_ORDER, guideCounts } from './extract-guides.mjs';

export const OPERATION_FILE = 'operation-guidelines.json';
// 카테고리 폴더의 내용 체계·해설 파일(있으면 둘 다 있어야 한다).
export const DETAIL_FILES = ['content-systems.json', 'standard-notes.json'];
// 카테고리 폴더의 과목별 성격·목표, 교수·학습 및 평가 파일(있으면).
export const GUIDE_FILE = 'subject-guides.json';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(here, '..', 'data', 'kr');
export const CATEGORY_FILES = ['curriculum-standards.json', 'standard-texts.json'];
const MAX_TEXT = 700;
const UNMAPPED_GLYPH = /[-�]/;
const BAND_IDS = new Set(GRADE_BANDS.map((b) => b.id));

export function listCategories(dataDir) {
  return readdirSync(dataDir)
    .filter((name) => statSync(join(dataDir, name)).isDirectory())
    .sort();
}

const defaultExceptions = () => JSON.parse(readFileSync(join(here, 'details-exceptions.json'), 'utf8'));

export function verifyAll(dataDir = defaultDataDir, gates = null, { domainNames = defaultExceptions().domainNames ?? {} } = {}) {
  const read = (rel) => JSON.parse(readFileSync(join(dataDir, rel), 'utf8'));
  const errors = [];
  const { subjects } = read('subjects.json');
  const subjectById = new Map();
  for (const s of subjects) {
    if (subjectById.has(s.id)) errors.push(`과목 id 중복: ${s.id}`);
    subjectById.set(s.id, s);
  }

  const counts = { subjects: subjects.length, standards: 0, previousEdition: 0, categories: {} };
  const perSubject = new Map();
  const prevPerSubject = new Map();
  for (const category of listCategories(dataDir)) {
    const { standards } = read(`${category}/curriculum-standards.json`);
    const { texts } = read(`${category}/standard-texts.json`);
    const keys = new Set();
    const codes = new Set();
    for (const s of standards) {
      if (keys.has(s.key)) errors.push(`성취기준 key 중복: ${s.key}`);
      keys.add(s.key);
      // 같은 코드는 판(edition)이 다를 때만 함께 있을 수 있다.
      const codeKey = `${canonicalCode(s.code)}|${s.edition ?? ''}`;
      if (codes.has(codeKey)) errors.push(`${category} 안 코드 중복: ${s.code}${s.edition ? ` (${s.edition})` : ''}`);
      codes.add(codeKey);
      if (s.edition && s.key !== `${category}:${s.code}@${s.edition}`) errors.push(`이전 판 key 형식 오류: ${s.key}`);
      if (s.edition && !s.editionNote) errors.push(`이전 판 안내 누락: ${s.key}`);
      if (s.category !== category) errors.push(`카테고리 폴더 불일치: ${s.key}`);
      if (!subjectById.has(s.subjectId)) errors.push(`미지 과목: ${s.key} → ${s.subjectId}`);
      else if (subjectById.get(s.subjectId).category !== category) errors.push(`과목 카테고리 불일치: ${s.key} (과목은 ${subjectById.get(s.subjectId).category})`);
      if (!BAND_IDS.has(s.gradeBand)) errors.push(`미지 학년군: ${s.key} → ${s.gradeBand}`);
      const parsed = parseBasicCode(s.code);
      if (!parsed) errors.push(`코드 형식 오류: ${s.code}`);
      else if (parsed.gradeBand !== s.gradeBand) errors.push(`코드-학년군 불일치: ${s.code} (${s.gradeBand})`);
      if (!s.domainKorean) errors.push(`영역 누락: ${s.key}`);
      const bucket = s.edition ? prevPerSubject : perSubject;
      bucket.set(s.subjectId, (bucket.get(s.subjectId) ?? 0) + 1);
    }
    const textKeys = new Set();
    for (const t of texts) {
      if (!keys.has(t.key)) errors.push(`미지 key 원문: ${t.key}`);
      if (textKeys.has(t.key)) errors.push(`중복 원문: ${t.key}`);
      textKeys.add(t.key);
      if (!t.text || !t.text.trim()) errors.push(`빈 원문: ${t.key}`);
      else {
        if (t.text.length > MAX_TEXT) errors.push(`원문 길이 초과: ${t.key} (${t.text.length}자)`);
        if (UNMAPPED_GLYPH.test(t.text)) errors.push(`원문 깨진 글리프: ${t.key}`);
        if (!/[다요]\.?$/.test(t.text.trim())) errors.push(`원문 종결 이상(절단 의심): ${t.key} …${t.text.slice(-20)}`);
      }
    }
    for (const key of keys) if (!textKeys.has(key)) errors.push(`원문 없는 성취기준(출시 금지): ${key}`);
    // 과목·학년군·영역마다 순번이 01부터 이어져야 한다 — 중간 결번은 추출 누락 신호다.
    for (const g of numberingGaps(standards)) errors.push(`순번 결번(누락 의심): ${category} ${g.group} → ${g.missing.join(',')}`);
    const current = standards.filter((s) => !s.edition).length;
    counts.standards += current;
    counts.previousEdition += standards.length - current;
    counts.categories[category] = current;

    const present = DETAIL_FILES.filter((f) => existsSync(join(dataDir, category, f)));
    if (present.length === 1) errors.push(`${category}: ${present[0]}만 있습니다 — 내용 체계·해설 파일은 함께 있어야 합니다.`);
    if (present.length === DETAIL_FILES.length) {
      const d = verifyDetails(category, read(`${category}/content-systems.json`).subjects, read(`${category}/standard-notes.json`).subjects, standards, subjectById, domainNames);
      errors.push(...d.errors);
      (counts.details ??= {})[category] = d.counts;
    }
    if (existsSync(join(dataDir, category, GUIDE_FILE))) {
      const g = verifyGuides(category, read(`${category}/${GUIDE_FILE}`).subjects, standards, subjectById);
      errors.push(...g.errors);
      (counts.guides ??= {})[category] = g.counts;
    }
  }
  for (const s of subjects) {
    const actual = perSubject.get(s.id) ?? 0;
    if (actual !== s.standardCount) errors.push(`과목 ${s.id} 수량 불일치: subjects.json=${s.standardCount}, 실제=${actual}`);
    const prev = prevPerSubject.get(s.id) ?? 0;
    if (prev !== (s.previousEdition?.standardCount ?? 0)) errors.push(`과목 ${s.id} 이전 판 수량 불일치: subjects.json=${s.previousEdition?.standardCount ?? 0}, 실제=${prev}`);
  }

  const opPath = join(dataDir, OPERATION_FILE);
  if (existsSync(opPath)) {
    const op = JSON.parse(readFileSync(opPath, 'utf8'));
    errors.push(...verifyOperation(op));
    counts.operation = operationCounts(op);
    if (gates?.operation) {
      for (const [k, v] of Object.entries(gates.operation)) {
        if (counts.operation[k] !== v) errors.push(`게이트 불일치: 편성·운영 ${k} 기대 ${v}, 실제 ${counts.operation[k]}`);
      }
    }
  } else if (gates?.operation) {
    errors.push(`게이트에 편성·운영 수량이 있는데 ${OPERATION_FILE}이(가) 없습니다.`);
  }

  // 내용 체계·해설(details)과 성격·목표, 교수·학습 및 평가(guides) 수량 게이트는 카테고리별이다.
  for (const [key, label] of [['details', '내용 체계·해설'], ['guides', '성격·목표, 교수·학습 및 평가']]) {
    for (const [category, expected] of Object.entries(gates?.[key] ?? {})) {
      const got = counts[key]?.[category];
      if (!got) { errors.push(`게이트에 ${category} ${label} 수량이 있는데 데이터 파일이 없습니다.`); continue; }
      for (const [k, v] of Object.entries(expected)) {
        if (JSON.stringify(got[k]) !== JSON.stringify(v)) errors.push(`게이트 불일치: ${category} ${label} ${k} 기대 ${JSON.stringify(v)}, 실제 ${JSON.stringify(got[k])}`);
      }
    }
    for (const category of Object.keys(counts[key] ?? {})) {
      if (gates && !gates[key]?.[category]) errors.push(`${category} ${label} 게이트가 없습니다 — --record-gates로 기록하세요.`);
    }
  }

  if (gates) {
    for (const [category, expected] of Object.entries(gates.categories ?? {})) {
      const actual = counts.categories[category];
      if (actual !== expected.standards) {
        errors.push(`게이트 불일치: ${category} 성취기준 기대 ${expected.standards}, 실제 ${actual ?? 0}`);
      }
      for (const [subjectId, n] of Object.entries(expected.previousEdition ?? {})) {
        const got = prevPerSubject.get(subjectId) ?? 0;
        if (got !== n) errors.push(`게이트 불일치: 과목 ${subjectId} 이전 판 기대 ${n}, 실제 ${got}`);
      }
      for (const [subjectId, n] of Object.entries(expected.bySubject ?? {})) {
        const got = perSubject.get(subjectId) ?? 0;
        if (got !== n) errors.push(`게이트 불일치: 과목 ${subjectId} 기대 ${n}, 실제 ${got}`);
      }
    }
    for (const category of Object.keys(counts.categories)) {
      if (!gates.categories?.[category]) errors.push(`${category} 성취기준 게이트가 없습니다 — pipeline:extract -- --record-gates로 기록하세요.`);
    }
  }
  return { errors, counts };
}

const num = (v) => Number(String(v).replace(/,/g, '').match(/^\d+/)?.[0] ?? NaN);

// HWP 전용(사용자 정의) 영역 글자나 대체 문자(U+FFFD)가 남았으면 글자 깨짐이다.
const BROKEN_GLYPH = /[\ue000-\uf8ff\u{f0000}-\u{10ffff}\ufffd]/u;
// 해설·고려 사항·안내 문단은 '다.'로 끝난다. 원문이 '다,'로 끝낸 문단 2개(오기)도 원문대로 받는다.
const NOTE_END = /다[.,]$/;
const squashName = (v) => String(v ?? '').normalize('NFC').replace(/[・･⋅∙ㆍ]/g, '·').replace(/\s+/g, '');

/**
 * 내용 체계(content-systems.json)·해설(standard-notes.json) 검증.
 *  - 판 구성: 두 파일의 과목·판 구성이 같고, 성취기준이 있는 과목마다 최신 판이 있으며, 이전 판은 editionNote가 있다.
 *  - 내용 체계: 영역이 그 판 성취기준의 영역과 같고(번호·이름), 핵심 아이디어가 있고, 세 범주가 다 있으며,
 *    열·칸의 학년군이 과목 편성 학년군 안에 있다.
 *  - 해설: 목록 상자 코드가 그 판 성취기준을 정확히 한 번씩 덮고(학년군·영역 일치), 해설·고려 사항이 가리키는
 *    코드가 상자 안에 있으며, 문단이 '다.'로 끝나고 깨진 글자가 없다.
 * 이전 판 성취기준이 따로 없는 과목(바른 생활·슬기로운 생활)의 이전 판은 최신 판 성취기준과 맞춘다.
 */
export function verifyDetails(category, contentSystems, standardNotes, standards, subjectById, domainNames = {}) {
  const errors = [];
  const keyOf = (s) => `${s.subjectId}@${s.edition ?? ''}`;
  const where = (s) => `${category} ${s.subjectId}${s.edition ? `@${s.edition}` : ''}`;
  const standardsFor = (subjectId, edition) => {
    const own = standards.filter((x) => x.subjectId === subjectId && (x.edition ?? null) === (edition ?? null));
    return own.length || !edition ? own : standards.filter((x) => x.subjectId === subjectId && !x.edition);
  };
  const csKeys = contentSystems.map(keyOf).sort();
  const nKeys = standardNotes.map(keyOf).sort();
  if (csKeys.join() !== nKeys.join()) errors.push(`${category}: 내용 체계와 해설의 과목·판 구성이 다릅니다.`);
  if (new Set(csKeys).size !== csKeys.length || new Set(nKeys).size !== nKeys.length) errors.push(`${category}: 내용 체계·해설에 같은 과목·판이 두 번 있습니다.`);
  for (const id of new Set(standards.filter((x) => !x.edition).map((x) => x.subjectId))) {
    if (!contentSystems.some((x) => x.subjectId === id && !x.edition)) errors.push(`${category} ${id}: 최신 판 내용 체계·해설이 없습니다.`);
  }
  for (const x of [...contentSystems, ...standardNotes]) {
    if (!subjectById.has(x.subjectId)) errors.push(`${where(x)}: 미지 과목`);
    if (x.edition && !x.editionNote) errors.push(`${where(x)}: 이전 판 안내(editionNote) 누락`);
  }

  for (const x of contentSystems) {
    const std = standardsFor(x.subjectId, x.edition);
    const domains = new Map(std.map((t) => [t.domainNo, t.domainKorean]));
    const bands = subjectById.get(x.subjectId)?.gradeBands ?? [];
    const got = x.domains.map((d) => d.domainNo).sort().join(',');
    const want = [...domains.keys()].sort().join(',');
    if (got !== want) errors.push(`${where(x)}: 내용 체계 영역(${got})이 성취기준 영역(${want})과 다릅니다.`);
    for (const t of x.intro) if (BROKEN_GLYPH.test(t) || !NOTE_END.test(t)) errors.push(`${where(x)}: 내용 체계 안내 문장 이상 …${t.slice(-15)}`);
    for (const d of x.domains) {
      const w = `${where(x)} 내용 체계 ${d.domainNo} ${d.domainKorean}`;
      if (domains.has(d.domainNo) && squashName(domains.get(d.domainNo)) !== squashName(d.domainKorean)
        && !domainNameMatches(x.subjectId, d.domainNo, d.domainKorean, domains.get(d.domainNo), domainNames)) errors.push(`${w}: 영역 이름이 성취기준('${domains.get(d.domainNo)}')과 다릅니다.`);
      if (d.subAreas) {
        // 하위 영역 열 표(이료): 행의 하위 영역이 열 머리 목록 안에 있고, 열마다 행이 하나 이상 있어야 한다.
        const used = new Set(d.rows.map((r) => r.subArea));
        if (d.rows.some((r) => !d.subAreas.includes(r.subArea))) errors.push(`${w}: 하위 영역 열 밖의 행`);
        for (const sa of d.subAreas) if (!used.has(sa)) errors.push(`${w}: 하위 영역 '${sa}'의 내용 요소가 없습니다.`);
      }
      if (!d.coreIdeas.length) errors.push(`${w}: 핵심 아이디어 없음`);
      for (const t of d.coreIdeas) if (BROKEN_GLYPH.test(t) || !/다\.$/.test(t)) errors.push(`${w}: 핵심 아이디어 문장 이상 …${t.slice(-15)}`);
      const colBands = d.columns.map((c) => c.gradeBand);
      if (!colBands.length || colBands.some((b) => !bands.includes(b))) errors.push(`${w}: 열 학년군(${colBands.join(',')})이 편성 학년군(${bands.join(',')}) 밖입니다.`);
      for (const cat of CATEGORIES) if (!d.rows.some((r) => r.category === cat)) errors.push(`${w}: 범주 '${cat}' 없음`);
      for (const r of d.rows) {
        if (!CATEGORIES.includes(r.category)) errors.push(`${w}: 미지 범주 '${r.category}'`);
        for (const c of r.cells) {
          if (!c.gradeBands.length || c.gradeBands.some((b) => !colBands.includes(b))) errors.push(`${w} ${r.category}: 칸 학년군 이상(${c.gradeBands.join(',')})`);
          if (!c.items.length) errors.push(`${w} ${r.category}: 빈 칸`);
          for (const it of c.items) if (!it.trim() || BROKEN_GLYPH.test(it)) errors.push(`${w} ${r.category}: 내용 요소 글자 이상 '${it}'`);
        }
      }
    }
  }

  for (const x of standardNotes) {
    const want = new Map(standardsFor(x.subjectId, x.edition).map((t) => [canonicalCode(t.code), t]));
    const seen = new Map();
    const textOk = (t) => t && !BROKEN_GLYPH.test(t) && NOTE_END.test(t);
    for (const t of x.intro) if (!textOk(t)) errors.push(`${where(x)}: 성취기준 안내 문장 이상 …${t.slice(-15)}`);
    for (const sec of x.sections) {
      const w = `${where(x)} 해설 ${sec.gradeBand} ${sec.domainNo}`;
      for (const t of sec.intro) if (!textOk(t)) errors.push(`${w}: 영역 안내 문장 이상 …${t.slice(-15)}`);
      if (!sec.groups.length) errors.push(`${w}: 묶음 없음`);
      for (const g of sec.groups) {
        if (!g.codes.length) errors.push(`${w}: 목록 상자 없음`);
        const inGroup = new Set(g.codes.map(canonicalCode));
        for (const c of g.codes) {
          const t = want.get(canonicalCode(c));
          if (!t) { errors.push(`${w}: 상자 코드 ${c}이(가) 그 판 성취기준에 없습니다.`); continue; }
          seen.set(canonicalCode(c), (seen.get(canonicalCode(c)) ?? 0) + 1);
          if (t.gradeBand !== sec.gradeBand || t.domainNo !== sec.domainNo) errors.push(`${w}: ${c}의 학년군·영역(${t.gradeBand} ${t.domainNo})이 절과 다릅니다.`);
        }
        for (const t of g.intro) if (!textOk(t)) errors.push(`${w}: 하위 영역 안내 문장 이상 …${t.slice(-15)}`);
        for (const e of g.explanations) if (!e.codes.length) errors.push(`${w}: 가리키는 성취기준이 없는 해설`);
        for (const e of [...g.explanations, ...g.considerations]) {
          const outside = e.codes.filter((c) => !inGroup.has(canonicalCode(c)));
          if (outside.length) errors.push(`${w}: 상자 밖 코드 ${outside.join(',')}`);
          if (!textOk(e.text)) errors.push(`${w} ${e.codes.join(',')}: 문장 종결·글자 이상 …${String(e.text).slice(-15)}`);
        }
      }
    }
    for (const [code] of want) {
      const n = seen.get(code) ?? 0;
      if (n !== 1) errors.push(`${where(x)}: ${code}이(가) 목록 상자에 ${n}번 나옵니다(1번이어야 함).`);
    }
  }

  const merged = contentSystems.map((c) => ({
    ...c, contentSystem: { intro: c.intro, domains: c.domains }, notes: standardNotes.find((n) => keyOf(n) === keyOf(c)),
  })).filter((m) => m.notes);
  return { errors, counts: detailCounts(merged) };
}

/**
 * 과목별 성격·목표, 교수·학습 및 평가(subject-guides.json) 검증.
 *  - 판 구성: 성취기준이 있는 과목마다 최신 판이 하나 있고, 이전 판은 editionNote가 있다.
 *  - 성격 문단·총괄 목표·세부 목표는 '다.'로 끝난다. 세부 목표 번호는 (1)부터 차례대로다.
 *  - 교수·학습·평가는 각각 (1) 방향·(2) 방법 두 부분이고 항목이 있다. 항목 번호는 (가)… 꼴이고, '다.'로 끝나지
 *    않는 항목(소제목형, 2026 통합교과)은 하위 문단이 있어야 한다. 깨진 글자가 없다.
 */
export function verifyGuides(category, guides, standards, subjectById) {
  const errors = [];
  const keyOf = (s) => `${s.subjectId}@${s.edition ?? ''}`;
  const where = (s) => `${category} ${s.subjectId}${s.edition ? `@${s.edition}` : ''} 안내`;
  const keys = guides.map(keyOf);
  if (new Set(keys).size !== keys.length) errors.push(`${category}: 성격·목표 안내에 같은 과목·판이 두 번 있습니다.`);
  for (const id of new Set(standards.filter((x) => !x.edition).map((x) => x.subjectId))) {
    if (!guides.some((g) => g.subjectId === id && !g.edition)) errors.push(`${category} ${id}: 최신 판 성격·목표, 교수·학습 및 평가가 없습니다.`);
  }
  const sentence = (t) => typeof t === 'string' && t.trim() && !BROKEN_GLYPH.test(t) && /다\.$/.test(t);
  const clean = (t) => typeof t === 'string' && t.trim() && !BROKEN_GLYPH.test(t);
  for (const g of guides) {
    const w = where(g);
    if (!subjectById.has(g.subjectId)) errors.push(`${w}: 미지 과목`);
    else if (subjectById.get(g.subjectId).category !== category) errors.push(`${w}: 과목 카테고리 불일치`);
    if (g.edition && !g.editionNote) errors.push(`${w}: 이전 판 안내(editionNote) 누락`);
    if (!g.nature?.sections?.length) errors.push(`${w}: 성격 없음`);
    for (const sec of g.nature?.sections ?? []) {
      if (!/성격$/.test(sec.heading)) errors.push(`${w}: 성격 머리글 이상 '${sec.heading}'`);
      if (!sec.paragraphs.length) errors.push(`${w}: '${sec.heading}' 문단 없음`);
      for (const t of sec.paragraphs) if (!sentence(t)) errors.push(`${w} 성격: 문장 종결·글자 이상 …${String(t).slice(-15)}`);
    }
    if (!g.goals?.overall?.length || !g.goals?.items?.length) errors.push(`${w}: 목표(총괄·세부) 없음`);
    for (const t of g.goals?.overall ?? []) if (!sentence(t)) errors.push(`${w} 총괄 목표: 문장 이상 …${String(t).slice(-15)}`);
    (g.goals?.items ?? []).forEach((it, i) => {
      if (it.no !== `(${i + 1})`) errors.push(`${w} 세부 목표: ${i + 1}번째 번호가 ${it.no}`);
      if (!sentence(it.text)) errors.push(`${w} 세부 목표 ${it.no}: 문장 이상 …${String(it.text).slice(-15)}`);
    });
    for (const [key, word] of [['teachingLearning', '교수·학습'], ['assessment', '평가']]) {
      const grp = g[key];
      if (!grp) { errors.push(`${w}: ${word} 없음`); continue; }
      if (grp.parts.map((x) => x.id).join(',') !== 'direction,methods') errors.push(`${w} ${word}: 부분 구성이 (1) 방향·(2) 방법이 아닙니다.`);
      for (const part of grp.parts) {
        if (part.heading !== null && !part.heading.includes(word)) errors.push(`${w} ${word}: 부분 머리글 이상 '${part.heading}'`);
        if (!part.items.length) errors.push(`${w} ${word} ${part.id}: 항목 없음`);
        for (const it of part.items) {
          if (!/^\(.\)$/.test(it.no) || !ITEM_ORDER.includes(it.no.slice(1, -1))) errors.push(`${w} ${word} ${part.id}: 항목 번호 이상 ${it.no}`);
          if (!clean(it.text)) errors.push(`${w} ${word} ${part.id} ${it.no}: 글자 이상`);
          else if (!/다\.$/.test(it.text) && !it.subItems?.length) errors.push(`${w} ${word} ${part.id} ${it.no}: '다.'로 끝나지 않는 항목에 하위 문단이 없습니다 …${it.text.slice(-15)}`);
          for (const t of it.subItems ?? []) if (!clean(t)) errors.push(`${w} ${word} ${part.id} ${it.no}: 하위 문단 글자 이상`);
        }
      }
    }
  }
  return { errors, counts: guideCounts(guides) };
}

/**
 * 편성·운영 데이터 검증: 배당표 검산(교과(군) 합 = 소계, 소계 + 나머지 = 총계, 1~2학년 교과
 * 목록 합 = 소계), 조항 번호 연속성(가나다…·1,2,3…·(1),(2)…), 문장 종결.
 */
export function verifyOperation(op) {
  const errors = [];
  const ids = op.levels.map((l) => l.id).join(',');
  if (ids !== 'elementary,middle,high') errors.push(`편성·운영 학교급 구성 이상: ${ids}`);
  const ordinal = (no, i) => {
    if (/^\d+\)$/.test(no)) return no === `${i + 1})`;
    if (/^\(\d+\)$/.test(no)) return no === `(${i + 1})`;
    return no === `${HANGUL_ORDER[i]})`;
  };
  const checkItems = (items, where) => {
    (items ?? []).forEach((it, i) => {
      if (!ordinal(it.no, i)) errors.push(`${where}: ${i + 1}번째 항목 번호가 ${it.no}`);
      if (!/다\.(\s*<[^>]+>)?$/.test(it.text)) errors.push(`${where} ${it.no}: 문장 종결 이상 …${it.text.slice(-15)}`);
      checkItems(it.children, `${where} ${it.no}`);
    });
  };
  for (const l of op.levels) {
    const where = `편성·운영 ${l.labelKorean}`;
    if (!l.organization.items.length) errors.push(`${where}: 편제 항목 없음`);
    if (!l.criteria.items.length) errors.push(`${where}: 운영 기준 항목 없음`);
    checkItems(l.organization.items, `${where} 편제`);
    checkItems(l.criteria.items, `${where} 운영 기준`);
    const a = l.allotment;
    if (!a?.tableNo) { errors.push(`${where}: 배당표 없음`); continue; }
    a.notes.forEach((n, i) => {
      if (!n.startsWith('①②③④⑤⑥⑦⑧⑨⑩'[i])) errors.push(`${where} ${a.tableNo} 주석 ${i + 1}번째 번호 이상`);
    });
    const subtotal = a.totals.find((t) => t.kind === 'subtotal');
    const total = a.totals.find((t) => t.kind === 'total');
    if (!subtotal || !total) { errors.push(`${where} ${a.tableNo}: 소계·총계 행 없음`); continue; }
    for (const col of a.columns) {
      const list = a.breakdown?.[col];
      const group = list
        ? list.reduce((s, b) => s + num(b.value), 0)
        : a.rows.reduce((s, r) => s + num(r.values[col]), 0);
      if (group !== num(subtotal.values[col])) errors.push(`${where} ${a.tableNo} ${col}: 교과(군) 합 ${group} ≠ 소계 ${subtotal.values[col]}`);
      const rest = a.totals.filter((t) => !t.kind).reduce((s, t) => s + num(t.values[col]), 0);
      if (num(subtotal.values[col]) + rest !== num(total.values[col])) {
        errors.push(`${where} ${a.tableNo} ${col}: 소계+나머지 ${num(subtotal.values[col]) + rest} ≠ 총계 ${total.values[col]}`);
      }
    }
    for (const [band, col] of Object.entries(a.columnByGradeBand ?? {})) {
      if (!a.columns.includes(col)) errors.push(`${where}: 학년군 ${band}의 열 ${col}이 표에 없음`);
      if (!l.gradeBands.includes(band)) errors.push(`${where}: 학년군 ${band}이 학교급 학년군에 없음`);
    }
  }
  return errors;
}

export function computeManifestFiles(dataDir) {
  const files = {};
  const rels = ['subjects.json', ...listCategories(dataDir).flatMap((c) => CATEGORY_FILES.map((f) => `${c}/${f}`))];
  for (const c of listCategories(dataDir)) {
    for (const f of [...DETAIL_FILES, GUIDE_FILE]) if (existsSync(join(dataDir, c, f))) rels.push(`${c}/${f}`);
  }
  if (existsSync(join(dataDir, OPERATION_FILE))) rels.push(OPERATION_FILE);
  for (const rel of rels) {
    files[rel] = { sha256: createHash('sha256').update(readFileSync(join(dataDir, rel))).digest('hex') };
  }
  return files;
}

export function writeManifest(dataDir, { release, counts, sourceNotice }) {
  const manifest = { taxonomyVersion: release, sourceNotice, counts, files: computeManifestFiles(dataDir) };
  writeFileSync(join(dataDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return manifest;
}

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(join(defaultDataDir, 'subjects.json'))) {
    console.error('… data/kr에 출시 데이터가 아직 없습니다 (pipeline:extract 이전). 검증 생략.');
    return;
  }
  const gatesPath = join(here, 'gates.json');
  const gates = existsSync(gatesPath) ? JSON.parse(readFileSync(gatesPath, 'utf8')) : null;
  if (!gates) console.error('⚠ pipeline/gates.json 없음 — 수량 게이트 없이 무결성만 검사합니다.');
  const { errors, counts } = verifyAll(defaultDataDir, gates);
  if (errors.length) {
    console.error(`✗ 검증 실패 ${errors.length}건:`);
    for (const e of errors.slice(0, 80)) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (check) {
    const manifest = JSON.parse(readFileSync(join(defaultDataDir, 'manifest.json'), 'utf8'));
    const current = computeManifestFiles(defaultDataDir);
    const stale = Object.keys(current).filter((rel) => manifest.files?.[rel]?.sha256 !== current[rel].sha256);
    if (stale.length) {
      console.error(`✗ manifest.json이 데이터와 어긋남: ${stale.join(', ')} — pipeline:verify를 실행하세요.`);
      process.exit(1);
    }
    console.error(`✓ 검증 통과 (manifest 일치) — 성취기준 ${counts.standards}건`);
    return;
  }
  const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  writeManifest(defaultDataDir, {
    release: `v${pkg.version}`,
    counts,
    sourceNotice: [...new Set(sources.annexes
      .filter((a) => a.role !== 'operation-check')
      .map((a) => `${a.notice} 【별책 ${a.annexNo}】 ${a.titleKorean}${a.section ? ` (${a.section})` : ''}`))],
  });
  const op = counts.operation ? ` · 편성·운영 ${counts.operation.organizationItems + counts.operation.criteriaItems}항` : '';
  const total = (key, k) => Object.values(counts[key] ?? {}).reduce((n, c) => n + (c[k] ?? 0), 0);
  const det = counts.details ? ` · 내용 체계 ${total('details', 'contentSystemDomains')}영역 · 해설 ${total('details', 'explanations')}·고려 사항 ${total('details', 'considerations')}문단` : '';
  const gd = counts.guides ? ` · 성격·목표/교수·학습 및 평가 ${total('guides', 'subjects')}과목` : '';
  console.error(`✓ 검증 통과 — 과목 ${counts.subjects} · 성취기준 ${counts.standards}건${det}${gd}${op}, manifest.json 기록`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
