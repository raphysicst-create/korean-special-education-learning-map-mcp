# CLAUDE.md

한국 2022 개정 특수교육 교육과정 성취기준 MCP 서버 (npm: `korean-special-education-learning-map-mcp`, 레지스트리: `io.github.raphysicst-create/korean-special-education-learning-map-mcp`). v0.1 목표: 【별책 3】 기본 교육과정 교과 성취기준 원문 전량. stdio 완전 로컬, 도구 5종.

**현재 상태(v0.0.1):** 코드·파이프라인·테스트(합성 fixture)만 있고 `data/kr/`는 비어 있다. 첫 실행 절차는 `docs/first-run.md`.

## 명령

- `npm test` — 테스트 전체 (합성 PDF 텍스트 fixture로 파이프라인→서버 전 구간)
- `npm run pipeline:fetch [-- --pin]` — 별책 PDF 확보·SHA-256 대조. `--pin`은 null 해시를 실제 값으로 고정
- `npm run pipeline:discover` — 코드 접두어·학년군·영역 실측 보고서 `.cache/discovery-*.json`
- `npm run pipeline:extract [-- --record-gates]` — `pipeline/subjects.json` 대응표로 `data/kr/` 산출
- `npm run pipeline:verify` — 무결성·게이트 검증 + `data/kr/manifest.json` 기록 (**데이터 변경 후 필수**)

파이프라인 순서: `fetch → discover → (subjects.json 작성) → extract → verify`. PDF·`.cache/`는 커밋하지 않는다.

## 규칙 (직업계 MCP와 동일)

- 순수 ESM `.mjs`만, TypeScript·빌드 금지. 런타임 의존성 `@modelcontextprotocol/sdk` + `zod` 2종만.
- stdout은 MCP 프로토콜 전용 — 사람용 로그는 `console.error`.
- 도구 이름 영어 snake_case, 설명·에러 한국어. 검색 limit 기본 20 최대 50, NFC + 부분 일치만.
- 원문은 성취기준 본문 문장만. **출시 범위 = 원문 범위** (원문 없는 성취기준 출시 금지 — verify가 막는다).
- 아키텍처: normalize → data-store(manifest 해시 검증 후 전량 로드) → search(순수 함수) → server → cli. 역방향 의존 금지.

## 직업계 MCP와 다른 점 (가정 금지)

- **상류 골격 데이터가 없다.** DECK6에는 특수교육이 없으므로 코드·학년군·영역·과목을 모두 PDF에서 직접 추출한다. topics·clusters·선수관계는 없다.
- **과목 대응표는 사람이 확정한다.** `pipeline/subjects.json`의 `mappings`(코드 접두어 → 과목)를 discover 보고서와 PDF 목차로 대조해 채운다. 추측 금지 — 비어 있으면 extract가 `unmapped-prefix`로 실패한다.
- **학년군 코드(2·4·6·9·12)는 일반 교육과정 관례를 따른 가정이다.** discover가 다른 숫자를 보고하면 `src/normalize.mjs`의 `GRADE_BANDS`를 먼저 고친다.
- **조판 컷 패턴은 초안이다.** `pipeline/extract-standards.mjs`의 `SECTION_CUT_PATTERNS`는 2022 개정 교과 교육과정 공통 조판을 본뜬 것 — 실측에서 꼬리가 섞이면 패턴을 보강하고 `tests/fixtures/sample-pdftotext.mjs`에 실제 발췌를 추가한다.
- 영역명은 코드의 영역 번호와 같은 번호의 `(N) 영역명` 머리글을 앞쪽에서 찾아 붙인다.
- 일상생활 활동은 학교가 영역·내용을 정하므로 국가 수준 성취기준이 없다 — 수록 대상이 아니다.
- 성취기준 key는 `${category}:${code}` (예: `basic:[4국01-01]`). v0.2에서 공통 교육과정과 코드가 겹쳐도 key는 충돌하지 않는다.
- 근거 고시는 두 겹이다: 교육부 고시 제2022-34호 + 국가교육위원회 고시 제2024-4호(일부개정). 개정이 별책 3을 바꿨는지 확인 전이다(`sources.json`의 `amendments[].status`).

## 로드맵

- v0.1: 기본 교육과정 (category `basic`)
- v0.2 후보: 특수교육 전문 교과 직업·생활·이료 (【별책 2】, category `special-vocational`·`ilyo`) — 데이터 폴더 추가만으로 로더는 그대로
- v0.3 후보: 기본 ↔ 공통 교육과정 성취기준 연계 (통합학급·개별화교육계획용, korean-secondary-learning-map-mcp와 교차)

## 배포 절차

1. 버전 bump — **파일 4개, 값 6곳**: `package.json`, `package-lock.json`(최상위 `version` + `packages[""].version`), `server.json`(서버·packages), `src/server.mjs`의 `SERVER_INFO.version`.
2. `npm test && npm run pipeline:verify`
3. `npm publish --browser=false` (2FA)
4. `mcp-publisher publish`

## 관련 저장소

- 보통교과·특목 계열: https://github.com/raphysicst-create/korean-secondary-learning-map-mcp
- 특성화고 전문교과: https://github.com/raphysicst-create/korean-vocational-learning-map-mcp
