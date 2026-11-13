#!/usr/bin/env node
// 산출물 전수 검증 + data/kr/manifest.json 기록. 데이터 변경 후 반드시 실행한다.
//   npm run pipeline:verify        — 검증 통과 시 manifest 갱신
//   npm run pipeline:verify:check  — manifest를 쓰지 않고, 현재 파일 해시와 일치하는지만 확인(CI용)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADE_BANDS, normalizeCode, parseBasicCode } from '../src/normalize.mjs';

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

export function verifyAll(dataDir = defaultDataDir, gates = null) {
  const read = (rel) => JSON.parse(readFileSync(join(dataDir, rel), 'utf8'));
  const errors = [];
  const { subjects } = read('subjects.json');
  const subjectById = new Map();
  for (const s of subjects) {
    if (subjectById.has(s.id)) errors.push(`과목 id 중복: ${s.id}`);
    subjectById.set(s.id, s);
  }

  const counts = { subjects: subjects.length, standards: 0, categories: {} };
  const perSubject = new Map();
  for (const category of listCategories(dataDir)) {
    const { standards } = read(`${category}/curriculum-standards.json`);
    const { texts } = read(`${category}/standard-texts.json`);
    const keys = new Set();
    const codes = new Set();
    for (const s of standards) {
      if (keys.has(s.key)) errors.push(`성취기준 key 중복: ${s.key}`);
      keys.add(s.key);
      if (codes.has(normalizeCode(s.code))) errors.push(`${category} 안 코드 중복: ${s.code}`);
      codes.add(normalizeCode(s.code));
      if (s.category !== category) errors.push(`카테고리 폴더 불일치: ${s.key}`);
      if (!subjectById.has(s.subjectId)) errors.push(`미지 과목: ${s.key} → ${s.subjectId}`);
      if (!BAND_IDS.has(s.gradeBand)) errors.push(`미지 학년군: ${s.key} → ${s.gradeBand}`);
      const parsed = parseBasicCode(s.code);
      if (!parsed) errors.push(`코드 형식 오류: ${s.code}`);
      else if (parsed.gradeBand !== s.gradeBand) errors.push(`코드-학년군 불일치: ${s.code} (${s.gradeBand})`);
      if (!s.domainKorean) errors.push(`영역 누락: ${s.key}`);
      perSubject.set(s.subjectId, (perSubject.get(s.subjectId) ?? 0) + 1);
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
    counts.standards += standards.length;
    counts.categories[category] = standards.length;
  }
  for (const s of subjects) {
    const actual = perSubject.get(s.id) ?? 0;
    if (actual !== s.standardCount) errors.push(`과목 ${s.id} 수량 불일치: subjects.json=${s.standardCount}, 실제=${actual}`);
  }

  if (gates) {
    for (const [category, expected] of Object.entries(gates.categories ?? {})) {
      const actual = counts.categories[category];
      if (actual !== expected.standards) {
        errors.push(`게이트 불일치: ${category} 성취기준 기대 ${expected.standards}, 실제 ${actual ?? 0}`);
      }
      for (const [subjectId, n] of Object.entries(expected.bySubject ?? {})) {
        const got = perSubject.get(subjectId) ?? 0;
        if (got !== n) errors.push(`게이트 불일치: 과목 ${subjectId} 기대 ${n}, 실제 ${got}`);
      }
    }
  }
  return { errors, counts };
}

export function computeManifestFiles(dataDir) {
  const files = {};
  const rels = ['subjects.json', ...listCategories(dataDir).flatMap((c) => CATEGORY_FILES.map((f) => `${c}/${f}`))];
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
    sourceNotice: sources.annexes.map((a) => `${a.notice} 【별책 ${a.annexNo}】 ${a.titleKorean}`),
  });
  console.error(`✓ 검증 통과 — 과목 ${counts.subjects} · 성취기준 ${counts.standards}건, manifest.json 기록`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
