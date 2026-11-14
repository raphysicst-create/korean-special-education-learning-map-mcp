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

## 첫 실행 기록 (2026-11-14, v0.1.0)

- **0단계:** Node 26.13.1, poppler 25.07.0(winget `oschwartz10612.Poppler`)으로 진행했다. Git Bash에서는 Git에 딸린 xpdf `pdftotext`가 먼저 잡히므로 poppler `Library/bin`을 PATH 앞에 두고 실행했다.
- **1단계 판본:**
  - 제2024-4호는 별책 3을 다시 고시했지만 성취기준은 바꾸지 않았다. NCIC 2024.08 판과 2022 원본의 추출 결과 687건(공백 누락 코드 보강 후 688건)이 같았다.
  - 제2026-2호(2026.1.21.)는 초1~2 통합교과를 개편했다.
  - 수록본은 NCIC의 2026-2호 반영본 별책 3 PDF로 정했다. 근거는 `pipeline/sources.json`의 `amendments[]`에 있다.
  - 2026-2호의 초1~2 시행일은 2028.3.1.이다. 그래서 건강한 생활·즐거운 생활에 시행 시기 note를 붙였다.
- **2단계:** SHA-256 `7e1dc0612fa4fa8e4050c2d015e373539a23d5c4691abad7ddd14996e5e2f1e5`, 6,925,426바이트.
- **3단계:**
  - 접두어 16종, 성취기준 691건을 얻었다.
  - 미지 학년군 '09'는 `GRADE_BANDS` aliases로 처리했다.
  - 내용 체계 표 속 코드는 들여쓰기로 제외했다.
  - 통합교과의 해설 머리 반복 12종은 원문이 같아 무해하다.
  - 영역 미확인 33건은 정확히 통합교과 4과목(바생·슬생·건생·즐생)이다. 이 과목들은 영역 머리글이 없으므로 대응표의 `domainKorean`으로 채웠다.
  - 버려진 코드와 순번 결번은 각각 0건이다.
- **5단계:**
  - 과목별 수는 `pipeline/gates.json`에 기록했다.
  - 수학은 148건이다. PDF 전체에 나오는 고유 수학 코드도 148개다. 런북의 '182개' 연구 수치는 이 PDF의 코드 수와 다르며, 셈법이 다른 것으로 보인다.
  - 예외 보정(`exceptions.json`)은 0건이다.
- **6단계:**
  - 원문 691건 전량을 poppler -raw와 xpdf -layout 출력에 글자 단위로 대조해 모두 일치했다.
  - 과목마다 3건, 모두 48건을 무작위로 뽑아 `get_standard` 결과를 PDF 지면 이미지와 대조했고 모두 일치했다.
