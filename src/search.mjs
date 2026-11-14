import { GRADE_BANDS, canonicalCode, normalizeText, resolveGradeBand } from './normalize.mjs';

export { normalizeText };

const MAX_LIMIT = 50;
const BAND_ORDER = new Map(GRADE_BANDS.map((b) => [b.id, b.order]));

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
  if (category) list = list.filter((s) => s.category === category);
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

/** 학년군 개요: 그 학년군에서 과목별 영역·성취기준 수. 개별화교육계획 범위 잡기에 쓴다. */
export function gradeBandOverview(store, gradeBand) {
  const list = filterStandards(store, { gradeBand, editions: 'current' });
  const bySubject = new Map();
  for (const s of list) {
    if (!bySubject.has(s.subjectId)) {
      bySubject.set(s.subjectId, { subjectId: s.subjectId, subjectKorean: s.subjectKorean, standardCount: 0, domains: new Map() });
    }
    const entry = bySubject.get(s.subjectId);
    entry.standardCount += 1;
    entry.domains.set(s.domainNo, s.domainKorean);
  }
  return [...bySubject.values()]
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId, 'en'))
    .map((e) => ({
      subjectId: e.subjectId, subjectKorean: e.subjectKorean, standardCount: e.standardCount,
      domains: [...e.domains.entries()].sort().map(([, name]) => name),
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
