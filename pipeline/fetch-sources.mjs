#!/usr/bin/env node
// 고시 PDF 확보·해시 대조. 사용법:
//   npm run pipeline:fetch            — 고정 해시와 대조 (불일치·미고정이면 실패)
//   npm run pipeline:fetch -- --pin   — 미고정(null) 해시를 실제 값으로 sources.json에 기록
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sourcesPath = join(here, 'sources.json');

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// [별책3] · [별책 3] · [ 별책3 ] 은 잡되 [별책30]·[별책13]은 잡지 않는다.
export function pdfPattern(annexNo) {
  return new RegExp(`\\[\\s*별\\s*책\\s*${annexNo}\\s*\\]`);
}

export function findLocalPdf(names, annexNo) {
  const re = pdfPattern(annexNo);
  return names.find((f) => f.toLowerCase().endsWith('.pdf') && re.test(f)) ?? null;
}

async function resolveAnnex(annex, pdfDir, { pin }) {
  let name = findLocalPdf(existsSync(pdfDir) ? readdirSync(pdfDir) : [], annex.annexNo);
  if (!name) {
    console.error(`… [별책${annex.annexNo}] 로컬 PDF 없음 — ${annex.url} 다운로드 시도`);
    const res = await fetch(annex.url);
    if (!res.ok) {
      throw new Error(`[별책${annex.annexNo}] 다운로드 실패(HTTP ${res.status}) — 브라우저로 받아 PDF_DIR(${pdfDir})에 두세요.`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error(`[별책${annex.annexNo}] 받은 파일이 PDF가 아닙니다 — URL이 바뀌었을 수 있습니다.`);
    }
    mkdirSync(pdfDir, { recursive: true });
    name = `[별책${annex.annexNo}] ${annex.titleKorean}(${annex.id}).pdf`;
    writeFileSync(join(pdfDir, name), body);
  }
  const path = join(pdfDir, name);
  const hash = sha256Hex(readFileSync(path));
  if (annex.sha256 === null) {
    if (!pin) {
      throw new Error(`[별책${annex.annexNo}] 해시가 아직 고정되지 않았습니다. 파일을 확인한 뒤 --pin으로 고정하세요.\n  파일: ${name}\n  실제: ${hash}`);
    }
    annex.sha256 = hash;
    console.error(`📌 [별책${annex.annexNo}] 해시 고정: ${hash}`);
  } else if (annex.sha256 !== hash) {
    throw new Error(`[별책${annex.annexNo}] 해시 불일치 — 다른 판본일 수 있습니다.\n  파일: ${name}\n  대장: ${annex.sha256}\n  실제: ${hash}`);
  }
  console.error(`✓ [별책${annex.annexNo}] ${name}`);
  return path;
}

async function main() {
  const pin = process.argv.includes('--pin');
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const pdfDir = resolve(repoRoot, process.env.PDF_DIR ?? '..');
  const paths = {};
  let failures = 0;
  for (const annex of sources.annexes) {
    try {
      paths[annex.id] = await resolveAnnex(annex, pdfDir, { pin });
    } catch (error) {
      console.error(`✗ ${error.message}`);
      failures += 1;
    }
  }
  for (const a of sources.amendments ?? []) {
    if (a.status !== 'verified') console.error(`⚠ 개정 고시 미확인: ${a.notice} — ${a.note}`);
  }
  if (pin) writeFileSync(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
  mkdirSync(join(repoRoot, '.cache'), { recursive: true });
  writeFileSync(join(repoRoot, '.cache', 'pdf-paths.json'), JSON.stringify(paths, null, 1));
  if (failures) { console.error(`✗ 실패 ${failures}건`); process.exit(1); }
  console.error('✓ 원본 확보·검증 완료');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
