import { GRADE_BANDS, canonicalCode, normalizeText, resolveGradeBand } from './normalize.mjs';

export { normalizeText };

const MAX_LIMIT = 50;
const BAND_ORDER = new Map(GRADE_BANDS.map((b) => [b.id, b.order]));

// 카테고리(데이터 폴더): 기본 교육과정 → 특수교육 전문 교과 직업·생활 → 이료 순.
export const CATEGORY_ORDER = ['basic', 'special-vocational', 'ilyo'];
const categoryRank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
const CATEGORY_ALIASES = [
  [/^(?:basic|기본|기본교육과정)$/, ['basic']],
  [/^(?:special-vocational|직업·생활|직업생활|직업)$/, ['special-vocational']],
  [/^(?:ilyo|이료)$/, ['ilyo']],
  [/^(?:(?:특수교육)?전문교과|선택중심(?:교육과정)?|special)$/, ['special-vocational', 'ilyo']],
];

/**
 * 카테고리 입력 → 카테고리 id 배열. 'basic'·'기본 교육과정', 'special-vocational'·'직업·생활', 'ilyo'·'이료',
 * '전문 교과'(직업·생활 + 이료)를 받는다. 이 설치본에 없는 카테고리는 뺀다. 못 풀면 null.
 */
export function resolveCategories(store, input) {
  if (!input) return null;
  const raw = normalizeText(input).replace(/\s+/g, '');
  const hit = CATEGORY_ALIASES.find(([re]) => re.test(raw));
  if (!hit) return null;
  const list = hit[1].filter((c) => store.categories.includes(c));
  return list.length ? list : null;
}

/** 카테고리 요약: 교육과정·교과(군)·과목 수·성취기준 수(최신 판). */
export function categorySummary(store) {
  return [...store.categories].sort((a, b) => categoryRank(a) - categoryRank(b)).map((category) => {
    const subjects = store.subjects.filter((s) => s.category === category);
    const first = subjects[0] ?? {};
    return {
      category,
      ...(first.curriculumKorean ? { curriculumKorean: first.curriculumKorean } : {}),
      ...(first.subjectGroupKorean ? { subjectGroupKorean: first.subjectGroupKorean } : {}),
      subjects: subjects.length,
      standards: subjects.reduce((n, s) => n + s.standardCount, 0),
    };
  });
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, substitution);
    }
    prev = current;
  }
  return prev[b.length];
}

export function suggestSimilar(input, candidates, { max = 3 } = {}) {
  const norm = normalizeText(input);
  const threshold = Math.max(2, Math.ceil(norm.length / 3));
  return candidates
    .map((candidate) => {
      const c = normalizeText(candidate);
      if (c.includes(norm) || norm.includes(c)) return { candidate, distance: 0 };
      return { candidate, distance: levenshtein(norm, c) };
    })
    .filter((e) => e.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map((e) => e.candidate);
}

/** 과목명·과목 id·코드 접두어 어느 것으로도 과목을 찾는다(공백 무시). */
export function resolveSubject(store, input) {
  if (!input) return null;
  const squash = (v) => normalizeText(v).replace(/\s+/g, '');
  const target = squash(input);
  return store.subjects.find(
    (s) => s.id === input || squash(s.subjectKorean) === target || s.codePrefix === input
  ) ?? null;
}

export function byCurriculumOrder(a, b) {
  return (BAND_ORDER.get(a.gradeBand) - BAND_ORDER.get(b.gradeBand))
    || a.subjectId.localeCompare(b.subjectId, 'en')
    || a.domainNo.localeCompare(b.domainNo)
    || a.itemNo.localeCompare(b.itemNo)
    || (a.edition ? 1 : 0) - (b.edition ? 1 : 0);
}

export function compactStandard(store, s) {
  return {
    code: s.code,
    category: s.category,
    subjectKorean: s.subjectKorean,
    gradeBand: s.gradeBand,
    domainKorean: s.domainKorean,
    text: store.textsByKey.get(s.key),
    ...(s.edition ? { edition: s.edition, editionNote: s.editionNote } : {}),
    // 시행 시기 안내가 있는 과목(건강한 생활·즐거운 생활 최신 판)은 검색 결과에도 안내를 붙인다.
    ...(!s.edition && store.subjectsById?.get(s.subjectId)?.note
      ? { subjectNote: store.subjectsById.get(s.subjectId).note } : {}),
  };
}

/**
 * editions: 'all'(최신 판 + 시행 중인 이전 판) | 'current'(최신 판만) | 'previous'(이전 판만).
 * 이전 판은 같은 코드를 최신 판과 함께 쓰므로 로드맵·개요·수량은 'current'로 센다.
 */
function filterStandards(store, { subjectId, gradeBand, domain, category, editions = 'all' }) {
  let list = store.allStandards;
  if (editions === 'current') list = list.filter((s) => !s.edition);
  if (editions === 'previous') list = list.filter((s) => s.edition);
  if (category) {
    const wanted = new Set([].concat(category));
    list = list.filter((s) => wanted.has(s.category));
  }
  if (subjectId) list = list.filter((s) => s.subjectId === subjectId);
  if (gradeBand) list = list.filter((s) => s.gradeBand === gradeBand);
  if (domain) {
    const d = normalizeText(domain);
    list = list.filter((s) => normalizeText(s.domainKorean).includes(d));
  }
  return list;
}

/**
 * 코드·키워드 검색. 원문 본문까지 대상으로 하므로(원문이 곧 성취기준이다) 별도 요약 필드가 없다.
 * 점수: 코드 완전일치 100 > 코드 부분일치 50 > 영역명 8 > 원문 5 > 과목명 3.
 */
export function searchStandards(store, { query, subjectId, gradeBand, domain, category, limit = 20 } = {}) {
  const cap = Math.min(limit, MAX_LIMIT);
  let candidates = filterStandards(store, { subjectId, gradeBand, domain, category });
  if (query) {
    const q = normalizeText(query);
    const codeQ = normalizeText(canonicalCode(query));
    // 부분 코드도 canonicalCode와 같은 규칙으로 맞춘다 — '[9수학04'·'09생영'이 '[09수학04-01]'에 닿게.
    const partialQ = q.replace(/\s+/g, '').replace(/^(\[?)0+(?=\d)/, '$1');
    candidates = candidates
      .map((s) => {
        const code = normalizeText(canonicalCode(s.code));
        let score = 0;
        if (code === codeQ) score += 100;
        else if (partialQ && code.includes(partialQ)) score += 50;
        if (normalizeText(s.domainKorean).includes(q)) score += 8;
        if (normalizeText(store.textsByKey.get(s.key)).includes(q)) score += 5;
        if (normalizeText(s.subjectKorean).includes(q)) score += 3;
        return { s, score };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score || byCurriculumOrder(a.s, b.s))
      .map((e) => e.s);
  } else {
    candidates = [...candidates].sort(byCurriculumOrder);
  }
  return {
    total: candidates.length,
    results: candidates.slice(0, cap).map((s) => compactStandard(store, s)),
  };
}

/** 과목 로드맵: 학년군 → 영역 → 성취기준. 문서 순서 그대로이며 새 순서를 만들지 않는다. 기본은 최신 판. */
export function buildRoadmap(store, { subjectId, gradeBand, editions = 'current' }) {
  const list = filterStandards(store, { subjectId, gradeBand, editions }).slice().sort(byCurriculumOrder);
  const bands = [];
  for (const s of list) {
    let band = bands.at(-1);
    if (!band || band.gradeBand !== s.gradeBand) {
      band = { gradeBand: s.gradeBand, gradeBandKorean: s.gradeBandKorean, domains: [] };
      bands.push(band);
    }
    let domain = band.domains.at(-1);
    if (!domain || domain.domainNo !== s.domainNo) {
      domain = { domainNo: s.domainNo, domainKorean: s.domainKorean, standards: [] };
      band.domains.push(domain);
    }
    domain.standards.push({ code: s.code, text: store.textsByKey.get(s.key) });
  }
  return { standardCount: list.length, gradeBands: bands };
}

/**
 * 학년군 개요: 그 학년군에서 과목별 영역·성취기준 수. 개별화교육계획 범위 잡기에 쓴다.
 * 고1~3은 기본 교육과정 과목 뒤에 특수교육 전문 교과(직업·생활, 이료) 과목이 category와 함께 나온다.
 */
export function gradeBandOverview(store, gradeBand, { category } = {}) {
  const list = filterStandards(store, { gradeBand, category, editions: 'current' });
  const bySubject = new Map();
  for (const s of list) {
    if (!bySubject.has(s.subjectId)) {
      const meta = store.subjectsById?.get(s.subjectId);
      bySubject.set(s.subjectId, {
        subjectId: s.subjectId, subjectKorean: s.subjectKorean, category: s.category,
        ...(meta?.subjectGroupKorean ? { subjectGroupKorean: meta.subjectGroupKorean } : {}),
        standardCount: 0, domains: new Map(),
      });
    }
    const entry = bySubject.get(s.subjectId);
    entry.standardCount += 1;
    entry.domains.set(s.domainNo, s.domainKorean);
  }
  return [...bySubject.values()]
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.subjectId.localeCompare(b.subjectId, 'en'))
    .map(({ domains, ...e }) => ({
      ...e, domains: [...domains.entries()].sort().map(([, name]) => name),
    }));
}

/**
 * 성취기준 하나의 해설·고려 사항(같은 판). edition이 null이면 최신 판. 없으면 null.
 *  - explanation: 이 성취기준의 '성취기준 해설' 문단(여러 성취기준을 함께 다룬 문단은 sharedWith)
 *  - considerations: 이 성취기준을 가리키는 '적용 시 고려 사항' 문단
 *  - sharedConsiderations: 코드 없이 같은 목록 상자 전체에 해당하는 고려 사항
 *  - domainIntro / subAreaIntro: 영역(통합교과는 과목) 성취기준 안내, 하위 영역 안내
 */
export function notesForStandard(store, s, edition = s.edition ?? null) {
  const code = canonicalCode(s.code);
  const hit = (store.notesByCode?.get(code) ?? [])
    .find((n) => n.subjectNotes.subjectId === s.subjectId && (n.subjectNotes.edition ?? null) === edition);
  if (!hit) return null;
  const { section, group } = hit;
  const mine = (e) => e.codes.some((c) => canonicalCode(c) === code);
  const fmt = (e) => {
    const others = e.codes.filter((c) => canonicalCode(c) !== code);
    return { ...(e.label ? { label: e.label } : {}), text: e.text, ...(others.length ? { sharedWith: others } : {}) };
  };
  const shared = group.considerations.filter((e) => e.codes.length === 0).map(fmt);
  return {
    ...(section.intro.length ? { domainIntro: section.intro } : {}),
    ...(group.subArea ? { subArea: group.subArea.name } : {}),
    ...(group.intro.length ? { subAreaIntro: group.intro } : {}),
    explanation: group.explanations.filter(mine).map(fmt),
    considerations: group.considerations.filter(mine).map(fmt),
    ...(shared.length ? { sharedConsiderations: shared } : {}),
  };
}

/** 과목의 내용 체계 판 목록(최신 판 먼저). */
export function contentSystemEntries(store, subjectId) {
  return (store.contentSystems ?? [])
    .filter((s) => s.subjectId === subjectId)
    .sort((a, b) => (a.edition ? 1 : 0) - (b.edition ? 1 : 0));
}

/**
 * 내용 체계 한 판 → 보기. gradeBand를 주면 그 학년군 칸만 남기고, 여러 학년군에 걸친 병합 칸은
 * sharedWithGradeBands로 알린다. domain은 영역명 부분 일치 또는 영역 번호.
 */
export function contentSystemView(entry, { gradeBand, domain } = {}) {
  let domains = entry.domains;
  if (domain) {
    const d = normalizeText(domain);
    const no = /^\d{1,2}$/.test(String(domain).trim()) ? String(domain).trim().padStart(2, '0') : null;
    domains = domains.filter((x) => x.domainNo === no || normalizeText(x.domainKorean).includes(d));
  }
  if (gradeBand) domains = domains.filter((x) => x.columns.some((c) => c.gradeBand === gradeBand));
  return {
    ...(entry.edition ? { edition: entry.edition, editionNote: entry.editionNote } : {}),
    ...(entry.intro.length ? { intro: entry.intro } : {}),
    domains: domains.map((d) => ({
      domainNo: d.domainNo,
      domainKorean: d.domainKorean,
      gradeBands: d.columns.map((c) => c.gradeBand),
      // 이료 과목 표는 '내용 요소' 아래 열이 하위 영역이다 — 표의 열 순서(행의 subArea와 같은 이름).
      ...(d.subAreas ? { subAreas: d.subAreas } : {}),
      coreIdeas: d.coreIdeas,
      contentElements: d.rows.map((r) => {
        const head = { category: r.category, ...(r.subArea ? { subArea: r.subArea } : {}) };
        if (!gradeBand) return { ...head, cells: r.cells };
        const cell = r.cells.find((c) => c.gradeBands.includes(gradeBand));
        const others = cell ? cell.gradeBands.filter((b) => b !== gradeBand) : [];
        return { ...head, items: cell?.items ?? [], ...(others.length ? { sharedWithGradeBands: others } : {}) };
      }).filter((r) => (r.cells ?? r.items).length),
    })),
  };
}

// 과목 안내(성격·목표, 교수·학습 및 평가)의 부분 이름 → 데이터 필드.
export const GUIDE_PARTS = new Map([
  ['성격', 'nature'], ['목표', 'goals'], ['교수·학습', 'teachingLearning'], ['평가', 'assessment'],
]);

/** 과목 안내의 판 목록(최신 판 먼저). */
export function guideEntries(store, subjectId) {
  return (store.subjectGuides ?? [])
    .filter((g) => g.subjectId === subjectId)
    .sort((a, b) => (a.edition ? 1 : 0) - (b.edition ? 1 : 0));
}

/** 과목 안내 한 판 → 보기. part('성격'|'목표'|'교수·학습'|'평가')를 주면 그 부분만. */
export function guideView(entry, part) {
  const fields = part ? [GUIDE_PARTS.get(part)] : [...GUIDE_PARTS.values()];
  return {
    ...(entry.edition ? { edition: entry.edition, editionNote: entry.editionNote } : {}),
    ...Object.fromEntries(fields.map((f) => [f, entry[f]])),
  };
}

/** 안내 한 판 → 검색 단위 문단 목록(문서 순서). */
function guideUnits(g) {
  const out = [];
  for (const sec of g.nature.sections) for (const text of sec.paragraphs) out.push({ part: '성격', heading: sec.heading, text });
  for (const text of g.goals.overall) out.push({ part: '목표', heading: g.goals.heading, text });
  for (const it of g.goals.items) out.push({ part: '목표', heading: g.goals.heading, no: it.no, text: it.text });
  for (const [part, group] of [['교수·학습', g.teachingLearning], ['평가', g.assessment]]) {
    for (const p of group.parts) {
      for (const it of p.items) {
        out.push({ part, heading: p.heading ?? group.heading, no: it.no, text: it.text, subItems: it.subItems ?? [] });
      }
    }
  }
  return out;
}

/**
 * 과목 안내 키워드 검색(최신 판). 문단·항목·하위 문단에서 NFC·부분 일치로 찾는다. 항목은 하위 문단이 맞아도
 * 나오고, 맞은 하위 문단만 matchedSubItems로 붙인다. 순서: 카테고리 → 과목 id → 문서 순서.
 */
export function searchGuides(store, { query, subjectId, categories, part, limit = 20 } = {}) {
  const cap = Math.min(limit, MAX_LIMIT);
  const q = normalizeText(query);
  const guides = (store.subjectGuides ?? [])
    .filter((g) => !g.edition && (!subjectId || g.subjectId === subjectId) && (!categories || categories.includes(g.category)))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.subjectId.localeCompare(b.subjectId, 'en'));
  const hits = [];
  for (const g of guides) {
    for (const u of guideUnits(g)) {
      if (part && u.part !== part) continue;
      const inText = normalizeText(u.text).includes(q);
      const subs = (u.subItems ?? []).filter((t) => normalizeText(t).includes(q));
      if (!inText && !subs.length) continue;
      hits.push({
        subjectId: g.subjectId, subjectKorean: g.subjectKorean, category: g.category,
        part: u.part, heading: u.heading, ...(u.no ? { no: u.no } : {}), text: u.text,
        ...(subs.length ? { matchedSubItems: subs } : {}),
      });
    }
  }
  return { total: hits.length, results: hits.slice(0, cap) };
}

/** 조항 수: 세부 항목(가)·(1))까지 센다. */
export function countItems(items) {
  return (items ?? []).reduce((n, it) => n + 1 + countItems(it.children), 0);
}

const LEVEL_ALIASES = [
  ['elementary', /^(?:초|초등|초등학교|elementary|e)$/i],
  ['middle', /^(?:중|중등|중학교|middle|m)$/i],
  ['high', /^(?:고|고등|고등학교|high|h)$/i],
];

/**
 * 학교급 입력(초등학교·중·high …) 또는 학년군(초3~4·e5-6 …)을 편성·운영 학교급으로 푼다.
 * 학년군으로 주면 그 학년군의 배당표 열(focus)도 돌려준다. 못 풀면 null.
 */
export function resolveSchoolLevel(store, input) {
  if (!store.operation || !input) return null;
  const raw = String(input).normalize('NFC').trim().replace(/\s+/g, '');
  const byId = (id) => store.operation.levels.find((l) => l.id === id) ?? null;
  for (const [id, re] of LEVEL_ALIASES) if (re.test(raw)) return { level: byId(id), focus: null };
  const band = resolveGradeBand(input);
  if (!band) return null;
  const level = store.operation.levels.find((l) => l.gradeBands.includes(band)) ?? null;
  if (!level) return null;
  return { level, focus: { gradeBand: band, column: level.allotment.columnByGradeBand?.[band] ?? null } };
}

/** 학년군의 배당 기준(교과(군)별 시수·학점과 소계·총계)을 그 학년군 열만 뽑아 돌려준다. */
export function allotmentForBand(store, band) {
  const level = store.operation?.levels.find((l) => l.gradeBands.includes(band));
  if (!level) return null;
  const a = level.allotment;
  const column = a.columnByGradeBand?.[band];
  if (!column) return null;
  const subjects = a.breakdown?.[column]
    ? a.breakdown[column].map((b) => ({ label: b.label, value: b.value }))
    : a.rows.filter((r) => r.values[column] !== undefined).map((r) => ({ label: r.label, value: r.values[column] }));
  return {
    schoolLevel: level.labelKorean, tableNo: a.tableNo, title: a.title, unit: a.unit, column,
    groupLabel: a.groupLabel, groups: subjects,
    totals: a.totals.map((t) => ({ label: t.label, value: t.values[column] })),
    ...(level.note && column === '1~2학년' ? { note: level.note } : {}),
  };
}
