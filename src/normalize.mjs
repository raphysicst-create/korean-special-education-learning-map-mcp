const ROMAN = {
  'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI',
  'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X', 'Ⅺ': 'XI', 'Ⅻ': 'XII',
  'ⅰ': 'I', 'ⅱ': 'II', 'ⅲ': 'III', 'ⅳ': 'IV', 'ⅴ': 'V', 'ⅵ': 'VI',
  'ⅶ': 'VII', 'ⅷ': 'VIII', 'ⅸ': 'IX', 'ⅹ': 'X', 'ⅺ': 'XI', 'ⅻ': 'XII',
};

export function normalizeRoman(value) {
  return String(value ?? '').replace(/[Ⅰ-Ⅻⅰ-ⅻ]/g, (ch) => ROMAN[ch] ?? ch);
}

// 대시 이형(U+2010·2011·2013·2014·2212)은 하이픈으로 통일한다 — PDF 조판에서 섞여 나온다.
const DASHES = /[‐‑–—−]/g;

export function normalizeCode(code) {
  return displayCode(normalizeRoman(String(code ?? '')));
}

/**
 * 저장·표시용 코드 표기: 공백·대시 이형만 정리하고 로마 숫자는 원문대로 둔다
 * (전문 교과 '[12작업Ⅰ01-01]'). 조회·비교는 normalizeCode·canonicalCode로 한다.
 */
export function displayCode(code) {
  const compact = String(code ?? '').normalize('NFC')
    .replace(DASHES, '-')
    .replace(/\s+/g, '');
  if (!compact) return compact;
  return compact.startsWith('[') ? compact : `[${compact}]`;
}

/**
 * 같은 성취기준 코드를 가리키는 표기를 하나로 모은다. 학년군 숫자의 앞자리 0을 뗀다 —
 * 고시 원문이 중학교 일부 코드를 '[09수학04-01]'·'[09생영01-01]'로 적었으므로
 * '[9수학04-01]'로 찾아도 맞아야 한다. 저장·표시는 원문 표기 그대로 둔다.
 */
export function canonicalCode(code) {
  const normalized = normalizeCode(code);
  return normalized.replace(/^\[0+(\d)/, '[$1');
}

export function normalizeText(value) {
  return normalizeRoman(String(value ?? '').normalize('NFC'))
    .replace(/[・･⋅∙ㆍ]/g, '·')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// 학년군 코드(성취기준 코드 첫 숫자) → 학년군. 특수교육 기본 교육과정은
// 초1~2·3~4·5~6, 중1~3, 고1~3의 5개 학년군으로 편성된다.
// 코드 숫자와 학년군의 대응은 일반 교육과정 관례(2·4·6·9·12)를 따르며 별책 3 실측
// (국가교육위원회 고시 제2026-2호 반영본)으로 확인했다. 고시 원문은 중학교 수학 규칙성 영역과
// 생활영어 중학교 코드를 '09'로 적으므로 aliases로 받는다.
export const GRADE_BANDS = [
  { id: 'e1-2', code: '2', labelKorean: '초등학교 1~2학년군', short: '초1~2', order: 1 },
  { id: 'e3-4', code: '4', labelKorean: '초등학교 3~4학년군', short: '초3~4', order: 2 },
  { id: 'e5-6', code: '6', labelKorean: '초등학교 5~6학년군', short: '초5~6', order: 3 },
  { id: 'm1-3', code: '9', aliases: ['09'], labelKorean: '중학교 1~3학년군', short: '중1~3', order: 4 },
  { id: 'h1-3', code: '12', labelKorean: '고등학교 1~3학년군', short: '고1~3', order: 5 },
];
const BAND_BY_CODE = new Map(
  GRADE_BANDS.flatMap((b) => [b.code, ...(b.aliases ?? [])].map((c) => [c, b]))
);

// 성취기준 코드 패턴: [4국01-01] 형태(학년군 숫자 + 과목 약칭 + 영역 NN + 순번 NN).
// 약칭은 한글 1~4자가 대부분이고, 전문 교과 '기초작업기술Ⅰ·Ⅱ'는 로마 숫자가 붙는다
// ('[12작업Ⅰ01-01]' — 로마 숫자는 원문 그대로, ASCII 'I'로 적어도 받는다). 공백·대시 이형 허용.
export const CODE_SOURCE =
  '\\[\\s*(\\d{1,2})\\s*([가-힣A-Za-zⅠ-Ⅻ]{1,8})\\s*(\\d{2})\\s*[-‐‑–—−]\\s*(\\d{2})\\s*\\]';

export function parseBasicCode(code) {
  const m = new RegExp(`^${CODE_SOURCE}$`).exec(normalizeCode(code));
  if (!m) return null;
  const [, bandCode, prefix, domainNo, itemNo] = m;
  const band = BAND_BY_CODE.get(bandCode) ?? null;
  return {
    gradeBandCode: bandCode,
    gradeBand: band?.id ?? null,
    gradeBandKorean: band?.labelKorean ?? null,
    prefix,
    domainNo,
    itemNo,
  };
}

export function gradeBandByCode(bandCode) {
  return BAND_BY_CODE.get(String(bandCode)) ?? null;
}

/**
 * 사용자 입력 학년군을 id로 푼다. 'e3-4', '초3~4', '초등학교 3~4학년군', '3~4', '4'(코드 숫자),
 * '중학교', '고등', '중1~3' 등을 받는다. 못 풀면 null.
 */
export function resolveGradeBand(input) {
  if (input === undefined || input === null || input === '') return null;
  const raw = String(input).normalize('NFC').trim();
  const squash = raw.replace(/\s+/g, '').replace(/[-–—~∼〜]/g, '~');
  for (const band of GRADE_BANDS) {
    if (raw.toLowerCase() === band.id || squash === band.short || squash === band.labelKorean.replace(/\s+/g, '')) {
      return band.id;
    }
  }
  if (BAND_BY_CODE.has(squash)) return BAND_BY_CODE.get(squash).id;
  if (/^중/.test(squash)) return 'm1-3';
  if (/^고/.test(squash)) return 'h1-3';
  const m = /(\d)~(\d)/.exec(squash);
  if (m) {
    const key = `${m[1]}~${m[2]}`;
    const hit = { '1~2': 'e1-2', '3~4': 'e3-4', '5~6': 'e5-6' }[key];
    if (hit) return hit;
  }
  return null;
}
