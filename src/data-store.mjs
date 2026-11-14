import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADE_BANDS, canonicalCode } from './normalize.mjs';

const defaultDataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'kr');

function readVerified(dataDir, manifest, rel) {
  const expected = manifest.files[rel];
  if (!expected) throw new Error(`manifest.json에 ${rel} 항목이 없습니다.`);
  const raw = readFileSync(join(dataDir, rel));
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== expected.sha256) {
    throw new Error(
      `${rel} 체크섬 불일치 — 설치본이 손상되었습니다. 패키지를 재설치하세요. (manifest=${expected.sha256}, 실제=${sha256})`
    );
  }
  return JSON.parse(raw.toString('utf8'));
}

/**
 * v0.1 데이터는 수천 건 규모라 시작 시 전부 로드한다. 카테고리(basic 등)는 폴더 단위이며
 * manifest.files에 기록된 폴더만 수록된 것으로 본다 — v0.2에서 전문 교과 폴더가 늘어나도
 * 로더는 바뀌지 않는다.
 */
export function createStore(dataDir = defaultDataDir) {
  const manifestPath = join(dataDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('수록 데이터가 없습니다 (data/kr/manifest.json 없음). 파이프라인을 먼저 실행하세요.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { subjects } = readVerified(dataDir, manifest, 'subjects.json');
  const categories = [...new Set(
    Object.keys(manifest.files).filter((rel) => rel.includes('/')).map((rel) => rel.split('/')[0])
  )].sort();

  const allStandards = [];
  const textsByKey = new Map();
  for (const category of categories) {
    const { standards } = readVerified(dataDir, manifest, `${category}/curriculum-standards.json`);
    const { texts } = readVerified(dataDir, manifest, `${category}/standard-texts.json`);
    for (const t of texts) textsByKey.set(t.key, t.text);
    for (const s of standards) {
      if (!textsByKey.has(s.key)) {
        throw new Error(`원문 없는 성취기준 ${s.key} — pipeline:verify를 실행하세요.`);
      }
      allStandards.push(s);
    }
  }

  const standardsByCode = new Map();
  const standardsByKey = new Map();
  // standardsByCode의 키는 canonicalCode — '[09수학04-01]'을 '[9수학04-01]'로도 찾는다.
  for (const s of allStandards) {
    const code = canonicalCode(s.code);
    if (!standardsByCode.has(code)) standardsByCode.set(code, []);
    standardsByCode.get(code).push(s);
    standardsByKey.set(s.key, s);
  }

  // 【별책 1】 기본 교육과정 편성·운영(편제·배당표·운영 기준). manifest에 있을 때만 싣는다.
  const operation = manifest.files['operation-guidelines.json']
    ? readVerified(dataDir, manifest, 'operation-guidelines.json')
    : null;

  return {
    manifest, subjects, categories, allStandards, textsByKey, operation,
    standardsByCode, standardsByKey,
    subjectsById: new Map(subjects.map((s) => [s.id, s])),
    gradeBands: GRADE_BANDS,
  };
}
