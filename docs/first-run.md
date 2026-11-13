# 첫 실행 런북 (선생님 PC에서 AI 에이전트가 수행)

이 문서는 Claude Code 등 에이전트에게 그대로 넘겨 실행시키는 용도다. 각 단계 끝의 **확인** 항목에서 멈추고 사람에게 보고한다.

## 0. 준비

- Node 20.11 이상, `pdftotext`(poppler) 설치 확인: `pdftotext -v`
  - Windows: `winget install oschwartz10612.Poppler` 또는 scoop `poppler`. PATH 등록 확인.
- `npm ci`, `npm test` 통과 확인.

## 1. 개정 고시 확인 (사람 판단)

국가교육위원회 고시 제2024-4호(2024.8.16.) 「특수교육 교육과정」 일부개정이 【별책 3】 기본 교육과정 성취기준을 바꿨는지 확인한다.

- NCIC(ncic.re.kr) 교육과정 자료실에서 제2024-4호 고시문과 별책 목록을 확인.
- 별책 3이 개정됐다면: 개정 반영본 PDF URL로 `pipeline/sources.json`의 `annexes[0].url`·`notice`를 교체.
- 결과를 `amendments[0].status`에 `"verified"`로, `note`에 확인 내용(날짜·근거)을 적는다.

**확인:** 어느 판본을 쓰는지 사람에게 보고하고 승인받는다.

## 2. PDF 확보·해시 고정

```
npm run pipeline:fetch -- --pin
```

- 저장소 부모 폴더(또는 `PDF_DIR`)에 `[별책3]`이 들어간 PDF가 있으면 그것을, 없으면 URL에서 받는다.
- 받은 파일이 HWP이거나 PDF가 아니면 실패한다 → 브라우저로 PDF를 받아 `[별책3] 기본 교육과정.pdf` 이름으로 둔다.

**확인:** 고정된 SHA-256과 파일명을 보고. `RIGHTS.md` 표의 해시 칸도 같은 값으로 채운다.

## 3. 실측(discover)

```
npm run pipeline:discover
```

`.cache/discovery-moe-2022-34-annex3.json`을 읽고 보고한다.

- `prefixes`: 코드 접두어별 수량·학년군 코드·표본 원문
- `unknownBandCodes`: 비어 있어야 한다. 아니면 `src/normalize.mjs`의 `GRADE_BANDS`를 실측에 맞게 고친다(테스트도 갱신).
- `duplicateCodes`·`missingDomain`·`suspicious`: 조판 패턴 문제 신호. 표본을 PDF와 대조해 `SECTION_CUT_PATTERNS`·`DOMAIN_HEADING`을 보강한다. 보강할 때마다 실제 발췌를 `tests/fixtures/sample-pdftotext.mjs`에 추가한다.

**확인:** 접두어 목록을 PDF 목차와 대조한 표(접두어 → 과목명)를 사람에게 보여 주고 승인받는다.

## 4. 과목 대응표 작성

`pipeline/subjects.json`의 `mappings`를 채운다. 예:

```json
"mappings": {
  "국": { "id": "korean", "subjectKorean": "국어" },
  "진": { "id": "career-vocation", "subjectKorean": "진로와 직업" }
}
```

과목명은 고시 표기 그대로(띄어쓰기 포함). id는 영어 kebab-case.

## 5. 추출·게이트 기록·검증

```
npm run pipeline:extract -- --record-gates
npm run pipeline:verify
```

- extract의 미해결 목록은 `pipeline/exceptions.json`에 수동 보정한다. 키는 `basic:[코드]` 또는 `[코드]`, 값은 원문 문자열 또는 `{ "text": "...", "domainKorean": "..." }`. 원문은 PDF에서 그대로 옮긴다.
- verify의 "원문 종결 이상(절단 의심)"은 대개 컷 패턴이 본문을 잘랐다는 뜻이다. 패턴을 고치는 것이 우선이고, 예외 보정은 마지막 수단.

**확인:** 과목별 성취기준 수(`pipeline/gates.json`의 `bySubject`)를 보고한다. 알려진 값과 대조한다 — 예: 2022 개정 기본 교육과정 수학과 성취기준은 5개 학년군 총 182개로 보고된 연구가 있다(학습자중심교과교육연구, Bloom 신교육목표분류학 분석). 차이가 나면 원인을 찾는다.

## 6. 표본 검수

과목마다 3건씩 무작위로 골라 `get_standard` 결과를 PDF 원문과 글자 단위로 대조한다. 영역명도 확인한다. 결과를 표로 보고한다.

## 7. 출시 준비

- `package.json` 등 버전을 0.1.0으로 (CLAUDE.md 배포 절차의 6곳).
- README의 수량을 실측치로 갱신, CHANGELOG 작성.
- `npm test && npm run pipeline:verify`, `npm pack --dry-run`으로 크기 확인.
- 게시(npm·레지스트리)는 사람이 직접 한다.
