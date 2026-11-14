# CLAUDE.md

한국 2022 개정 특수교육 교육과정 성취기준 MCP 서버 (npm: `korean-special-education-learning-map-mcp`, 레지스트리: `io.github.raphysicst-create/korean-special-education-learning-map-mcp`). v0.1 범위: 【별책 3】 기본 교육과정 교과 성취기준 원문 전량 + 【별책 1】 총론 중 Ⅲ-3 기본 교육과정 편성·운영(편제·배당표·운영 기준). stdio 완전 로컬, 도구 6종.

**현재 상태(v0.1.0, 미게시):** `data/kr/basic`에 성취기준 691건(16과목), `data/kr/operation-guidelines.json`에 편성·운영(학교급 3, 편제 14항, 배당표 3개, 운영 기준 45항). 원본은 국가교육위원회 고시 제2026-2호 반영본 별책 3 PDF, 별책 1 HWP·PDF(NCIC, `pipeline/sources.json`에 해시 고정). 게시(npm·레지스트리)는 사람이 한다. 첫 실행 절차는 `docs/first-run.md`.

## 명령

- `npm test` — 테스트 전체 (합성 PDF 텍스트 fixture로 파이프라인→서버 전 구간)
- `npm run pipeline:fetch [-- --pin]` — 별책 PDF 확보·SHA-256 대조. `--pin`은 null 해시를 실제 값으로 고정
- `npm run pipeline:discover` — 코드 접두어·학년군·영역 실측 보고서 `.cache/discovery-*.json`
- `npm run pipeline:extract [-- --record-gates]` — `pipeline/subjects.json` 대응표로 `data/kr/basic` 산출
- `npm run pipeline:operation [-- --record-gates]` — 별책 1 HWP 문단 + `pipeline/operation-tables.json`(배당표 전사)로 `data/kr/operation-guidelines.json` 산출, 별책 1 PDF와 대조
- `npm run pipeline:verify` — 무결성·게이트 검증 + `data/kr/manifest.json` 기록 (**데이터 변경 후 필수**)

파이프라인 순서: `fetch → discover → (subjects.json 작성) → extract → operation → verify`. PDF·HWP·`.cache/`는 커밋하지 않는다. `sources.json`의 `role`: `standards`(성취기준, PDF) · `operation`(편성·운영 원문, HWP) · `operation-check`(대조용 PDF).

`pdftotext`는 poppler 판을 쓴다. Windows의 Git Bash에서는 Git에 딸린 xpdf 판(`/mingw64/bin`)이 먼저 잡히므로 poppler `Library/bin`을 PATH 앞에 둔다(winget `oschwartz10612.Poppler`). 출시 데이터 691건은 poppler -layout으로 추출했고, poppler -raw·xpdf -layout 출력과 전량 일치한다.

## 규칙 (직업계 MCP와 동일)

- 순수 ESM `.mjs`만, TypeScript·빌드 금지. 런타임 의존성 `@modelcontextprotocol/sdk` + `zod` 2종만.
- stdout은 MCP 프로토콜 전용 — 사람용 로그는 `console.error`.
- 도구 이름 영어 snake_case, 설명·에러 한국어. 검색 limit 기본 20 최대 50, NFC + 부분 일치만.
- 원문은 성취기준 본문 문장과, 총론 Ⅲ-3 기본 교육과정 편성·운영의 조항·표·주석만. 해설·고려 사항·총론의 다른 절은 싣지 않는다. **출시 범위 = 원문 범위** (원문 없는 성취기준 출시 금지 — verify가 막는다).
- 아키텍처: normalize → data-store(manifest 해시 검증 후 전량 로드) → search(순수 함수) → server → cli. 역방향 의존 금지.

## 직업계 MCP와 다른 점 (가정 금지)

- **상류 골격 데이터가 없다.** DECK6에는 특수교육이 없으므로 코드·학년군·영역·과목을 모두 PDF에서 직접 추출한다. topics·clusters·선수관계는 없다.
- **과목 대응표는 사람이 확정한다.** `pipeline/subjects.json`의 `mappings`(코드 접두어 → 과목)를 discover 보고서와 PDF 목차로 대조해 채운다. 추측 금지 — 비어 있으면 extract가 `unmapped-prefix`로 실패한다. 실제 접두어는 2글자다(`국어`·`수학`·`바생`·`진로`·`정통`·`생영` 등, 코드 예 `[4국어01-01]`).
- **학년군 코드는 2·4·6·9·12이고, 중학교 일부는 '09'다.** 고시 원문이 수학 규칙성(`[09수학04-xx]`)과 생활영어 중학교(`[09생영…]`)를 '09'로 적는다. `GRADE_BANDS`의 `aliases`로 받고, 조회는 `canonicalCode`(앞자리 0 제거)로 맞춘다. 저장·표시는 원문 표기 그대로.
- **조판 컷 패턴은 실측으로 보강했다.** 성취기준 목록은 들여쓰기 0~1칸이고, 통합교과 내용 체계 표의 성취기준 열은 40칸 넘게 들여써진다(`MAX_LIST_INDENT`). 통합교과는 목록 뒤에 성취기준마다 해설 머리로 코드·원문을 다시 싣는다(같은 원문이면 `repeatedCodes`로 무해, 다르면 `duplicateCodes` — extract가 `conflicting-duplicate`로 출시를 막고 `exceptions.json`에 원문을 적어야 풀린다). 같은 코드 판정은 `canonicalCode` 기준. 코드 뒤 공백이 빠진 목록 항목도 받고, 조사가 붙은 줄 첫머리 상호참조는 버리되 목록 항목이 없으면 `rejected-list-code`로 실패시킨다. 과목·학년군·영역 순번 결번은 extract와 verify가 모두 실패시킨다(중간 누락 탐지). 조판을 보강할 때마다 `tests/fixtures/sample-pdftotext.mjs`의 `REAL_PDF_TEXT`에 실제 발췌를 추가한다.
- 영역명은 코드의 영역 번호와 같은 번호의 `(N) 영역명` 머리글을 그 코드가 속한 '2. 내용 체계 및 성취기준'(과학은 '내용 체계와 성취기준') 절 안 앞쪽에서 찾아 붙인다(`STANDARDS_SECTION`). '3. 교수·학습 및 평가' 절의 '(1) 평가의 방향' 같은 머리글은 영역에서 제외한다. 통합교과 4과목(바생·슬생·건생·즐생)은 4개 영역 중첩이라 머리글이 없다 — 대응표의 `domainKorean`('통합교과 4개 영역 중첩')을 쓴다.
- 일상생활 활동·창의적 체험활동은 국가 수준 성취기준(코드)이 없다 — 수록 대상이 아니다.
- 성취기준 key는 `${category}:${code}` (예: `basic:[4국어01-01]`). v0.2에서 공통 교육과정과 코드가 겹쳐도 key는 충돌하지 않는다.
- **시행 중인 이전 판:** `sources.json`의 `role: standards-previous`(제2024-4호 별책 3)에서 `include.prefixes` 과목(현재 즐생)만 `edition`·`editionNote`를 달아 같은 category 파일에 덧붙인다. key는 `${category}:${code}@${edition}`이다. include 밖 과목은 두 판이 같아야 한다(`selectPreviousEdition`이 다르면 실패). 수량(`subjects.standardCount`, gates `standards`)·로드맵·학년군 개요는 최신 판만 센다. 이전 판 수량은 `previousEdition`(subjects, gates)으로 따로 둔다. 2028.3.1. 이후에는 이 source를 지우고 다시 돌린다.
- **근거 고시는 세 겹이다:** 교육부 고시 제2022-34호 + 국가교육위원회 고시 제2024-4호(별책 3 성취기준 변화 없음) + 제2026-2호(초1~2 통합교과 개편: 건강한 생활 신설, 즐거운 생활 9→6). 수록본은 2026-2호 반영본이다. 2026-2호의 초1~2 시행일은 2028.3.1.이라 그 전까지 현장은 이전 판 즐거운 생활 9개를 따른다 — 이 9개를 이전 판으로 함께 싣고 과목 `note`로 안내한다. 확인 근거는 `sources.json`의 `amendments[]`.

## 편성·운영(별책 1) 파이프라인 (성취기준과 다른 점)

- **조항 원문은 HWP에서 가져온다.** 총론 PDF는 글자 단위로 줄을 바꿔('학부모에 / 게') 줄 이음을 되살릴 수 없다. `pipeline/hwp-text.mjs`가 Node 내장 zlib만으로 HWP 5.0(OLE 복합 문서) 문단을 읽는다. 배포용(복사 방지) HWP는 읽지 않고 실패한다. 추출 결과는 같은 고시의 PDF와 공백 무시 글자 대조를 통과해야 한다.
- **배당표는 사람이 옮긴다.** `pipeline/operation-tables.json` 값은 고시 표기 그대로(쉼표·괄호 포함). extract-operation이 HWP 표 칸 목록과 순서까지 대조하고, verify가 합계를 검산한다. <표 9> 1~2학년 칸은 교과 구성이 달라 한 칸에 교과별 시수 목록이 들어 있다(`breakdown`).
- 구조 해석이 엄격하다: 번호 없는 문단, 표 주석 사이의 예상 밖 문단, 모르는 표 번호는 실패한다. 고시가 바뀌면 실패 메시지를 보고 HWP 구조를 확인한 뒤 고친다.
- 개발 PC에 원본 HWP가 있으면 `tests/operation.test.mjs`가 재추출 결과를 출시 데이터와 끝까지 맞춰 본다(CI에서는 건너뜀).

## 로드맵

- v0.1: 기본 교육과정 (category `basic`) + 총론 기본 교육과정 편성·운영 — 데이터 완료, 게시 대기
- 다음 고시 개정 시: NCIC 「우리나라 교육과정 > 원문 및 해설서 > 2022 개정 시기 > 특수교육(YYYY.MM)」에서 별책 3 PDF를 받아 `sources.json`의 url·notice·sha256을 바꾸고 파이프라인을 다시 돌린다. 판본 간 성취기준 비교로 개정 범위를 확인해 `amendments[]`에 기록한다.
- v0.2 후보: 특수교육 전문 교과 직업·생활·이료 (【별책 2】, category `special-vocational`·`ilyo`) — 데이터 폴더 추가만으로 로더는 그대로
- v0.3 후보: 기본 ↔ 공통 교육과정 성취기준 연계 (통합학급·개별화교육계획용, korean-secondary-learning-map-mcp와 교차)

## 배포 절차

1. 버전 bump — **파일 4개, 값 6곳**: `package.json`, `package-lock.json`(최상위 `version` + `packages[""].version`), `server.json`(서버·packages), `src/server.mjs`의 `SERVER_INFO.version`.
2. `npm run pipeline:extract -- --record-gates && npm run pipeline:verify && npm test` (gates.release·manifest.taxonomyVersion이 새 버전을 따른다)
3. `npm publish --browser=false` (2FA)
4. `mcp-publisher publish`

## 관련 저장소

- 보통교과·특목 계열: https://github.com/raphysicst-create/korean-secondary-learning-map-mcp
- 특성화고 전문교과: https://github.com/raphysicst-create/korean-vocational-learning-map-mcp
