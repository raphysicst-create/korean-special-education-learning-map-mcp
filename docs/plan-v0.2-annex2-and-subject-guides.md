# v0.2 설계: 별책 2 특수교육 전문 교과 + 과목 성격·목표, 교수·학습 및 평가

작성 2026-11-14(기획), 구현·게시 2026-11-15(v0.2.0, npm·MCP 레지스트리). 아래는 구현된 구조이며, 기획 단계에서 바뀐 결정은 각 절에 적었다. 실행 기록은 `docs/first-run.md`의 'v0.2.0 실행 기록'.

## 1. 범위

| 묶음 | 원본 | 내용 |
|---|---|---|
| A | 【별책 3】 기본 교육과정 | 16과목의 `1. 성격 및 목표`, `3. 교수·학습 및 평가` |
| B | 【별책 2】 유치원, 공통 및 선택 중심 | 특수교육 전문 교과 24과목(직업·생활 14, 이료 10)의 성취기준·내용 체계·해설 + 성격·목표, 교수·학습 및 평가 |

넣지 않은 것: 교과(군)별 `교육과정 설계의 개요`(그림·표가 섞인 해설 글), 창의적 체험활동·일상생활 활동(절 구성이 다르다), 별책 2의 유치원·특수교육 공통 교육과정·공통국어(청각장애), 총론의 선택 중심 교육과정 편성·운영.

## 2. 실측 결과

### 2.1 별책 3 성격·목표, 교수·학습 및 평가

- 절 경계: 글상자 `1. 성격 및 목표` → `2. 내용 체계 및 성취기준` → `3. 교수·학습 및 평가` → 다음 과목 제목 글상자. 16과목 모두 같다.
- 1절: 교과 12과목은 `가. 성격`/`나. 목표`, 통합교과 4과목은 `가. 통합교과의 성격`/`나. ○○ 생활과의 성격`/`다. 목표`. 목표는 총괄 목표 문단 + `(1)`~ 세부 목표.
- 3절: `가. 교수·학습` > `(1) 교수·학습의 방향`·`(2) 교수·학습 방법`, `나. 평가` > `(1) 평가의 방향`·`(2) 평가 방법`. 항목 `(가)`~, 번호 없는 하위 문단. 2026 건강한 생활·즐거운 생활은 항목이 소제목이고 내용이 하위 문단이다.
- 판본: 교과 12과목과 건강한 생활(신설)을 뺀 바른 생활·슬기로운 생활·즐거운 생활은 2024-4호 판과 다르다. 2024-4호 즐거운 생활은 원문에 `(1) 교수·학습의 방향` 머리글이 없다.

### 2.2 별책 2

- NCIC 「특수교육(2026.01)」 PDF seq 10004196·HWP seq 10004195, 「특수교육(2024.08)」 PDF seq 10003979·HWP seq 10003980. HWP 5.1.1.0, 암호·배포용 아님.
- 기존 PDF 추출기가 그대로 동작했다: 성취기준 후보 1,458건(접두어 29종) 중 전문 교과 799건(직업·생활 363, 이료 436), 범위 밖 659건.
- 코드 접두어: `직준` `안직` `작업Ⅰ` `작업Ⅱ` `정처` `농생` `사무` `대인` `외식` `직실` `직자` `사적` `시자` `농문` / `해부` `병리` `이보` `안마` `전치` `한방` `침구` `이임` `진단` `이실`. 모두 코드 12(고등학교).
- `시자`·`농문`은 공통 교육과정(초·중, 6·9)과 전문 교과(12)가 접두어를 같이 쓴다.
- 절 구성은 별책 3과 같다(성격·목표 → 내용 체계·성취기준 → 교수·학습 및 평가). 성취기준 절은 학년군 머리글 없이 `(N) 영역` → 영역 안내 → 목록 상자 → `(가) 성취기준 해설` → `(나) 성취기준 적용 시 고려 사항`. 이료는 영역 안에 `① 하위 영역` 머리글이 있다.
- 내용 체계 표: 직업·생활은 학년군 머리 행이 없는 한 열 표, 이료는 '내용 요소' 아래 열이 하위 영역인 표.
- 직업·생활은 원문이 성취기준 363개 중 269개에만 해설을 달았다. 이료는 436개 모두.
- 두 판(2024-4·2026-2)의 전문 교과 부분은 성취기준·내용 체계·해설·성격·목표·교수·학습 및 평가 모두 같다.
- 원문 표기 차이·오류: 안마·마사지·지압 영역 3 이름(내용 체계 '안마·마사지·지압의 효과' / 성취기준 '안마, 마사지, 지압의 효과'), 이료 6개 영역 하위 영역 이름(표 / 해설 머리글), 정보처리 (타)·(자) 결번, 농생명 (다) 중복. 공통국어(청각장애)1·2(범위 밖)는 1절·3절을 함께 쓴다.

## 3. 자료 구조

```
data/kr/
  subjects.json                     과목 40 (curriculumKorean·subjectGroupKorean 추가)
  manifest.json                     counts.details·counts.guides는 카테고리별
  operation-guidelines.json         변화 없음
  basic/                            + subject-guides.json
  special-vocational/               curriculum-standards · standard-texts · content-systems · standard-notes · subject-guides
  ilyo/                             같은 파일 5종
```

- category: `basic`, `special-vocational`(직업·생활), `ilyo`(이료). 성취기준 key `${category}:${code}`.
- 코드는 원문 표기 그대로 저장한다(`[12작업Ⅰ01-01]`). 조회는 `normalizeCode`/`canonicalCode`로 로마 숫자를 ASCII로 맞춘다.
- 과목 항목: `curriculumKorean`(`기본 교육과정` | `선택 중심 교육과정 특수교육 전문 교과`), `subjectGroupKorean`(`직업·생활` | `이료`, 전문 교과만).
- 이료 내용 체계 영역: `subAreas`(표 열 순서) + 행마다 `subArea`. 열은 `[{ gradeBand: 'h1-3', label: null }]`.

### 3.1 `subject-guides.json`

```json
{
  "version": "kr-special-subject-guides-v1",
  "category": "basic",
  "sourceNote": "…",
  "subjects": [
    {
      "subjectId": "right-living", "subjectKorean": "바른 생활", "sourceId": "nec-2026-2-annex3-hwp",
      "nature": { "sections": [ { "heading": "가. 통합교과의 성격", "paragraphs": ["…"] }, { "heading": "나. 바른 생활과의 성격", "paragraphs": ["…"] } ] },
      "goals": { "heading": "다. 목표", "overall": ["…"], "items": [ { "no": "(1)", "text": "…" } ] },
      "teachingLearning": { "heading": "가. 교수·학습", "parts": [
        { "id": "direction", "heading": "(1) 교수·학습의 방향", "items": [ { "no": "(가)", "text": "…", "subItems": ["…"] } ] },
        { "id": "methods", "heading": "(2) 교수·학습 방법", "items": [] } ] },
      "assessment": { "heading": "나. 평가", "parts": [ { "id": "direction", "…": "…" }, { "id": "methods", "…": "…" } ] }
    }
  ]
}
```

- 기획과 달라진 점: `goals.overall`은 문자열이 아니라 배열(문단 여럿 가능), 성격 절의 `scope` 필드는 두지 않았다(머리글로 충분).
- 원문에 없는 첫 부분 머리글은 `heading: null`(2024-4호 즐거운 생활). 번호는 원문대로.
- 이전 판(바른 생활·슬기로운 생활·즐거운 생활)은 같은 파일에 `edition: "2024-4"`, `editionNote`를 단 항목으로 덧붙인다.

### 3.2 `pipeline/sources.json`

| id | role | 비고 |
|---|---|---|
| `nec-2026-2-annex2` | `standards` | `categories: ["special-vocational", "ilyo"]` |
| `nec-2026-2-annex2-hwp` | `details` | 내용 체계·해설·성격·교수·학습 |
| `nec-2024-4-annex2` | `standards-previous` | `include.prefixes: []` — 대조 전용(두 판이 같아야 통과) |
| `nec-2024-4-annex2-hwp` | `details-previous` | 같은 방식 |

- 기획의 `scope`(추출 구간 머리글) 대신 코드로 가른다: 대응표 + `outOfScope`. 구간 머리글보다 개정에 덜 깨지고, 성취기준·HWP 과목 절 모두에 같은 규칙을 쓴다.
- 이전 판 출처는 같은 `annexNo`의 최신 판과 짝짓는다. 새 role은 만들지 않았다.

### 3.3 `pipeline/subjects.json`

- `categories`(카테고리 표시 정보), `mappings`(카테고리 → 접두어 → 과목), `outOfScope`(별책 번호·접두어·학년군 코드·근거).
- 대응표 항목의 `bandCodes`: 그 학년군 코드만 그 과목(`시자`·`농문` → `["12"]`).
- 대응표에도 `outOfScope`에도 없는 접두어는 `unmapped-prefix`로 실패한다.

### 3.4 `pipeline/details-exceptions.json` (원문 표기·오류)

- `codeLeads`, `verticalLabels`(v0.1)에 더해 `domainNames`(영역 이름이 두 절에서 다른 곳), `missingPartHeadings`(3절 첫 부분 머리글 누락), `itemNumbering`(3절 항목 결번·중복). 모두 근거를 적고, 쓰이지 않는 항목은 실패한다.

### 3.5 `gates.json` · `manifest.json`

- `gates.categories`에 세 카테고리. 카테고리에 게이트가 없으면 verify 실패.
- `gates.details`·`gates.guides`는 카테고리별(`{ basic: {…}, "special-vocational": {…}, ilyo: {…} }`). `manifest.counts`도 같은 구성.

## 4. 파이프라인

`fetch → discover → (대응표) → extract → operation → details → guides → verify`

- `pipeline/scope.mjs`: `routeCode`(접두어 + 학년군 코드 → 카테고리·과목 | 범위 밖 | 없음), `annexCategories`, `mergedMappings`, `categoryInfo`.
- extract: 별책·카테고리를 돌며 `routeRecords`로 가르고 카테고리별로 `buildDataset`. 범위 밖 수를 보고한다. 이전 판은 같은 별책끼리.
- details: `classifySection`이 목록 상자 코드로 과목 절을 판정하고 범위 밖 절은 건너뛴다. 한 열 표·하위 영역 열 표 추가, 절 끝은 다음 '가. 내용 체계'나 '3. 교수·학습' 중 앞선 곳.
- guides(`pipeline/extract-guides.mjs`): 1절·3절 경계, 엄격한 머리글·번호 해석, PDF 대조(`pdfChecker`), 이전 판 비교, 3절 끝 뒤 남은 항목 검사.
- verify: `verifyGuides`(판 구성·문장 종결·부분 구성·번호 꼴·소제목형 항목의 하위 문단), 카테고리별 게이트, 과목·성취기준 카테고리 일치.

## 5. 서버 (도구 9종)

| 도구 | 변화 |
|---|---|
| `get_subject_guide` (신규) | `subject`, `part`(성격 \| 목표 \| 교수·학습 \| 평가). 통합교과 3과목은 `previousEdition` |
| `search_subject_guides` (신규) | `query`, `subject`·`category`·`part` 필터, 하위 문단 일치는 `matchedSubItems` |
| `list_subjects` | `category` 필터, `categories` 요약, 과목에 `curriculumKorean`·`subjectGroupKorean` |
| `search_standards` | `category` 필터, 결과에 `category` |
| `get_grade_band_overview` | `category` 필터, 고1~3은 기본 → 직업·생활 → 이료 순, 학년군 목록에 `byCategory`. 전문 교과만 고르면 배당 기준을 붙이지 않는다 |
| `get_standard` | `curriculumKorean`·`subjectGroupKorean` |
| `get_content_system` | 이료 `subAreas` |

`category` 입력: `basic`·`기본 교육과정`, `special-vocational`·`직업·생활`, `ilyo`·`이료`, `전문 교과`(둘 다).

## 6. 결정 기록

| # | 결정 | 결과 |
|---|---|---|
| 1 | 전문 교과 category 수 | 둘(`special-vocational`, `ilyo`) |
| 2 | 별책 2 범위 | 특수교육 전문 교과 24과목만, 나머지는 `outOfScope` |
| 3 | 설계의 개요·창체·일상생활 활동 | 제외 |
| 4 | 통합교과 이전 판 성격·교수·학습 | 함께 싣는다 |
| 5 | `search_subject_guides` | 넣었다 |
| 6 | 출시 단위 | v0.2.0 하나 |
| 7 | 원문 표기 차이 | 고치지 않고 각 절 표기를 그대로, 대조는 예외표·안내로 통과 |
