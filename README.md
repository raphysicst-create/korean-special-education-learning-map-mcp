# korean-special-education-learning-map-mcp

한국 2022 개정 특수교육 교육과정 성취기준 MCP 서버.
기본 교육과정 교과 성취기준을 공식 고시 원문 그대로 패키지에 내장하고, 과목·학년군·영역 축으로 탐색합니다. stdio로 완전 로컬 동작, 도구 5종.

> **개발 중 (v0.0.1)** — 코드·파이프라인만 공개된 상태이며 수록 데이터는 v0.1.0에서 포함됩니다.

## 설치

```json
{ "mcpServers": { "korean-special-education-learning-map": {
  "command": "npx", "args": ["-y", "korean-special-education-learning-map-mcp"] } } }
```

## 수록 범위 (v0.1 목표)

- 교육부 고시 제2022-34호 【별책 3】 기본 교육과정의 교과 성취기준 전량 (5개 학년군: 초1~2·3~4·5~6, 중1~3, 고1~3)
- 일상생활 활동은 학교가 영역·내용을 정하도록 되어 있어 국가 수준 성취기준이 없으므로 수록 대상이 아닙니다.
- 특수교육 전문 교과(직업·생활, 이료), 공통·선택 중심 교육과정은 이후 버전에서 다룹니다.
- 보통교과는 [korean-secondary-learning-map-mcp](https://github.com/raphysicst-create/korean-secondary-learning-map-mcp), 특성화고 전문교과는 [korean-vocational-learning-map-mcp](https://github.com/raphysicst-create/korean-vocational-learning-map-mcp).

## 도구 5종

| 도구 | 용도 |
|---|---|
| `list_subjects` | 수록 과목과 과목별 학년군·성취기준 수 |
| `get_grade_band_overview` | 학년군별 과목·영역 개요 (개별화교육계획 범위 잡기) |
| `search_standards` | 코드·원문 키워드 + 과목·학년군·영역 필터 검색 |
| `get_standard` | 코드로 공식 원문·과목·학년군·영역 조회 |
| `get_learning_roadmap` | 과목의 학년군 → 영역 → 성취기준 계층 |

학년군은 `초3~4`, `중학교`, `고1~3`, `e3-4` 등 여러 표기를 받습니다.

## 데이터 특성 고지

- 성취기준 코드·영역명·과목 배정은 고시 PDF 조판에서 기계 추출한 뒤 전수 검증·표본 검수를 거칩니다. 인용 시 고시 PDF와 대조하세요.
- 교육부·국가교육위원회·국립특수교육원의 공식 산출물이 아니며, 개별 학생을 진단하거나 개별화교육계획을 대신하지 않습니다.

## 라이선스·출처

MIT(코드·문서). 성취기준 원문은 고시의 별책으로서 저작권법 제7조 제2호에 따라 보호받지 않는 저작물이며, 정확성·추적성을 위해 출처를 표기합니다. 상세는 [RIGHTS.md](RIGHTS.md)·[NOTICE.md](NOTICE.md).
