import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  GRADE_BANDS, canonicalCode, normalizeCode, parseBasicCode, resolveGradeBand,
} from './normalize.mjs';
import {
  allotmentForBand, buildRoadmap, gradeBandOverview, resolveSchoolLevel, resolveSubject,
  searchStandards, suggestSimilar,
} from './search.mjs';

const SERVER_INFO = { name: 'korean-special-education-learning-map', version: '0.1.0' };
const ABOUT_URI = 'about://korean-special-education-learning-map';

const SUBJECT = z.string().max(100).optional()
  .describe('과목명 또는 과목 id (예: 국어, 진로와 직업, career-vocation)');
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
  return [
    '# 한국 특수교육 교육과정 학습지도 MCP 서버',
    '',
    `- 데이터 릴리스: ${taxonomyVersion}`,
    `- 수량: 과목 ${counts.subjects} · 성취기준 ${counts.standards}${counts.operation ? ` · 편성·운영 조항 ${counts.operation.organizationItems + counts.operation.criteriaItems}(배당표 ${counts.operation.tables})` : ''}`,
    `- 수록 원문 기준 고시: ${(sourceNotice ?? []).join('; ')}`,
    '- 성취기준 원문은 고시의 별책으로서 저작권법 제7조 제2호에 따라 보호받지 않는 저작물이며, 정확성·추적성을 위해 출처를 표기한다.',
    '- 범위(v0.1): 【별책 3】 기본 교육과정 교과 성취기준, 그리고 【별책 1】 총론 중 기본 교육과정 편성·운영(초·중·고 편제, <표 9>~<표 11> 시간·학점 배당표와 주석, 교육과정 편성·운영 기준 — get_operation_guidelines). 총론의 나머지, 특수교육 전문 교과(직업·생활, 이료), 공통·선택 중심 교육과정은 아직 수록되지 않았다.',
    '- 편성·운영 조항 원문은 같은 고시의 HWP 판에서 문단 단위로 가져와 PDF와 대조했고, 배당표는 사람이 옮긴 뒤 HWP 표 칸과 대조하고 합계를 검산했다.',
    '- 수록 판본: 국가교육위원회 고시 제2026-2호(2026.1.21.) 일부개정 반영본. 이 개정으로 바뀐 초1~2 통합교과(건강한 생활 신설, 즐거운 생활 개편)는 2028.3.1. 시행이며, 그 전까지 학교 현장은 이전 고시(제2024-4호) 판을 따른다 — list_subjects의 note 참고. 이 시행 중인 이전 판 즐거운 생활 성취기준 9개도 edition "2024-4"로 함께 수록했다(같은 코드는 get_standard가 두 판을 모두 돌려준다). 다른 과목은 두 판이 같다.',
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
      description: '수록된 과목과 과목별 학년군·성취기준 수를 반환한다. 일상생활 활동은 국가 수준 성취기준이 없어 제외된다.',
      inputSchema: {},
    },
    guarded(async () => ok({
      release: store.manifest.taxonomyVersion,
      subjects: store.subjects.map((s) => ({
        id: s.id, subjectKorean: s.subjectKorean, category: s.category,
        codePrefix: s.codePrefix, gradeBands: s.gradeBands, standardCount: s.standardCount,
        ...(s.note ? { note: s.note } : {}),
        ...(s.previousEdition ? { previousEdition: s.previousEdition } : {}),
      })),
      note: DAILY_LIVING_NOTE,
    }))
  );

  server.registerTool(
    'get_grade_band_overview',
    {
      title: '학년군 개요',
      description:
        'gradeBand를 주면 그 학년군의 과목별 영역·성취기준 수를 반환한다(개별화교육계획 범위 잡기용). 없으면 학년군 목록과 학년군별 성취기준 수를 반환한다.',
      inputSchema: { gradeBand: GRADE_BAND },
    },
    guarded(async ({ gradeBand }) => {
      const band = gradeBandOrThrow(gradeBand);
      if (!band) {
        return ok({
          gradeBands: GRADE_BANDS.map((b) => ({
            id: b.id, labelKorean: b.labelKorean, codeNumber: b.code,
            standardCount: store.allStandards.filter((s) => s.gradeBand === b.id && !s.edition).length,
          })),
        });
      }
      const meta = GRADE_BANDS.find((b) => b.id === band);
      const allotment = allotmentForBand(store, band);
      return ok({
        gradeBand: band, gradeBandKorean: meta.labelKorean, subjects: gradeBandOverview(store, band),
        ...(allotment ? { allotment, operationHint: '편제·배당표 주석·운영 기준 원문은 get_operation_guidelines.' } : {}),
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
      if (!schoolLevel) {
        return ok({
          source,
          schoolLevels: op.levels.map((l) => {
            const total = l.allotment.totals.find((t) => t.kind === 'total');
            return {
              id: l.id, labelKorean: l.labelKorean, gradeBands: l.gradeBands,
              allotment: { tableNo: l.allotment.tableNo, unit: l.allotment.unit, total: { label: total.label, values: total.values } },
              organizationItems: l.organization.items.length, criteriaItems: l.criteria.items.length,
              ...(l.note ? { note: l.note } : {}),
            };
          }),
          hint: 'schoolLevel(예: 초등학교, 초3~4)을 주면 편제·배당표·운영 기준 원문을 반환한다.',
        });
      }
      const hit = resolveSchoolLevel(store, schoolLevel);
      if (!hit) {
        throw new Error(`학교급 "${schoolLevel}"을(를) 해석할 수 없습니다. 사용 가능: 초등학교, 중학교, 고등학교 또는 학년군(초1~2 … 고1~3).`);
      }
      const l = hit.level;
      const parts = {
        편제: { organization: l.organization },
        '배당 기준': { allotment: l.allotment },
        '운영 기준': { criteria: l.criteria },
      };
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
        '성취기준을 코드·키워드(원문 본문·영역명 포함)와 과목·학년군·영역 필터로 검색한다. 결과에 원문이 포함된다. 시행 중인 이전 판(즐거운 생활 2024-4호 판)은 edition 표시와 함께 나온다.',
      inputSchema: {
        query: z.string().max(200).optional().describe('키워드 또는 코드 (예: 화폐, 9진로01-02)'),
        subject: SUBJECT,
        gradeBand: GRADE_BAND,
        domain: z.string().max(100).optional().describe('영역명(부분 일치)'),
        limit: LIMIT,
      },
    },
    guarded(async ({ query, subject, gradeBand, domain, limit }) => {
      const result = searchStandards(store, {
        query, domain, limit,
        subjectId: subjectIdOrThrow(store, subject),
        gradeBand: gradeBandOrThrow(gradeBand),
      });
      if (result.total === 0) result.hint = EMPTY_HINT;
      return ok(result);
    })
  );

  server.registerTool(
    'get_standard',
    {
      title: '성취기준 상세',
      description: '성취기준 코드(공백·대시 이형 무관)로 공식 원문, 과목, 학년군, 영역, 근거 고시를 조회한다. 판이 갈린 코드(즐거운 생활)는 최신 판과 시행 중인 이전 판(edition)을 모두 돌려준다.',
      inputSchema: { code: z.string().max(100).describe('성취기준 코드 (예: [4국어01-01], 9수학04-01)') },
    },
    guarded(async ({ code }) => {
      const normalized = normalizeCode(code);
      const canon = canonicalCode(code);
      const hits = store.standardsByCode.get(canon) ?? [];
      if (hits.length === 0) {
        // 비교는 canonical 키로, 제안은 고시 원문 표기로 — '9수학04-09' → '[09수학04-01]' 계열.
        const similar = suggestSimilar(canon, [...store.standardsByCode.keys()])
          .flatMap((k) => store.standardsByCode.get(k).map((s) => s.code));
        return fail(`성취기준 ${normalized}을(를) 찾을 수 없습니다.`, [...new Set(similar)]);
      }
      return ok({
        results: hits.map((s) => {
          const note = store.subjectsById.get(s.subjectId)?.note;
          return {
            ...s,
            officialText: store.textsByKey.get(s.key),
            codeStructure: parseBasicCode(s.code),
            ...(note ? { subjectNote: note } : {}),
          };
        }),
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
      });
    })
  );

  return server;
}

export const TOOL_NAMES = [
  'get_grade_band_overview', 'get_learning_roadmap', 'get_operation_guidelines', 'get_standard',
  'list_subjects', 'search_standards',
];
export { ABOUT_URI };
