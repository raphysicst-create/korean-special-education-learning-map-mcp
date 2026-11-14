// 별책·카테고리·수록 범위 판정. pipeline/subjects.json의 categories·mappings·outOfScope와
// sources.json의 annex(categories)를 함께 본다.
//  - 별책 3(기본 교육과정)은 카테고리 basic 하나.
//  - 별책 2는 유치원·공통·선택 중심 교육과정이 한 파일이고, 이 패키지는 그중 특수교육 전문 교과
//    (special-vocational: 직업·생활, ilyo: 이료)만 싣는다. 나머지 접두어는 outOfScope로 밝혀야 한다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRoman } from '../src/normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function loadSubjectConfig(path = join(here, 'subjects.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 출처 하나가 내는 카테고리 목록. */
export function annexCategories(annex) {
  const list = annex.categories ?? (annex.category ? [annex.category] : []);
  if (!list.length) throw new Error(`${annex.id}: category(또는 categories)가 없습니다.`);
  return list;
}

const bandOk = (entry, bandCode) => !entry.bandCodes || entry.bandCodes.includes(String(bandCode));

/**
 * 코드 접두어·학년군 코드 → 수록 판정.
 *  { category, map } — 수록 과목, { outOfScope } — 범위 밖으로 밝힌 것, null — 대응표에 없음(실패 대상).
 * 같은 접두어가 두 카테고리에 걸리면 대응표 오류다.
 */
export function routeCode({ prefix, bandCode }, annex, config) {
  const key = normalizeRoman(prefix);
  const hits = [];
  for (const category of annexCategories(annex)) {
    const map = config.mappings?.[category]?.[key];
    if (map && bandOk(map, bandCode)) hits.push({ category, map });
  }
  if (hits.length > 1) throw new Error(`접두어 '${key}'(${bandCode})가 카테고리 ${hits.map((h) => h.category).join('·')}에 함께 있습니다.`);
  if (hits.length) return hits[0];
  const oos = (config.outOfScope ?? []).find((o) => o.annexNo === annex.annexNo
    && o.prefixes.map(normalizeRoman).includes(key) && bandOk(o, bandCode));
  return oos ? { outOfScope: oos } : null;
}

/** 카테고리들의 대응표를 접두어 키 하나로 합친다(카테고리를 달아서). 같은 키가 겹치면 실패. */
export function mergedMappings(categories, config) {
  const out = {};
  for (const category of categories) {
    for (const [prefix, map] of Object.entries(config.mappings?.[category] ?? {})) {
      if (out[prefix]) throw new Error(`접두어 '${prefix}'가 카테고리 ${out[prefix].category}·${category}에 함께 있습니다.`);
      out[prefix] = { ...map, category };
    }
  }
  return out;
}

/** 카테고리 표시 정보(교육과정·교과(군)) — subjects.json categories. */
export function categoryInfo(category, config) {
  const info = config.categories?.[category];
  if (!info) throw new Error(`subjects.json categories에 '${category}'가 없습니다.`);
  return info;
}
