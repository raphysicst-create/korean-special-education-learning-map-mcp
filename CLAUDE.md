# CLAUDE.md

한국 2022 개정 특수교육 교육과정 성취기준 MCP 서버 (npm: `korean-special-education-learning-map-mcp`, 레지스트리: `io.github.raphysicst-create/korean-special-education-learning-map-mcp`). v0.2 범위: 【별책 3】 기본 교육과정(category `basic`)과 【별책 2】 특수교육 전문 교과(직업·생활 `special-vocational`, 이료 `ilyo`)의 성취기준 원문 전량, 내용 체계 표·성취기준 해설·적용 시 고려 사항·영역 안내, 과목별 성격·목표와 교수·학습 및 평가 + 【별책 1】 총론 중 Ⅲ-3 기본 교육과정 편성·운영(편제·배당표·운영 기준). stdio 완전 로컬, 도구 9종.

**현재 상태(v0.2.0, 미게시 — v0.1.0도 미게시):** `data/kr/{basic,special-vocational,ilyo}`에 성취기준 1,490건(40과목: 691·363·436), 내용 체계(`content-systems.json`)·해설(`standard-notes.json`)·성격·목표와 교수·학습 및 평가(`subject-guides.json`), `data/kr/operation-guidelines.json`에 편성·운영(학교급 3, 편제 14항, 배당표 3개, 운영 기준 45항). 수량은 `pipeline/gates.json`. 원본은 국가교육위원회 고시 제2026-2호 반영본 별책 3·별책 2 PDF·HWP, 2024-4호 판 별책 3·별책 2 PDF·HWP(이전 판·대조용), 별책 1 HWP·PDF(NCIC, `pipeline/sources.json`에 해시 고정). 게시(npm·레지스트리)는 사람이 한다. 첫 실행 절차는 `docs/first-run.md`, v0.2 설계는 `docs/plan-v0.2-annex2-and-subject-guides.md`.

## 명령

- `npm test` — 테스트 전체 (합성 PDF 텍스트 fixture로 파이프라인→서버 전 구간)
- `npm run pipeline:fetch [-- --pin]` — 별책 PDF 확보·SHA-256 대조. `--pin`은 null 해시를 실제 값으로 고정
- `npm run pipeline:discover` — 코드 접두어·학년군·영역 실측 보고서 `.cache/discovery-*.json`
- `npm run pipeline:extract [-- --record-gates]` — `pipeline/subjects.json` 대응표로 `data/kr/{category}` 성취기준 산출(별책·카테고리 여러 개)
- `npm run pipeline:operation [-- --record-gates]` — 별책 1 HWP 문단 + `pipeline/operation-tables.json`(배당표 전사)로 `data/kr/operation-guidelines.json` 산출, 별책 1 PDF와 대조
- `npm run pipeline:details [-- --record-gates]` — 별책 3·2 HWP 표 칸·문단으로 `content-systems.json`·`standard-notes.json` 산출, 같은 별책 PDF(-layout·-raw)와 대조, 이전 판(2024-4) HWP와 비교
- `npm run pipeline:guides [-- --record-gates]` — 별책 3·2 HWP 문단으로 과목별 `subject-guides.json`(성격·목표, 교수·학습 및 평가) 산출, PDF와 대조, 이전 판과 비교
- `npm run pipeline:verify` — 무결성·게이트 검증 + `data/kr/manifest.json` 기록 (**데이터 변경 후 필수**)

파이프라인 순서: `fetch → discover → (subjects.json 작성) → extract → operation → details → guides → verify`. PDF·HWP·`.cache/`는 커밋하지 않는다. `sources.json`의 `role`: `standards`(성취기준, PDF) · `standards-previous`(시행 중인 이전 판 성취기준, PDF) · `details`(내용 체계·해설·성격·교수·학습 원문, HWP) · `details-previous`(이전 판, HWP) · `operation`(편성·운영 원문, HWP) · `operation-check`(대조용 PDF). 출처 하나가 카테고리 여럿을 내면 `categories`(별책 2: `special-vocational`·`ilyo`), 하나면 `category`. 이전 판 출처는 같은 `annexNo`의 최신 판과 짝짓는다.

`pdftotext`는 poppler 판을 쓴다. Windows의 Git Bash에서는 Git에 딸린 xpdf 판(`/mingw64/bin`)이 먼저 잡히므로 poppler `Library/bin`을 PATH 앞에 둔다(winget `oschwartz10612.Poppler`). 기본 교육과정 691건은 poppler -layout으로 추출했고, poppler -raw·xpdf -layout 출력과 전량 일치한다. 전문 교과 799건은 poppler -layout으로 추출했고, 두 판 PDF의 -raw 출력과 코드·원문이 전량 일치한다.

## 규칙 (직업계 MCP와 동일)

- 순수 ESM `.mjs`만, TypeScript·빌드 금지. 런타임 의존성 `@modelcontextprotocol/sdk` + `zod` 2종만.
- stdout은 MCP 프로토콜 전용 — 사람용 로그는 `console.error`.
- 도구 이름 영어 snake_case, 설명·에러 한국어. 검색 limit 기본 20 최대 50, NFC + 부분 일치만.
- 원문은 별책 3(기본 교육과정)과 별책 2 중 특수교육 전문 교과의 성취기준 본문 문장·내용 체계 표·성취기준 해설·적용 시 고려 사항·영역 안내·과목 '1. 성격 및 목표'·'3. 교수·학습 및 평가'와, 총론 Ⅲ-3 기본 교육과정 편성·운영의 조항·표·주석만. 교과(군)별 '교육과정 설계의 개요', 창의적 체험활동·일상생활 활동, 별책 2의 유치원·특수교육 공통 교육과정·공통국어(청각장애), 총론의 다른 절은 싣지 않는다. **출시 범위 = 원문 범위** (원문 없는 성취기준 출시 금지 — verify가 막는다).
- 아키텍처: normalize → data-store(manifest 해시 검증 후 전량 로드) → search(순수 함수) → server → cli. 역방향 의존 금지.

## 직업계 MCP와 다른 점 (가정 금지)

- **상류 골격 데이터가 없다.** DECK6에는 특수교육이 없으므로 코드·학년군·영역·과목을 모두 PDF에서 직접 추출한다. topics·clusters·선수관계는 없다.
- **과목 대응표는 사람이 확정한다.** `pipeline/subjects.json`의 `mappings`(카테고리 → 코드 접두어 → 과목)를 discover 보고서와 별책 목차로 대조해 채운다. 추측 금지 — 대응표에도 `outOfScope`에도 없는 접두어는 extract가 `unmapped-prefix`로 실패한다. 기본 교육과정 접두어는 2글자다(`국어`·`수학`·`바생`·`진로`·`정통`·`생영` 등, 코드 예 `[4국어01-01]`). 전문 교과는 `직준`·`해부` 등 2글자와 `작업I`·`작업II`(원문 `[12작업Ⅰ01-01]` — 대응표 키는 로마 숫자를 ASCII로). 카테고리 표시 정보(교육과정·교과(군))는 `categories`.
- **학년군 코드는 2·4·6·9·12이고, 중학교 일부는 '09'다.** 고시 원문이 수학 규칙성(`[09수학04-xx]`)과 생활영어 중학교(`[09생영…]`)를 '09'로 적는다. `GRADE_BANDS`의 `aliases`로 받고, 조회는 `canonicalCode`(앞자리 0 제거)로 맞춘다. 저장·표시는 원문 표기 그대로.
- **조판 컷 패턴은 실측으로 보강했다.** 성취기준 목록은 들여쓰기 0~1칸이고, 통합교과 내용 체계 표의 성취기준 열은 40칸 넘게 들여써진다(`MAX_LIST_INDENT`). 통합교과는 목록 뒤에 성취기준마다 해설 머리로 코드·원문을 다시 싣는다(같은 원문이면 `repeatedCodes`로 무해, 다르면 `duplicateCodes` — extract가 `conflicting-duplicate`로 출시를 막고 `exceptions.json`에 원문을 적어야 풀린다). 같은 코드 판정은 `canonicalCode` 기준. 코드 뒤 공백이 빠진 목록 항목도 받고, 조사가 붙은 줄 첫머리 상호참조는 버리되 목록 항목이 없으면 `rejected-list-code`로 실패시킨다. 과목·학년군·영역 순번 결번은 extract와 verify가 모두 실패시킨다(중간 누락 탐지). 조판을 보강할 때마다 `tests/fixtures/sample-pdftotext.mjs`의 `REAL_PDF_TEXT`에 실제 발췌를 추가한다.
- 영역명은 코드의 영역 번호와 같은 번호의 `(N) 영역명` 머리글을 그 코드가 속한 '2. 내용 체계 및 성취기준'(과학은 '내용 체계와 성취기준') 절 안 앞쪽에서 찾아 붙인다(`STANDARDS_SECTION`). '3. 교수·학습 및 평가' 절의 '(1) 평가의 방향' 같은 머리글은 영역에서 제외한다. 통합교과 4과목(바생·슬생·건생·즐생)은 4개 영역 중첩이라 머리글이 없다 — 대응표의 `domainKorean`('통합교과 4개 영역 중첩')을 쓴다.
- 일상생활 활동·창의적 체험활동은 국가 수준 성취기준(코드)이 없다 — 수록 대상이 아니다.
- 성취기준 key는 `${category}:${code}` (예: `basic:[4국어01-01]`, `special-vocational:[12작업Ⅰ01-01]`). 코드는 원문 표기 그대로(`displayCode` — 로마 숫자 유지) 저장하고, 비교·조회는 `normalizeCode`/`canonicalCode`(로마 숫자 → ASCII, 앞자리 0 제거)로 한다.
- **시행 중인 이전 판:** `sources.json`의 `role: standards-previous`(제2024-4호 별책 3)에서 `include.prefixes` 과목(현재 즐생)만 `edition`·`editionNote`를 달아 같은 category 파일에 덧붙인다. key는 `${category}:${code}@${edition}`이다. include 밖 과목은 두 판이 양방향으로 같아야 한다(`selectPreviousEdition` — 이전 판에만/최신 판에만 있는 것, 원문·영역 차이 모두 실패). 최신 판에서 신설된 과목은 `currentOnly.prefixes`(현재 건생)로 밝힌다. 이전 판 예외 보정은 `exceptions.json`에 `basic:[코드]@판` key로 적는다(맨 코드 key는 최신 판에만 적용). 수량(`subjects.standardCount`, gates `standards`)·로드맵·학년군 개요는 최신 판만 센다. 이전 판 수량은 `previousEdition`(subjects, gates)으로 따로 둔다. 2028.3.1. 이후에는 이 source와 `details-previous` source를 지우고 다시 돌린다.
- **근거 고시는 세 겹이다:** 교육부 고시 제2022-34호 + 국가교육위원회 고시 제2024-4호(별책 3 성취기준 변화 없음) + 제2026-2호(초1~2 통합교과 개편: 건강한 생활 신설, 즐거운 생활 9→6). 수록본은 2026-2호 반영본이다. 2026-2호의 초1~2 시행일은 2028.3.1.이라 그 전까지 현장은 이전 판 즐거운 생활 9개를 따른다 — 이 9개를 이전 판으로 함께 싣고 과목 `note`로 안내한다. 확인 근거는 `sources.json`의 `amendments[]`.

## 편성·운영(별책 1) 파이프라인 (성취기준과 다른 점)

- **조항 원문은 HWP에서 가져온다.** 총론 PDF는 글자 단위로 줄을 바꿔('학부모에 / 게') 줄 이음을 되살릴 수 없다. `pipeline/hwp-text.mjs`가 Node 내장 zlib만으로 HWP 5.0(OLE 복합 문서) 문단을 읽는다. 배포용(복사 방지) HWP는 읽지 않고 실패한다. 추출 결과는 같은 고시의 PDF와 공백 무시 글자 대조를 통과해야 한다.
- **배당표는 사람이 옮긴다.** `pipeline/operation-tables.json` 값은 고시 표기 그대로(쉼표·괄호 포함). extract-operation이 HWP 표 칸 목록과 순서까지 대조하고, verify가 합계를 검산한다. <표 9> 1~2학년 칸은 교과 구성이 달라 한 칸에 교과별 시수 목록이 들어 있다(`breakdown`).
- 구조 해석이 엄격하다: 번호 없는 문단, 표 주석 사이의 예상 밖 문단, 모르는 표 번호는 실패한다. 고시가 바뀌면 실패 메시지를 보고 HWP 구조를 확인한 뒤 고친다.
- 개발 PC에 원본 HWP가 있으면 `tests/operation.test.mjs`가 재추출 결과를 출시 데이터와 끝까지 맞춰 본다(CI에서는 건너뜀).

## 내용 체계·해설(별책 3 HWP) 파이프라인

- **표는 칸 위치까지 읽는다.** `hwpBlocks`(hwp-text.mjs)가 문단과 표(칸의 행·열·병합 범위, 칸 안 문단)를 레코드 수준으로 돌려준다. 별책 3 PDF는 표 칸을 섞어 내보내 구조를 되살릴 수 없다.
- **절 경계:** 과목마다 '가. 내용 체계' → '나. 성취기준' → 글상자 '3. 교수·학습 및 평가'. 과목은 성취기준 목록 상자(1x1 표)의 코드 접두어로 정한다.
- **표 모양 세 가지:** 행 배치(교과 대부분 — '핵심 아이디어' 행, '범주|내용 요소' 머리 행들, 범주 행; 범주 옆 머리 칸은 `subArea`), 열 배치(2026 통합교과 — '핵심 아이디어|범주|내용 요소|성취기준'), 2024 통합교과의 세 과목 나란히 표(`columnSubject`로 과목 열만). 학년군 열 머리는 '초등학교 + 1~2학년'처럼 위아래 머리 칸을 이어 `resolveGradeBand`로 푼다. 내용 칸이 여러 행에 걸치면 실패한다. 글머리표 없는 칸 문단은 앞 항목의 줄바꿈이라 잇는다.
- **해설 형식 두 가지:** 학년군·영역 절(`sections`) → 하위 영역 묶음(`groups`: 목록 상자 코드·안내·`explanations`·`considerations`). 문단 첫머리 코드(`[코드], [코드]`)가 가리킬 성취기준이고, 코드 없는 고려 사항은 묶음 전체(`codes: []`). 2026 건강한 생활·즐거운 생활은 성취기준마다 상자가 있고 문단이 소제목(`EXPLANATION_LABELS`·`CONSIDERATION_LABELS`)으로 시작한다 — 모르는 소제목은 실패.
- **HWP 전용 글자:** `cleanText`의 `PUA_MAP`(U+F0810 `|`, U+F09E `·`)과 네모 숫자(U+F02B1~ → ①~)만 받는다. 새 전용 글자는 실패하므로 지면 이미지로 확인해 더한다. PDF 쪽은 같은 기호가 `ž`·U+F000으로 나와 대조 때 지운다.
- **예외표 `pipeline/details-exceptions.json`:** `codeLeads`(학년군 숫자가 빠진 첫머리 코드 오기 — 현재 `[6수학01-11], [수학01-12]`), `verticalLabels`(세로쓰기 머리 칸의 띄어쓰기 — 사회 하위 범주). 근거 없이 추가하지 말 것. 쓰이지 않는 항목도 실패한다.
- **검증:** 목록 상자 원문 = 출시 성취기준 원문, 상자 코드가 그 판 성취기준을 정확히 한 번씩, 영역 번호·이름 일치, 통합교과 표의 성취기준 열 = 성취기준 목록, 모든 문단·항목이 PDF(-layout 또는 -raw)에 공백 무시로 있음. verify는 판 구성·범주 3개·학년군 열·문장 종결(`다.`, 원문 오기 `다,` 2건 허용)·깨진 글자와 `gates.details` 수량을 본다.
- **이전 판:** `details-previous` include(즐생·바생·슬생)만 edition `2024-4`로 싣는다. 바생·슬생은 성취기준은 같고 해설 문구만 다르다. include 밖 과목은 두 판이 같아야 하고, include 과목이 실제로 같으면 실패한다(`compareEditions`). 이전 판 표는 세 과목 나란히 표에서 과목 열만 뽑는다.
- 개발 PC에 원본 HWP가 있으면 `tests/details.test.mjs`가 재추출 결과를 출시 데이터와 맞춰 본다(CI에서는 건너뜀). 조판 보강 시 `tests/fixtures/details-blocks.mjs`에 실제 발췌를 더한다(생성기는 hwpBlocks 출력 그대로).

## 특수교육 전문 교과(별책 2) — 기본 교육과정과 다른 점

- **별책 2는 유치원·공통·선택 중심 교육과정이 한 파일이다.** 수록은 '[선택 중심 교육과정] - 특수교육 전문 교과'(총론 <표 8>의 24과목)만. 나머지 접두어(`국`·`공국`·`체`·`미`·`점자`·`수어`)는 `subjects.json` `outOfScope`에 근거와 함께 밝힌다(`pipeline/scope.mjs`의 `routeCode`가 성취기준·HWP 과목 절을 가른다). 범위 밖 과목 절은 details·guides가 건너뛰고 수를 보고한다.
- **같은 접두어, 다른 과목:** `시자`(시각장애인 자립생활)·`농문`(농인의 생활과 문화)은 공통 교육과정(초·중, 코드 6·9)과 전문 교과(고, 12)가 접두어를 같이 쓴다 — 대응표 `bandCodes: ["12"]`와 `outOfScope`의 `bandCodes: ["6","9"]`로 가른다.
- **표 모양 두 가지 추가:** 학년군 머리 행이 없는 한 열 표(과목 학년군이 하나일 때만), 이료의 '내용 요소' 아래 열이 하위 영역인 표(범주 × 하위 영역 행 `subArea`, 열 순서 `subAreas`, 해설 하위 영역 머리글 ①…과 수·순서가 같아야 한다). 학년군 열인지는 열 머리에 '학교'·'학년'이 있는지로 가른다(`resolveGradeBand`는 '중추신경계통'도 중학교로 읽는다).
- **절 경계:** 공통국어(청각장애)1·2는 1절·3절을 함께 쓰고 '가. 내용 체계'만 두 번 나온다 — 과목 절은 다음 '가. 내용 체계'나 '3. 교수·학습' 중 앞선 데서 끊는다.
- 직업·생활은 원문이 성취기준 일부에만 해설을 단다(363개 중 269개). 이료는 436개 모두.
- **원문 표기 차이:** 안마·마사지·지압 영역 3 이름이 내용 체계와 성취기준 머리글에서 다르다 → `details-exceptions.json` `domainNames`(extract-details·verify 모두 본다). 이료 6개 영역의 하위 영역 이름이 표와 해설에서 조금 다른 것은 안내만 낸다(각 표기 원문대로).
- 두 판(2024-4·2026-2)의 전문 교과 부분은 모두 같다 — 이전 판 출처는 include가 빈 대조 전용이다. 다르게 바뀌면 판본 비교가 실패하므로 include에 과목을 넣는다.

## 성격·목표, 교수·학습 및 평가(`pipeline:guides`)

- 과목 절은 details와 같이 찾고(`findSubjectSections` + `classifySection`), 1절은 그 앞 '1. 성격 및 목표' 글상자 ~ '2. 내용 체계' 글상자, 3절은 '3. 교수·학습 및 평가' 글상자 ~ 다음 글상자(과목 제목 등)나 표. 3절 끝 뒤 다음 과목 1절 전까지 3절 항목 같은 문단이 남으면 실패한다.
- 1절 머리글: '가. 성격' 또는 통합교과 '가. 통합교과의 성격'·'나. ○○ 생활과의 성격', 마지막 '○. 목표'(총괄 목표 문단 + '(1)'… 세부 목표). 3절: '가. 교수·학습'·'나. 평가' 각각 '(1) …의 방향'·'(2) … 방법'(`PART_IDS` — 모르는 머리글 실패), 항목 '(가)'…(`ITEM_ORDER`, (하) 다음 (거)…), 번호 없는 문단은 앞 항목의 `subItems`.
- 원문 오류는 `details-exceptions.json`에 적은 것만 받는다: `missingPartHeadings`(첫 부분 머리글 누락 → `heading: null`), `itemNumbering`(결번·중복 번호, 번호는 원문대로). 키는 '과목 id[@판]|자리', 판 없는 키는 두 판 모두. 쓰이지 않는 항목도 실패.
- verify: 성격·목표 문장은 '다.'로 끝나고, '다.'로 끝나지 않는 3절 항목(2026 건강한 생활·즐거운 생활의 소제목형)에는 하위 문단이 있어야 한다. 수량은 `gates.guides`(카테고리별).
- PDF 대조는 공백과 가운뎃점을 양쪽에서 빼고 한다(`pdfChecker` — PDF가 보통 가운뎃점을 기호 글꼴 'ž'로 내보내는 곳이 있다).

## 로드맵

- v0.1: 기본 교육과정 (category `basic`, 성취기준·내용 체계·해설) + 총론 기본 교육과정 편성·운영 — 데이터 완료, 게시 대기
- 다음 고시 개정 시: NCIC 「우리나라 교육과정 > 원문 및 해설서 > 2022 개정 시기 > 특수교육(YYYY.MM)」에서 별책 3 PDF·HWP를 받아 `sources.json`의 url·notice·sha256을 바꾸고 파이프라인을 다시 돌린다. 판본 간 성취기준 비교로 개정 범위를 확인해 `amendments[]`에 기록한다.
- v0.2: 특수교육 전문 교과 직업·생활·이료 (【별책 2】, category `special-vocational`·`ilyo`) + 전 과목 성격·목표, 교수·학습 및 평가(`get_subject_guide`·`search_subject_guides`) — 데이터 완료, 게시 대기
- 이후 후보: 교과(군)별 '교육과정 설계의 개요', 창의적 체험활동·일상생활 활동(성취기준 없음, 영역·활동 원문), 별책 2 특수교육 공통 교육과정(국어(청각장애) 등 — 코드가 공통 교육과정과 다른 꼴 포함)
- v0.3 후보: 기본 ↔ 공통 교육과정 성취기준 연계 (통합학급·개별화교육계획용, korean-secondary-learning-map-mcp와 교차)

## 배포 절차

1. 버전 bump — **파일 4개, 값 6곳**: `package.json`, `package-lock.json`(최상위 `version` + `packages[""].version`), `server.json`(서버·packages), `src/server.mjs`의 `SERVER_INFO.version`.
2. `npm run pipeline:extract -- --record-gates && npm run pipeline:details -- --record-gates && npm run pipeline:guides -- --record-gates && npm run pipeline:verify && npm test` (gates.release·manifest.taxonomyVersion이 새 버전을 따른다)
3. `npm publish --browser=false` (2FA)
4. `mcp-publisher publish`

## 관련 저장소

- 보통교과·특목 계열: https://github.com/raphysicst-create/korean-secondary-learning-map-mcp
- 특성화고 전문교과: https://github.com/raphysicst-create/korean-vocational-learning-map-mcp
