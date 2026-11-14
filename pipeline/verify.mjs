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

export const OPERATION_FILE = 'operation-guidelines.json';

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
  }
  return { errors, counts };
}

const num = (v) => Number(String(v).replace(/,/g, '').match(/^\d+/)?.[0] ?? NaN);

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
  console.error(`✓ 검증 통과 — 과목 ${counts.subjects} · 성취기준 ${counts.standards}건${op}, manifest.json 기록`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
