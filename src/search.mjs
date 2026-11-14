import { GRADE_BANDS, canonicalCode, normalizeText } from './normalize.mjs';

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
    || a.itemNo.localeCompare(b.itemNo);
}

export function compactStandard(store, s) {
  return {
    code: s.code,
    subjectKorean: s.subjectKorean,
    gradeBand: s.gradeBand,
    domainKorean: s.domainKorean,
    text: store.textsByKey.get(s.key),
  };
}

function filterStandards(store, { subjectId, gradeBand, domain, category }) {
  let list = store.allStandards;
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

/** 과목 로드맵: 학년군 → 영역 → 성취기준. 문서 순서 그대로이며 새 순서를 만들지 않는다. */
export function buildRoadmap(store, { subjectId, gradeBand }) {
  const list = filterStandards(store, { subjectId, gradeBand }).slice().sort(byCurriculumOrder);
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
  const list = filterStandards(store, { gradeBand });
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
