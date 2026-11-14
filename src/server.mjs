import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  GRADE_BANDS, canonicalCode, normalizeCode, parseBasicCode, resolveGradeBand,
} from './normalize.mjs';
import {
  GUIDE_PARTS, allotmentForBand, buildRoadmap, categorySummary, contentSystemEntries, contentSystemView, countItems,
  gradeBandOverview, guideEntries, guideView, notesForStandard, resolveCategories, resolveSchoolLevel, resolveSubject,
  searchGuides, searchStandards, suggestSimilar,
} from './search.mjs';

const SERVER_INFO = { name: 'korean-special-education-learning-map', version: '0.2.0' };
const ABOUT_URI = 'about://korean-special-education-learning-map';

const SUBJECT = z.string().max(100).optional()
  .describe('과목명 또는 과목 id (예: 국어, 진로와 직업, 직업준비, 해부·생리, career-vocation)');
const CATEGORY = z.string().max(40).optional()
  .describe('교육과정 구분: 기본 교육과정(basic) | 직업·생활(special-vocational) | 이료(ilyo) | 전문 교과(직업·생활 + 이료)');
const GUIDE_PART = z.enum([...GUIDE_PARTS.keys()]).optional()
  .describe('한 부분만: 성격 | 목표 | 교수·학습 | 평가');
const GRADE_BAND = z.string().max(40).optional()
  .describe('학년군 (예: 초3~4, 중1~3, 고1~3, e3-4, 중학교)');
const LIMIT = z.number().int().min(1).max(50).optional().describe('최대 결과 수 (기본 20)');
const EMPTY_HINT =
  '검색 결과가 없습니다. query를 더 짧은 핵심어로 바꾸거나 subject·gradeBand 필터를 확인하세요. 과목 목록은 list_subjects.';
const DAILY_LIVING_NOTE =
  '일상생활 활동은 영역과 내용을 학교가 정하도록 되어 있어 국가 수준 성취기준이 없습니다. 이 서버에는 수록되지 않습니다.';

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }] };
}

function fail(message, suggestions = []) {
  const text = suggestions.length ? `${message} 유사 후보: ${suggestions.join(', ')}` : message;
  return { content: [{ type: 'text', text }], isError: true };
}

function subjectIdOrThrow(store, input) {
  if (!input) return undefined;
  const hit = resolveSubject(store, input);
  if (!hit) {
    const names = store.subjects.map((s) => s.subjectKorean);
    const similar = suggestSimilar(input, names);
    throw new Error(
      `과목 "${input}"을(를) 찾을 수 없습니다.${similar.length ? ` 유사 후보: ${similar.join(', ')}.` : ''} 전체 목록은 list_subjects.`
    );
  }
  return hit.id;
}

function categoriesOrThrow(store, input) {
  if (!input) return undefined;
  const list = resolveCategories(store, input);
  if (!list) {
    throw new Error(`교육과정 구분 "${input}"을(를) 해석할 수 없습니다. 사용 가능: ${categorySummary(store).map((c) => `${c.subjectGroupKorean ?? c.curriculumKorean ?? c.category}(${c.category})`).join(', ')}, 전문 교과`);
  }
  return list;
}

function gradeBandOrThrow(input) {
  if (!input) return undefined;
  const id = resolveGradeBand(input);
  if (!id) {
    throw new Error(
      `학년군 "${input}"을(를) 해석할 수 없습니다. 사용 가능: ${GRADE_BANDS.map((b) => `${b.short}(${b.id})`).join(', ')}`
    );
  }
  return id;
}

function aboutText(store) {
  const { taxonomyVersion, counts, sourceNotice } = store.manifest;
  const total = (key, k) => Object.values(counts[key] ?? {}).reduce((n, c) => n + (c[k] ?? 0), 0);
  const cats = categorySummary(store).map((c) => `${c.subjectGroupKorean ? `특수교육 전문 교과 ${c.subjectGroupKorean}` : c.curriculumKorean ?? c.category} ${c.subjects}과목 ${c.standards}개`).join(', ');
  return [
    '# 한국 특수교육 교육과정 학습지도 MCP 서버',
    '',
    `- 데이터 릴리스: ${taxonomyVersion}`,
    `- 수량: 과목 ${counts.subjects} · 성취기준 ${counts.standards}(${cats})${counts.details ? ` · 내용 체계 ${total('details', 'contentSystemDomains')}개 영역(항목 ${total('details', 'contentItems')}) · 성취기준 해설 ${total('details', 'explanations')}문단 · 적용 시 고려 사항 ${total('details', 'considerations')}문단` : ''}${counts.guides ? ` · 과목 성격·목표, 교수·학습 및 평가 ${total('guides', 'subjects')}과목` : ''}${counts.operation ? ` · 편성·운영 조항 ${counts.operation.organizationItems + counts.operation.criteriaItems}(배당표 ${counts.operation.tables})` : ''}`,
    `- 수록 원문 기준 고시: ${(sourceNotice ?? []).join('; ')}`,
    '- 성취기준 원문은 고시의 별책으로서 저작권법 제7조 제2호에 따라 보호받지 않는 저작물이며, 정확성·추적성을 위해 출처를 표기한다.',
    '- 범위(v0.2): ① 【별책 3】 기본 교육과정 16과목(category basic)과 ② 【별책 2】 선택 중심 교육과정의 특수교육 전문 교과 — 직업·생활 14과목(special-vocational), 이료 10과목(ilyo, 시각장애학교) — 의 성취기준, 내용 체계 표(영역별 핵심 아이디어와 지식·이해/과정·기능/가치·태도 내용 요소 — get_content_system), 성취기준 해설·적용 시 고려 사항과 영역 안내(get_standard), 과목의 성격·목표와 교수·학습 및 평가(get_subject_guide, search_subject_guides). 그리고 【별책 1】 총론 중 기본 교육과정 편성·운영(초·중·고 편제, <표 9>~<표 11> 시간·학점 배당표와 주석, 교육과정 편성·운영 기준 — get_operation_guidelines).',
    '- 수록하지 않은 것: 별책 3·별책 2의 교과(군)별 \'교육과정 설계의 개요\', 창의적 체험활동·일상생활 활동, 【별책 2】의 유치원 교육과정과 특수교육 공통 교육과정(국어(청각장애)·체육(시각장애·지체장애)·미술(시각장애)·초·중학교 시각장애인 자립생활·농인의 생활과 문화·점자·수어)과 공통국어(청각장애), 총론의 나머지, 일반 초·중등학교 공통·선택 중심 교육과정. 전문 교과의 시각장애인 자립생활·농인의 생활과 문화는 고등학교 과목(코드 12)만이다.',
    '- 편성·운영 조항과 내용 체계·해설·성격·목표·교수·학습 및 평가 원문은 같은 고시의 HWP 판에서 문단·표 칸 단위로 가져와 PDF와 글자 대조했다. 배당표는 사람이 옮긴 뒤 HWP 표 칸과 대조하고 합계를 검산했다. 특수교육 전문 교과는 제2024-4호 판과 제2026-2호 판이 성취기준·내용 체계·해설·성격·목표·교수·학습 및 평가 모두 같다(두 판 대조).',
    "- 원문 오기 보정: 수학 [6수학01-11]·[6수학01-12] 해설의 첫머리가 원문에 '[수학01-12]'로 적혀 있어 [6수학01-12]를 가리키는 것으로 연결했다(문장은 원문 그대로). 사회 내용 체계 표의 세로쓰기 하위 범주는 띄어쓰기가 없어 사회과 본문 표기('도덕적 인성', '인간과 자연의 공존', '역사·문화 소양')를 따랐다.",
    "- 원문 표기를 그대로 둔 곳: 안마·마사지·지압 영역 3의 이름은 내용 체계에서 '안마·마사지·지압의 효과', 성취기준·해설에서 '안마, 마사지, 지압의 효과'다. 이료 6개 영역은 내용 체계 표의 하위 영역 이름과 해설의 하위 영역 머리글이 조금 다르다(예: 전기치료 '기본 장치와 주의 사항'/'기본 장치 및 주의 사항'). 교수·학습 및 평가의 항목 번호는 원문대로다 — 정보처리는 (타)·(자)가 빠졌고, 농생명은 (다)가 두 번 나온다. 제2024-4호 판 즐거운 생활은 '(1) 교수·학습의 방향' 머리글이 원문에 없어 heading을 null로 둔다.",
    "- 이료 과목의 내용 체계 표는 '내용 요소' 아래 열이 학년군이 아니라 하위 영역(예: 해부·생리 '해부학의 이해')이라 범주 × 하위 영역 행(subArea)으로 싣고 subAreas에 열 순서를 둔다. 특수교육 전문 교과 과목의 코드는 '[12직준01-01]'처럼 고등학교(12)이며, 기초작업기술Ⅰ·Ⅱ는 원문대로 로마 숫자를 쓴다('[12작업Ⅰ01-01]' — 'I'로 적어도 찾는다).",
    '- 직업·생활 과목은 원문이 성취기준 일부에만 해설을 달았다(해설 없는 성취기준은 notes.explanation이 빈 배열이다).',
    '- 수록 판본: 국가교육위원회 고시 제2026-2호(2026.1.21.) 일부개정 반영본. 이 개정으로 바뀐 초1~2 통합교과(건강한 생활 신설, 즐거운 생활 개편)는 2028.3.1. 시행이며, 그 전까지 학교 현장은 이전 고시(제2024-4호) 판을 따른다 — list_subjects의 note 참고. 이 시행 중인 이전 판 즐거운 생활 성취기준 9개도 edition "2024-4"로 함께 수록했다(같은 코드는 get_standard가 두 판을 모두 돌려준다). 다른 과목의 성취기준은 두 판이 같다. 바른 생활·슬기로운 생활은 성취기준은 같지만 2026-2호에서 해설·고려 사항·내용 체계 안내 문구가 다듬어져, 이전 판 문구를 previousEditionNotes(get_standard)·previousEdition(get_content_system)으로 함께 준다. 나머지 13과목의 내용 체계·해설은 두 판이 같다. 성격·목표와 교수·학습 및 평가도 바른 생활·슬기로운 생활·즐거운 생활은 두 판이 달라 이전 판을 previousEdition(get_subject_guide)으로 함께 주고, 나머지 기본 교육과정 과목은 두 판이 같다.',
    "- 중학교 일부 코드는 고시 원문대로 '09'로 적혀 있다(예: [09수학04-01], [09생영01-01]). '9'로 찾아도 된다.",
    "- 통합교과(바른 생활·슬기로운 생활·건강한 생활·즐거운 생활)는 4개 영역을 중첩한 성취기준이라 영역명을 '통합교과 4개 영역 중첩'으로 표시한다.",
    `- ${DAILY_LIVING_NOTE}`,
    '- 영역명·과목 배정은 PDF 조판에서 기계 추출했으며 파이프라인 검증을 거쳤다. 원문은 고시 PDF와 대조할 것.',
    '- 교육부·국가교육위원회·국립특수교육원의 공식 산출물이 아니며, 개별 학생을 진단하거나 개별화교육계획을 대신하지 않는다.',
    '- 라이선스: MIT (코드·문서).',
  ].join('\n');
}

export function createServer(store) {
  const server = new McpServer(SERVER_INFO);

  const guarded = (fn) => async (args) => {
    try {
      return await fn(args);
    } catch (error) {
      return fail(error.message);
    }
  };

  server.registerResource(
    'about',
    ABOUT_URI,
    { title: '데이터 출처·라이선스 안내', description: '릴리스, 수량, 근거 고시, 수록 범위', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: aboutText(store) }] })
  );

  server.registerTool(
    'list_subjects',
    {
      title: '과목 목록',
      description:
        '수록된 과목과 과목별 학년군·성취기준 수를 반환한다. 기본 교육과정(basic) 16과목과 고등학교 특수교육 전문 교과 '
        + '직업·생활(special-vocational) 14과목·이료(ilyo) 10과목이며, category로 거를 수 있다(전문 교과 = 둘 다). '
        + '일상생활 활동은 국가 수준 성취기준이 없어 제외된다.',
      inputSchema: { category: CATEGORY },
    },
    guarded(async ({ category }) => {
      const cats = categoriesOrThrow(store, category);
      return ok({
        release: store.manifest.taxonomyVersion,
        categories: categorySummary(store).filter((c) => !cats || cats.includes(c.category)),
        subjects: store.subjects.filter((s) => !cats || cats.includes(s.category)).map((s) => ({
          id: s.id, subjectKorean: s.subjectKorean, category: s.category,
          ...(s.curriculumKorean ? { curriculumKorean: s.curriculumKorean } : {}),
          ...(s.subjectGroupKorean ? { subjectGroupKorean: s.subjectGroupKorean } : {}),
          codePrefix: s.codePrefix, gradeBands: s.gradeBands, standardCount: s.standardCount,
          ...(s.note ? { note: s.note } : {}),
          ...(s.previousEdition ? { previousEdition: s.previousEdition } : {}),
        })),
        note: DAILY_LIVING_NOTE,
      });
    })
  );

  server.registerTool(
    'get_grade_band_overview',
    {
      title: '학년군 개요',
      description:
        'gradeBand를 주면 그 학년군의 과목별 영역·성취기준 수를 반환한다(개별화교육계획 범위 잡기용). 고1~3은 기본 교육과정 과목 뒤에 '
        + '특수교육 전문 교과(직업·생활, 이료) 과목이 category와 함께 나온다(category로 거를 수 있다). 없으면 학년군 목록과 학년군별 성취기준 수를 반환한다.',
      inputSchema: { gradeBand: GRADE_BAND, category: CATEGORY },
    },
    guarded(async ({ gradeBand, category }) => {
      const band = gradeBandOrThrow(gradeBand);
      const cats = categoriesOrThrow(store, category);
      const current = store.allStandards.filter((s) => !s.edition && (!cats || cats.includes(s.category)));
      if (!band) {
        return ok({
          gradeBands: GRADE_BANDS.map((b) => {
            const inBand = current.filter((s) => s.gradeBand === b.id);
            const byCategory = {};
            for (const s of inBand) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
            return {
              id: b.id, labelKorean: b.labelKorean, codeNumber: b.code, standardCount: inBand.length,
              ...(Object.keys(byCategory).length > 1 ? { byCategory } : {}),
            };
          }),
        });
      }
      const meta = GRADE_BANDS.find((b) => b.id === band);
      // 배당 기준은 총론의 '기본 교육과정 편성·운영'이다 — 전문 교과만 고른 조회에는 붙이지 않는다.
      const allotment = !cats || cats.includes('basic') ? allotmentForBand(store, band) : null;
      return ok({
        gradeBand: band, gradeBandKorean: meta.labelKorean, subjects: gradeBandOverview(store, band, { category: cats }),
        ...(allotment ? { allotment, operationHint: '기본 교육과정의 배당 기준이다. 편제·배당표 주석·운영 기준 원문은 get_operation_guidelines.' } : {}),
      });
    })
  );

  server.registerTool(
    'get_operation_guidelines',
    {
      title: '기본 교육과정 편성·운영 기준',
      description:
        '【별책 1】 총론의 기본 교육과정 편성·운영(편제, 시간·학점 배당표와 주석, 교육과정 편성·운영 기준) 원문을 학교급별로 반환한다. '
        + 'schoolLevel이 없으면 학교급 목록과 배당표 총계를, 학년군(예: 초3~4)으로 주면 그 학교급 전체와 해당 열(focus)을 준다.',
      inputSchema: {
        schoolLevel: z.string().max(40).optional()
          .describe('학교급 또는 학년군 (예: 초등학교, 중학교, 고등학교, 초3~4, e5-6, 고1~3)'),
        part: z.enum(['편제', '배당 기준', '운영 기준']).optional()
          .describe('한 부분만 볼 때: 편제 | 배당 기준(시간·학점 배당표) | 운영 기준'),
      },
    },
    guarded(async ({ schoolLevel, part }) => {
      const op = store.operation;
      if (!op) return fail('편성·운영 데이터가 수록되지 않은 설치본입니다.');
      const source = { notice: op.sourceNotice, section: op.section, pages: op.pages };
      const partsOf = (l) => ({
        편제: { organization: l.organization },
        '배당 기준': { allotment: l.allotment },
        '운영 기준': { criteria: l.criteria },
      });
      if (!schoolLevel && part) {
        // 학교급 없이 부분만 주면 세 학교급의 그 부분을 나란히 준다(예: 배당표 셋 비교).
        return ok({
          source,
          schoolLevels: op.levels.map((l) => ({
            id: l.id, labelKorean: l.labelKorean, gradeBands: l.gradeBands,
            ...(l.note ? { note: l.note } : {}), ...partsOf(l)[part],
          })),
        });
      }
      if (!schoolLevel) {
        return ok({
          source,
          schoolLevels: op.levels.map((l) => {
            const total = l.allotment.totals.find((t) => t.kind === 'total');
            return {
              id: l.id, labelKorean: l.labelKorean, gradeBands: l.gradeBands,
              allotment: { tableNo: l.allotment.tableNo, unit: l.allotment.unit, total: { label: total.label, values: total.values } },
              // 세부 항목(가)·(1))까지 센 수 — manifest·README의 조항 수와 같은 셈법.
              organizationItems: countItems(l.organization.items), criteriaItems: countItems(l.criteria.items),
              ...(l.note ? { note: l.note } : {}),
            };
          }),
          hint: 'schoolLevel(예: 초등학교, 초3~4)을 주면 편제·배당표·운영 기준 원문을, part만 주면 세 학교급의 그 부분을 반환한다.',
        });
      }
      const hit = resolveSchoolLevel(store, schoolLevel);
      if (!hit) {
        throw new Error(`학교급 "${schoolLevel}"을(를) 해석할 수 없습니다. 사용 가능: 초등학교, 중학교, 고등학교 또는 학년군(초1~2 … 고1~3).`);
      }
      const l = hit.level;
      const parts = partsOf(l);
      return ok({
        source, schoolLevel: l.labelKorean, id: l.id, gradeBands: l.gradeBands,
        ...(hit.focus ? { focus: hit.focus } : {}),
        ...(l.note ? { note: l.note } : {}),
        heading: l.partA,
        ...(part ? parts[part] : { ...parts.편제, ...parts['배당 기준'], ...parts['운영 기준'] }),
      });
    })
  );

  server.registerTool(
    'search_standards',
    {
      title: '성취기준 검색',
      description:
        '성취기준을 코드·키워드(원문 본문·영역명 포함)와 과목·학년군·영역·교육과정 구분(category) 필터로 검색한다. 결과에 원문이 포함된다. 시행 중인 이전 판(즐거운 생활 2024-4호 판)은 edition 표시와 함께 나온다.',
      inputSchema: {
        query: z.string().max(200).optional().describe('키워드 또는 코드 (예: 화폐, 9진로01-02, 12직준01)'),
        subject: SUBJECT,
        gradeBand: GRADE_BAND,
        domain: z.string().max(100).optional().describe('영역명(부분 일치)'),
        category: CATEGORY,
        limit: LIMIT,
      },
    },
    guarded(async ({ query, subject, gradeBand, domain, category, limit }) => {
      const result = searchStandards(store, {
        query, domain, limit,
        subjectId: subjectIdOrThrow(store, subject),
        gradeBand: gradeBandOrThrow(gradeBand),
        category: categoriesOrThrow(store, category),
      });
      if (result.total === 0) result.hint = EMPTY_HINT;
      return ok(result);
    })
  );

  server.registerTool(
    'get_standard',
    {
      title: '성취기준 상세',
      description: '성취기준 코드(공백·대시 이형 무관)로 공식 원문, 과목, 학년군, 영역, 근거 고시와 함께 【별책 3】의 성취기준 해설(explanation)·적용 시 고려 사항(considerations: 이 성취기준, sharedConsiderations: 같은 목록 상자 전체)·영역 안내(domainIntro)를 notes로 조회한다. 판이 갈린 코드(즐거운 생활)는 최신 판과 시행 중인 이전 판(edition)을 모두 돌려주고, 해설 문구만 다듬어진 바른 생활·슬기로운 생활은 이전 판 해설을 previousEditionNotes로 준다.',
      inputSchema: {
        code: z.string().max(100).describe('성취기준 코드 (예: [4국어01-01], 9수학04-01)'),
        includeNotes: z.boolean().optional().describe('해설·고려 사항(notes)을 포함할지 (기본 true)'),
      },
    },
    guarded(async ({ code, includeNotes = true }) => {
      const normalized = normalizeCode(code);
      if (!normalized) {
        // 빈 입력은 유사 후보 계산에서 모든 코드와 '부분 일치'해 무관한 후보가 나온다 — 먼저 막는다.
        return fail('성취기준 코드가 비어 있습니다. 예: [4국어01-01]. 키워드로 찾으려면 search_standards.');
      }
      const canon = canonicalCode(code);
      const hits = store.standardsByCode.get(canon) ?? [];
      if (hits.length === 0) {
        // 비교는 canonical 키로, 제안은 고시 원문 표기로 — '9수학04-09' → '[09수학04-01]' 계열.
        // 수록 과목의 접두어인데 학년군이 다르면(예: 공통 교육과정 초·중 '[6시자01-01]') 그 과목의 수록 범위를 알린다.
        const parsed = parseBasicCode(code);
        const sameEntry = parsed && store.subjects.find((s) => s.codePrefix === parsed.prefix && !s.gradeBands.includes(parsed.gradeBand));
        if (sameEntry) {
          return fail(`성취기준 ${normalized}을(를) 찾을 수 없습니다. 접두어 '${parsed.prefix}'는 ${sameEntry.subjectKorean}(${sameEntry.gradeBands.join(', ')})로 수록되어 있으며 이 학년군 코드는 수록 범위 밖입니다.${sameEntry.note ? ` ${sameEntry.note}` : ''}`);
        }
        const similar = suggestSimilar(canon, [...store.standardsByCode.keys()])
          .flatMap((k) => store.standardsByCode.get(k).map((s) => s.code));
        return fail(`성취기준 ${normalized}을(를) 찾을 수 없습니다.`, [...new Set(similar)]);
      }
      const editionsOfCode = new Set(hits.map((s) => s.edition ?? null));
      return ok({
        results: hits.map((s) => {
          const meta = store.subjectsById.get(s.subjectId);
          const note = meta?.note;
          const notes = includeNotes ? notesForStandard(store, s) : null;
          // 성취기준은 한 판뿐인데 해설은 판이 갈린 과목(바른 생활·슬기로운 생활) — 이전 판 해설도 준다.
          const previousEditionNotes = includeNotes && !s.edition
            ? (store.standardNotes ?? [])
              .filter((n) => n.subjectId === s.subjectId && n.edition && !editionsOfCode.has(n.edition))
              .map((n) => ({ edition: n.edition, editionNote: n.editionNote, ...notesForStandard(store, s, n.edition) }))
              .filter((n) => n.explanation)
            : [];
          return {
            ...s,
            ...(meta?.curriculumKorean ? { curriculumKorean: meta.curriculumKorean } : {}),
            ...(meta?.subjectGroupKorean ? { subjectGroupKorean: meta.subjectGroupKorean } : {}),
            officialText: store.textsByKey.get(s.key),
            codeStructure: parseBasicCode(s.code),
            ...(note ? { subjectNote: note } : {}),
            ...(notes ? { notes } : {}),
            ...(previousEditionNotes.length ? { previousEditionNotes } : {}),
          };
        }),
      });
    })
  );

  server.registerTool(
    'get_content_system',
    {
      title: '내용 체계',
      description:
        '과목의 내용 체계 표를 【별책 3】 원문대로 반환한다: 영역별 핵심 아이디어(coreIdeas)와 지식·이해/과정·기능/가치·태도 범주의 학년군별 내용 요소(contentElements). '
        + 'gradeBand를 주면 그 학년군 칸만(여러 학년군에 걸친 병합 칸은 sharedWithGradeBands), domain을 주면 한 영역만 준다. 사회·수학·과학·체육·생활영어는 범주 아래 하위 영역(subArea)이 있다. '
        + '특수교육 전문 교과(직업·생활, 이료)는 고등학교 한 학년군이고, 이료 과목은 표의 열이 하위 영역이라 범주 × 하위 영역 행(subArea, 열 순서는 subAreas)으로 준다. '
        + '통합교과 중 바른 생활·슬기로운 생활·즐거운 생활은 시행 중인 이전 판(2024-4호)도 previousEdition으로 함께 준다.',
      inputSchema: {
        subject: z.string().max(100).describe('과목명 또는 과목 id'),
        gradeBand: GRADE_BAND,
        domain: z.string().max(100).optional().describe('영역명(부분 일치) 또는 영역 번호 (예: 듣기·말하기, 2)'),
      },
    },
    guarded(async ({ subject, gradeBand, domain }) => {
      const subjectId = subjectIdOrThrow(store, subject);
      const meta = store.subjectsById.get(subjectId);
      const band = gradeBandOrThrow(gradeBand);
      if (band && !meta.gradeBands.includes(band)) {
        throw new Error(`${meta.subjectKorean}은(는) ${band} 학년군에 편성되지 않았습니다. 편성 학년군: ${meta.gradeBands.join(', ')}`);
      }
      const entries = contentSystemEntries(store, subjectId);
      if (!entries.length) return fail('내용 체계 데이터가 수록되지 않은 설치본입니다.');
      const [current, ...previous] = entries.map((e) => contentSystemView(e, { gradeBand: band, domain }));
      if (domain && !current.domains.length) {
        throw new Error(`영역 "${domain}"을(를) 찾을 수 없습니다. ${meta.subjectKorean} 영역: ${entries[0].domains.map((d) => `${Number(d.domainNo)} ${d.domainKorean}`).join(', ')}`);
      }
      return ok({
        subjectId, subjectKorean: meta.subjectKorean, ...(band ? { gradeBand: band } : {}),
        ...(meta.note ? { note: meta.note } : {}),
        ...current,
        ...(previous.length ? { previousEdition: previous } : {}),
        seeAlso: '성취기준 원문은 get_learning_roadmap, 성취기준별 해설·적용 시 고려 사항은 get_standard, 과목 성격·목표와 교수·학습 및 평가는 get_subject_guide.',
      });
    })
  );

  server.registerTool(
    'get_learning_roadmap',
    {
      title: '과목 로드맵',
      description:
        '과목의 성취기준을 학년군 → 영역 → 성취기준 계층으로 반환한다. gradeBand로 한 학년군만 볼 수 있다. 고시 문서 순서이며 새 순서를 만들지 않는다.',
      inputSchema: {
        subject: z.string().max(100).describe('과목명 또는 과목 id'),
        gradeBand: GRADE_BAND,
      },
    },
    guarded(async ({ subject, gradeBand }) => {
      const subjectId = subjectIdOrThrow(store, subject);
      const roadmap = buildRoadmap(store, { subjectId, gradeBand: gradeBandOrThrow(gradeBand) });
      const meta = store.subjectsById.get(subjectId);
      if (roadmap.standardCount === 0) {
        roadmap.hint = `${meta.subjectKorean}은(는) 이 학년군에 성취기준이 없습니다. 편성 학년군: ${meta.gradeBands.join(', ')}`;
      }
      const previous = meta.previousEdition
        ? buildRoadmap(store, { subjectId, gradeBand: gradeBandOrThrow(gradeBand), editions: 'previous' })
        : null;
      return ok({
        subjectId, subjectKorean: meta.subjectKorean,
        ...(meta.note ? { note: meta.note } : {}),
        ...roadmap,
        ...(previous && previous.standardCount ? {
          previousEdition: { edition: meta.previousEdition.edition, note: meta.previousEdition.note, ...previous },
        } : {}),
        seeAlso: '영역별 핵심 아이디어·내용 요소는 get_content_system, 성취기준별 해설·적용 시 고려 사항은 get_standard, 과목 성격·목표와 교수·학습 및 평가는 get_subject_guide.',
      });
    })
  );

  server.registerTool(
    'get_subject_guide',
    {
      title: '과목 성격·목표, 교수·학습 및 평가',
      description:
        '과목의 \'1. 성격 및 목표\'(성격 문단, 총괄 목표와 세부 목표)와 \'3. 교수·학습 및 평가\'(교수·학습의 방향·방법, 평가의 방향·방법 항목과 하위 문단)를 고시 원문 계층대로 반환한다. '
        + 'part로 한 부분(성격 | 목표 | 교수·학습 | 평가)만 볼 수 있다. 바른 생활·슬기로운 생활·즐거운 생활은 시행 중인 이전 판(2024-4호)을 previousEdition으로 함께 준다.',
      inputSchema: {
        subject: z.string().max(100).describe('과목명 또는 과목 id (예: 국어, 직업준비, 해부·생리)'),
        part: GUIDE_PART,
      },
    },
    guarded(async ({ subject, part }) => {
      const subjectId = subjectIdOrThrow(store, subject);
      const meta = store.subjectsById.get(subjectId);
      const entries = guideEntries(store, subjectId);
      if (!entries.length) return fail('성격·목표, 교수·학습 및 평가 데이터가 수록되지 않은 설치본입니다.');
      const [current, ...previous] = entries.map((e) => guideView(e, part));
      return ok({
        subjectId, subjectKorean: meta.subjectKorean, category: meta.category,
        ...(meta.curriculumKorean ? { curriculumKorean: meta.curriculumKorean } : {}),
        ...(meta.subjectGroupKorean ? { subjectGroupKorean: meta.subjectGroupKorean } : {}),
        ...(meta.note ? { note: meta.note } : {}),
        ...current,
        ...(previous.length ? { previousEdition: previous } : {}),
        seeAlso: '성취기준은 get_learning_roadmap, 내용 체계는 get_content_system, 과목을 가로지르는 키워드 검색은 search_subject_guides.',
      });
    })
  );

  server.registerTool(
    'search_subject_guides',
    {
      title: '성격·목표, 교수·학습 및 평가 검색',
      description:
        '모든 과목(최신 판)의 성격·목표, 교수·학습 및 평가 문단·항목·하위 문단을 키워드로 찾는다(NFC 부분 일치). '
        + '결과는 과목·부분(성격 | 목표 | 교수·학습 | 평가)·머리글·항목 번호와 원문이며, 하위 문단이 맞은 항목은 matchedSubItems를 붙인다. '
        + 'subject·category·part로 좁힐 수 있다. 예: \'중도중복장애\', \'보완대체의사소통\', \'현장 실습\'.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('키워드 (예: 중도중복장애, 포트폴리오)'),
        subject: SUBJECT,
        category: CATEGORY,
        part: GUIDE_PART,
        limit: LIMIT,
      },
    },
    guarded(async ({ query, subject, category, part, limit }) => {
      if (!query.trim()) return fail('검색어가 비어 있습니다.');
      if (!(store.subjectGuides ?? []).length) return fail('성격·목표, 교수·학습 및 평가 데이터가 수록되지 않은 설치본입니다.');
      const result = searchGuides(store, {
        query, part, limit,
        subjectId: subjectIdOrThrow(store, subject),
        categories: categoriesOrThrow(store, category),
      });
      if (result.total === 0) result.hint = '검색 결과가 없습니다. 더 짧은 핵심어로 바꾸거나 subject·category·part 필터를 확인하세요.';
      return ok(result);
    })
  );

  return server;
}

export const TOOL_NAMES = [
  'get_content_system', 'get_grade_band_overview', 'get_learning_roadmap', 'get_operation_guidelines',
  'get_standard', 'get_subject_guide', 'list_subjects', 'search_standards', 'search_subject_guides',
];
export { ABOUT_URI };
