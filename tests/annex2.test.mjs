// 【별책 2】 특수교육 전문 교과와 과목 성격·목표, 교수·학습 및 평가(v0.2) 파이프라인 단위 테스트.
// 원본이 없는 CI에서도 돌도록 실측 발췌 fixture(tests/fixtures/annex2-blocks.mjs)만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCode, displayCode, normalizeCode, parseBasicCode } from '../src/normalize.mjs';
import { extractStandards, routeRecords } from '../pipeline/extract-standards.mjs';
import {
  cleanText, domainNameMatches, parseContentSystem, parseStandardNotes,
} from '../pipeline/extract-details.mjs';
import { flattenGuide, guideCounts, parseNatureGoals, parseTeachingAssessment } from '../pipeline/extract-guides.mjs';
import { annexCategories, loadSubjectConfig, mergedMappings, routeCode } from '../pipeline/scope.mjs';
import { verifyGuides } from '../pipeline/verify.mjs';
import {
  AGRI_TEACHING_DIRECTION, ANATOMY_CONTENT_SYSTEM, INFO_TEACHING_ASSESSMENT, JOB_CONTENT_SYSTEM, JOB_NATURE_GOALS,
  JOB_NOTES, JOY2024_TEACHING_HEAD, ROMAN_PDF_TEXT,
} from './fixtures/annex2-blocks.mjs';

const config = loadSubjectConfig();
const annex2 = { id: 'a2', annexNo: 2, categories: ['special-vocational', 'ilyo'] };
const annex3 = { id: 'a3', annexNo: 3, category: 'basic' };
const HIGH = ['h1-3'];
// 3절 꼬리(평가) — 교수·학습 부분만 실측 발췌인 시험에 붙인다.
const TAIL = ['(2) 교수·학습 방법', '(가) 방법을 정한다.', '나. 평가', '(1) 평가의 방향', '(가) 방향을 정한다.', '(2) 평가 방법', '(가) 방법을 정한다.'];

test('normalize: 로마 숫자 코드는 원문대로 표시하고 ASCII로도 같은 코드로 찾는다', () => {
  assert.equal(displayCode(' 12 작업Ⅰ 01–01 '), '[12작업Ⅰ01-01]');
  assert.equal(normalizeCode('[12작업Ⅰ01-01]'), '[12작업I01-01]');
  assert.equal(canonicalCode('[12작업Ⅰ01-01]'), canonicalCode('12작업I01-01'));
  assert.notEqual(canonicalCode('[12작업Ⅰ01-01]'), canonicalCode('[12작업Ⅱ01-01]'));
  assert.deepEqual(parseBasicCode('[12작업Ⅱ02-03]'), {
    gradeBandCode: '12', gradeBand: 'h1-3', gradeBandKorean: '고등학교 1~3학년군', prefix: '작업II', domainNo: '02', itemNo: '03',
  });
});

test('extract(실측 별책 2 PDF): 로마 숫자 코드 목록 — 코드는 원문 표기, 접두어는 대응표 키', () => {
  const { records, duplicates } = extractStandards(ROMAN_PDF_TEXT);
  assert.deepEqual(duplicates, []);
  assert.deepEqual(records.map((r) => r.code), ['[12작업Ⅰ01-01]', '[12작업Ⅰ01-02]', '[12작업Ⅰ01-03]', '[12작업Ⅰ01-04]']);
  assert.ok(records.every((r) => r.prefix === '작업I' && r.bandCode === '12' && r.domainKorean === '기초 작업 능력의 이해'));
  assert.equal(records[0].text, '기초 작업 능력의 의미와 요소를 알고 중요성을 이해한다.');
  const routed = routeRecords(records, annex2, config);
  assert.equal(routed.byCategory.get('special-vocational').length, 4);
  assert.equal(routed.unmapped.length, 0);
});

test('scope: 접두어 + 학년군 코드로 카테고리·범위 밖을 가른다', () => {
  const hit = (prefix, bandCode, annex = annex2) => {
    const r = routeCode({ prefix, bandCode }, annex, config);
    return r === null ? null : r.outOfScope ? 'out' : `${r.category}:${r.map.id}`;
  };
  assert.equal(hit('직준', '12'), 'special-vocational:job-preparation');
  assert.equal(hit('작업Ⅰ', '12'), 'special-vocational:basic-work-skills-1');
  assert.equal(hit('해부', '12'), 'ilyo:anatomy-physiology');
  // 시각장애인 자립생활: 고등학교(12)만 전문 교과, 초·중(6·9)은 공통 교육과정 — 범위 밖.
  assert.equal(hit('시자', '12'), 'special-vocational:independent-living-for-the-blind');
  assert.equal(hit('시자', '9'), 'out');
  assert.equal(hit('국', '4'), 'out');
  assert.equal(hit('공국', '10'), 'out');
  assert.equal(hit('없음', '12'), null);
  // 별책 3에서는 별책 2의 범위 밖 목록이 적용되지 않는다.
  assert.equal(hit('국', '4', annex3), null);
  assert.equal(hit('국어', '4', annex3), 'basic:korean');
  assert.deepEqual(annexCategories(annex3), ['basic']);
  const merged = mergedMappings(['special-vocational', 'ilyo'], config);
  assert.equal(Object.keys(merged).length, 24);
  assert.equal(merged.이실.category, 'ilyo');
  // 대응표 과목명은 총론 <표 8>의 특수교육 전문 교과 24과목이다.
  assert.deepEqual(Object.values(config.mappings['special-vocational']).map((m) => m.subjectKorean), [
    '직업준비', '안정된 직업생활', '기초작업기술Ⅰ', '기초작업기술Ⅱ', '정보처리', '농생명', '사무지원', '대인서비스',
    '외식서비스', '직업현장실습', '직업과 자립', '사회적응', '시각장애인 자립생활', '농인의 생활과 문화',
  ]);
  assert.deepEqual(Object.values(config.mappings.ilyo).map((m) => m.subjectKorean), [
    '해부·생리', '병리', '이료보건', '안마·마사지·지압', '전기치료', '한방', '침구', '이료임상', '진단', '이료실기실습',
  ]);
});

test('내용 체계(실측 직업준비): 학년군 머리 없는 한 열 표', () => {
  const cs = parseContentSystem(JOB_CONTENT_SYSTEM, 0, JOB_CONTENT_SYSTEM.length - 1, { where: '직업준비', bands: HIGH });
  assert.equal(cs.domains.length, 1);
  const [d] = cs.domains;
  assert.deepEqual([d.domainNo, d.domainKorean], ['01', '자아 인식']);
  assert.deepEqual(d.columns, [{ gradeBand: 'h1-3', label: null }]);
  assert.equal(d.subAreas, undefined);
  assert.deepEqual(d.rows.map((r) => r.category), ['지식·이해', '과정·기능', '가치·태도']);
  assert.deepEqual(d.rows[0].cells, [{ gradeBands: ['h1-3'], items: ['자신의 기본 정보와 특성', '흥미, 적성, 가치관의 의미'] }]);
  assert.equal(d.coreIdeas.length, 2);
  assert.throws(() => parseContentSystem(JOB_CONTENT_SYSTEM, 0, JOB_CONTENT_SYSTEM.length - 1, { where: '직업준비', bands: ['m1-3', 'h1-3'] }),
    /학년군 머리 없는 표인데 과목 학년군이 2개/);
});

test('내용 체계(실측 해부·생리): 내용 요소 아래 열이 하위 영역인 표 → 범주 × 하위 영역 행', () => {
  const cs = parseContentSystem(ANATOMY_CONTENT_SYSTEM, 0, ANATOMY_CONTENT_SYSTEM.length - 1, { where: '해부·생리', bands: HIGH });
  const [d] = cs.domains;
  assert.equal(d.domainKorean, '해부생리학의 기초');
  assert.deepEqual(d.subAreas, ['해부학의 이해', '생리학의 이해', '인체의 구성', '인체의 명칭']);
  assert.deepEqual(d.columns, [{ gradeBand: 'h1-3', label: null }]);
  assert.equal(d.rows.length, 12);
  assert.deepEqual(d.rows.slice(0, 2).map((r) => [r.category, r.subArea]), [['지식·이해', '해부학의 이해'], ['지식·이해', '생리학의 이해']]);
  assert.deepEqual(d.rows[4].cells[0].items, ['해부학적 자세 적용하기', '해부학 기초 용어 적용하기']);
});

test('해설(실측 직업준비): 고등학교 한 학년군 절, 일부 성취기준만 해설', () => {
  const box = JOB_NOTES.flatMap((p) => p.ctrls.filter((c) => c.id === 'tbl ')).at(0);
  const texts = new Map(box.cells[0].paras.map((p) => cleanText(p.text)).filter(Boolean).map((l) => {
    const m = /^(\[[^\]]+\])\s*(.+)$/.exec(l);
    return [canonicalCode(m[1]), m[2]];
  }));
  const notes = parseStandardNotes(JOB_NOTES, 0, JOB_NOTES.length - 1, {
    where: '직업준비', bands: HIGH, boxText: (c) => texts.get(canonicalCode(c)),
  });
  assert.equal(notes.sections.length, 1);
  const [sec] = notes.sections;
  assert.deepEqual([sec.gradeBand, sec.domainNo, sec.domainKorean], ['h1-3', '01', '자아 인식']);
  assert.equal(sec.intro.length, 1);
  const [g] = sec.groups;
  assert.equal(g.codes.length, 5);
  // 원문은 [12직준01-03]에 해설을 달지 않았다.
  assert.deepEqual(g.explanations.map((e) => e.codes[0]), ['[12직준01-01]', '[12직준01-02]', '[12직준01-04]', '[12직준01-05]']);
  assert.ok(g.considerations.length >= 2 && g.considerations.every((e) => e.codes.length === 0));
});

test('영역 이름 예외: 원문이 두 절에서 다르게 적은 영역만 정확한 두 표기로 통과', () => {
  const table = { 'anma-massage-acupressure|03': { contentSystem: '안마·마사지·지압의 효과', standards: '안마, 마사지, 지압의 효과' } };
  const used = new Set();
  assert.ok(domainNameMatches('x', '01', '읽기', '읽 기'));
  assert.ok(domainNameMatches('anma-massage-acupressure', '03', '안마·마사지·지압의 효과', '안마, 마사지, 지압의 효과', table, used));
  assert.deepEqual([...used], ['anma-massage-acupressure|03']);
  assert.ok(!domainNameMatches('anma-massage-acupressure', '03', '안마의 효과', '안마, 마사지, 지압의 효과', table));
  assert.ok(!domainNameMatches('anma-massage-acupressure', '02', '안마·마사지·지압의 효과', '안마, 마사지, 지압의 효과', table));
});

test('성격·목표(실측 직업준비): 성격 문단과 총괄·세부 목표', () => {
  const r = parseNatureGoals(JOB_NATURE_GOALS, '직업준비');
  assert.deepEqual(r.nature.sections.map((s) => [s.heading, s.paragraphs.length]), [['가. 성격', 5]]);
  assert.equal(r.goals.heading, '나. 목표');
  assert.equal(r.goals.overall.length, 1);
  assert.deepEqual(r.goals.items.map((i) => i.no), ['(1)', '(2)', '(3)', '(4)']);
  assert.throws(() => parseNatureGoals(['가. 개관', '문단이다.'], 'x'), /모르는 1절 머리글/);
  assert.throws(() => parseNatureGoals(['가. 성격', '문단이다.', '나. 목표', '(1) 목표다.'], 'x'), /목표\(총괄·세부\)가 없습니다/);
});

test('교수·학습 및 평가(실측 정보처리): 원문 결번은 예외표에 있을 때만, 번호는 원문대로', () => {
  assert.throws(() => parseTeachingAssessment(INFO_TEACHING_ASSESSMENT, '정보처리'), /번호가 \(파\)입니다\(기대 \(타\)\)/);
  const allowed = new Set(['teachingLearning.direction|(파)', 'assessment.direction|(차)']);
  const seen = [];
  const r = parseTeachingAssessment(INFO_TEACHING_ASSESSMENT, '정보처리', (kind, spot) => {
    seen.push(`${kind} ${spot}`);
    return kind === 'itemNumbering' && allowed.has(spot);
  });
  assert.deepEqual(seen, ['itemNumbering teachingLearning.direction|(파)', 'itemNumbering assessment.direction|(차)']);
  const dir = r.teachingLearning.parts[0];
  assert.deepEqual(dir.items.slice(-2).map((i) => i.no), ['(카)', '(파)']);
  assert.equal(dir.items.at(-2).subItems.length, 5);
  assert.deepEqual(r.assessment.parts.map((p) => p.heading), ['(1) 평가의 방향', '(2) 평가 방법']);
  // 평가 방법 (카)의 번호 없는 문단 6개는 하위 문단이다.
  assert.ok(r.assessment.parts[1].items.find((i) => i.no === '(카)').subItems.some((t) => t.includes('포트폴리오')));
});

test('교수·학습(실측 농생명): 원문이 거듭 쓴 번호 (다)', () => {
  const paras = [...AGRI_TEACHING_DIRECTION, ...TAIL];
  assert.throws(() => parseTeachingAssessment(paras, '농생명'), /4번째 항목 번호가 \(다\)/);
  const r = parseTeachingAssessment(paras, '농생명', (kind, spot) => kind === 'itemNumbering' && spot === 'teachingLearning.direction|(다)');
  assert.deepEqual(r.teachingLearning.parts[0].items.map((i) => i.no), ['(가)', '(나)', '(다)', '(다)', '(라)', '(마)']);
});

test('교수·학습(실측 2024-4호 즐거운 생활): 원문에 없는 첫 부분 머리글은 예외표로만 heading: null', () => {
  const paras = [...JOY2024_TEACHING_HEAD, ...TAIL];
  assert.throws(() => parseTeachingAssessment(paras, '즐거운 생활'), /첫 부분 머리글 없이 항목이 나옵니다/);
  const r = parseTeachingAssessment(paras, '즐거운 생활', (kind, spot) => kind === 'missingPartHeadings' && spot === 'teachingLearning');
  const [first, second] = r.teachingLearning.parts;
  assert.deepEqual([first.id, first.heading, second.heading], ['direction', null, '(2) 교수·학습 방법']);
  assert.equal(first.items[0].subItems.length, 2);
  assert.ok(flattenGuide({ nature: { sections: [] }, goals: { heading: '나. 목표', overall: [], items: [] }, ...r })
    .some(([label]) => label === '(direction 머리글 없음)'));
});

test('verifyGuides: 판 구성·문장 종결·부분 구성·소제목형 항목', () => {
  const guide = {
    subjectId: 'job-preparation', subjectKorean: '직업준비',
    ...parseNatureGoals(JOB_NATURE_GOALS, '직업준비'),
    ...parseTeachingAssessment(INFO_TEACHING_ASSESSMENT, '정보처리', () => true),
  };
  const subjectById = new Map([['job-preparation', { id: 'job-preparation', category: 'special-vocational' }]]);
  const standards = [{ subjectId: 'job-preparation' }];
  const okRun = verifyGuides('special-vocational', [guide], standards, subjectById);
  assert.deepEqual(okRun.errors, []);
  assert.equal(okRun.counts.subjects, 1);
  assert.deepEqual(guideCounts([guide]), okRun.counts);

  const broken = JSON.parse(JSON.stringify(guide));
  broken.goals.items[1].no = '(3)';
  broken.nature.sections[0].paragraphs[0] = '끝나지 않은 문장';
  broken.assessment.parts.pop();
  broken.teachingLearning.parts[0].items[0].text = '소제목형 항목';
  const bad = verifyGuides('special-vocational', [broken, { ...guide, edition: '2024-4' }], standards, subjectById).errors.join('\n');
  assert.match(bad, /세부 목표: 2번째 번호가 \(3\)/);
  assert.match(bad, /성격: 문장 종결·글자 이상/);
  assert.match(bad, /부분 구성이 \(1\) 방향·\(2\) 방법이 아닙니다/);
  assert.match(bad, /'다\.'로 끝나지 않는 항목에 하위 문단이 없습니다/);
  assert.match(bad, /이전 판 안내\(editionNote\) 누락/);
  const missing = verifyGuides('special-vocational', [], standards, subjectById).errors.join('\n');
  assert.match(missing, /job-preparation: 최신 판 성격·목표, 교수·학습 및 평가가 없습니다/);
});
