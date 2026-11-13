// 합성 텍스트 → extract → build → 파일 기록 → verify → manifest 까지 실제 파이프라인 함수로
// 임시 데이터 폴더를 만든다. 서버·스토어 테스트는 이 폴더를 쓴다.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDataset, extractStandards } from '../../pipeline/extract-standards.mjs';
import { verifyAll, writeManifest } from '../../pipeline/verify.mjs';
import { SAMPLE_MAPPINGS, SAMPLE_PDF_TEXT } from './sample-pdftotext.mjs';

export function buildFixtureDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'kse-fixture-'));
  const { records } = extractStandards(SAMPLE_PDF_TEXT);
  const built = buildDataset(records, {
    category: 'basic', sourceId: 'moe-2022-34-annex3', mappings: SAMPLE_MAPPINGS,
  });
  if (built.failures.length) throw new Error(`fixture 실패: ${JSON.stringify(built.failures)}`);
  mkdirSync(join(dir, 'basic'));
  const write = (rel, v) => writeFileSync(join(dir, rel), `${JSON.stringify(v, null, 1)}\n`);
  write('subjects.json', { subjects: built.subjects });
  write('basic/curriculum-standards.json', { category: 'basic', standards: built.standards });
  write('basic/standard-texts.json', { texts: built.texts });
  const { errors, counts } = verifyAll(dir, null);
  if (errors.length) throw new Error(`fixture 검증 실패: ${errors.join('; ')}`);
  writeManifest(dir, {
    release: 'v0.0.0-fixture', counts,
    sourceNotice: ['교육부 고시 제2022-34호(2022.12.22.) 【별책 3】 기본 교육과정'],
  });
  return dir;
}
