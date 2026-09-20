import type { Confidence } from './enums';

/**
 * 参照物换算器。
 *
 * 输入一句口语用量（"半勺""一小把虾皮""两勺"），按家庭空间里**已登记的餐具**
 * （KitchenReference，例如"外婆家的白瓷汤勺 = 一平勺 8g"）折算成克数，
 * 并给出一个容错区间。
 *
 * 设计原则与规则库（rules.ts）保持一致：
 * - 换算结果永远是 estimated/assumed，绝不直接给 confirmed —— 下结论的是人；
 * - 匹配不到已登记的勺/碗时，宁可不换算并提示去登记，也不瞎猜（茶匙/汤匙除外，
 *   这两种有国标量级 5ml/15ml，按暂定处理并显式标注）；
 * - "一把/一撮"是手不是餐具，给经验估值并给最宽的容错。
 */

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export type MeasureKind = 'spoon' | 'bowl' | 'cup' | 'plate' | 'pot' | 'handful' | 'pinch';
export type MeasureSubKind = 'plain' | 'teaspoon' | 'tablespoon';
export type MeasureFill = 'flat' | 'heaped';
export type MeasureSize = 'small' | 'large';

/** 换算时需要的参照物字段（KitchenReferenceDto 结构兼容，可直接传入） */
export interface ConvertReference {
  id: string;
  label: string;
  amountValue: number;
  amountUnit: string;
  note?: string | null;
}

/** 从一句话里解析出的一个用量短语，例如"半勺""一小把" */
export interface ParsedMeasure {
  /** 在原文中的起始位置，便于高亮 */
  index: number;
  /** 命中的原文片段 */
  text: string;
  /** 份数：半勺=0.5，两勺=2，小半=1/3，大半=2/3 */
  quantity: number;
  quantityText: string;
  /** 平勺 / 满勺（尖勺按满勺处理）；未注明为 undefined */
  fill?: MeasureFill;
  /** 大 / 小；未注明为 undefined */
  size?: MeasureSize;
  /** 命中的量词原字：勺/匙/碗/杯/把/撮… */
  measure: string;
  kind: MeasureKind;
  subKind: MeasureSubKind;
}

export interface ConvertResult {
  ok: boolean;
  /** 对应的解析短语 */
  matched: ParsedMeasure;
  /** 折算后的中心克数；ok=false 时为空 */
  grams?: number;
  minGrams?: number;
  maxGrams?: number;
  unit: 'g';
  /** reference：来自已登记餐具；builtin：通用经验值；none：换算不了 */
  source: 'reference' | 'builtin' | 'none';
  confidence: Confidence;
  /** 实际采用的参照物 */
  reference?: ConvertReference;
  /** 同分/可用的其它参照物，供界面切换 */
  candidates?: ConvertReference[];
  /** 参照物单位是 ml 时按 1ml≈1g 估算，需要提示密度误差 */
  volumeAssumed?: boolean;
  /** 人能读懂的折算过程，例如"半勺 = 8g × 0.5 = 4g" */
  explanation: string;
  /** ok=false 或需要注意时给的操作提示 */
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* 解析口语用量                                                        */
/* ------------------------------------------------------------------ */

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 解析"两 / 二十 / 三 / 2.5 / 半 / 小半 / 大半"，认不出来返回 null */
export function parseQuantity(raw: string): number | null {
  if (raw === '半') return 0.5;
  if (raw === '小半') return 1 / 3;
  if (raw === '大半') return 2 / 3;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

  if (raw.includes('十')) {
    const tensPart = raw.slice(0, raw.indexOf('十'));
    const onesPart = raw.slice(raw.indexOf('十') + 1);
    const tens = tensPart === '' ? 1 : CN_DIGITS[tensPart];
    const ones = onesPart === '' ? 0 : CN_DIGITS[onesPart];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }

  if (raw.length === 1) return CN_DIGITS[raw] ?? null;
  return null;
}

/**
 * 量词表。顺序很重要：长词必须排在"勺/杯/碗"等单字前面，
 * 否则"汤匙"会先被"匙"之类截断。
 */
const MEASURE_WORDS = [
  '汤匙',
  '茶匙',
  '汤勺',
  '调羹',
  '饭碗',
  '茶杯',
  '杯子',
  '勺',
  '匙',
  '碗',
  '杯',
  '盆',
  '盘',
  '碟',
  '锅',
  '把',
  '撮',
  '捏',
] as const;

const QTY_PATTERN = '(大半|小半|半|[一二两三四五六七八九零〇十]{1,3}|\\d+(?:\\.\\d+)?)';
const MEASURE_PATTERN = `(${MEASURE_WORDS.join('|')})`;

const MEASURE_RE = new RegExp(
  `${QTY_PATTERN}\\s*(平|满|尖)?\\s*(大|小)?\\s*${MEASURE_PATTERN}`,
  'g',
);

function classifyMeasure(measure: string): { kind: MeasureKind; subKind: MeasureSubKind } {
  if (measure === '把') return { kind: 'handful', subKind: 'plain' };
  if (measure === '撮' || measure === '捏') return { kind: 'pinch', subKind: 'plain' };
  if (measure === '茶匙') return { kind: 'spoon', subKind: 'teaspoon' };
  if (measure === '汤匙' || measure === '汤勺' || measure === '调羹')
    return { kind: 'spoon', subKind: 'tablespoon' };
  if (measure === '勺' || measure === '匙') return { kind: 'spoon', subKind: 'plain' };
  if (measure === '碗' || measure === '盆' || measure === '饭碗')
    return { kind: 'bowl', subKind: 'plain' };
  if (measure === '杯' || measure === '茶杯' || measure === '杯子')
    return { kind: 'cup', subKind: 'plain' };
  if (measure === '锅') return { kind: 'pot', subKind: 'plain' };
  return { kind: 'plate', subKind: 'plain' };
}

/**
 * 从一句话（或直接一个短语）里找出全部用量短语。
 * 例如 "半勺糖，再来一小把虾皮" → ["半勺", "一小把"]。
 */
export function parseMeasurePhrases(text: string): ParsedMeasure[] {
  const source = text ?? '';
  const results: ParsedMeasure[] = [];
  MEASURE_RE.lastIndex = 0;

  for (const match of source.matchAll(MEASURE_RE)) {
    const quantityText = match[1]!;
    const fillText = match[2] as string | undefined;
    const sizeText = match[3] as string | undefined;
    const measure = match[4]!;
    const quantity = parseQuantity(quantityText);
    if (quantity === null || quantity <= 0) continue;

    const { kind, subKind } = classifyMeasure(measure);
    results.push({
      index: match.index ?? 0,
      text: match[0],
      quantity,
      quantityText,
      fill: fillText === '平' ? 'flat' : fillText ? 'heaped' : undefined,
      size: sizeText === '大' ? 'large' : sizeText === '小' ? 'small' : undefined,
      measure,
      kind,
      subKind,
    });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* 参照物匹配                                                          */
/* ------------------------------------------------------------------ */

const SPOON_KEYWORD = /[勺匙]/;
const TEASPOON_KEYWORD = /(茶匙|咖啡勺|咖啡匙)/;
const TABLESPOON_KEYWORD = /(汤匙|汤勺|调羹)/;

/** 给参照物按"像不像这句话里说的餐具"打分，低于 10 分视为不匹配 */
function scoreReference(phrase: ParsedMeasure, ref: ConvertReference): number {
  const haystack = `${ref.label} ${ref.note ?? ''}`;
  let score = 0;

  switch (phrase.kind) {
    case 'spoon':
      if (SPOON_KEYWORD.test(haystack)) score += 10;
      if (phrase.subKind === 'teaspoon') {
        if (TEASPOON_KEYWORD.test(haystack)) score += 4;
        // 茶匙很小：把标着"汤勺/汤匙"的大勺子压到阈值之下，
        // 让它落到 5ml 的通用量级，而不是拿 8g 的汤勺充茶匙。
        if (TABLESPOON_KEYWORD.test(haystack)) score -= 8;
      }
      if (phrase.subKind === 'tablespoon') {
        if (TABLESPOON_KEYWORD.test(haystack)) score += 4;
        if (TEASPOON_KEYWORD.test(haystack)) score -= 8;
      }
      break;
    case 'bowl':
      // 必须命中短语里那个具体的量字："盆"不能算"碗"
      if (haystack.includes(phrase.measure)) score += 10;
      else if (phrase.measure === '饭碗' && /碗/.test(haystack)) score += 10;
      break;
    case 'cup':
      if (haystack.includes(phrase.measure) || (phrase.measure !== '茶杯' && haystack.includes('杯'))) {
        score += 10;
      }
      break;
    default:
      return 0;
  }

  if (phrase.size === 'small' && haystack.includes('小')) score += 3;
  if (phrase.size === 'large' && haystack.includes('大')) score += 3;
  if (phrase.fill === 'flat' && haystack.includes('平')) score += 1;
  if (phrase.fill === 'heaped' && haystack.includes('满')) score += 1;

  return score;
}

export function matchReferences(
  phrase: ParsedMeasure,
  references: ConvertReference[],
): ConvertReference[] {
  // 保持入参（通常是登记先后）顺序稳定：分数相同时不依赖 localeCompare ——
  // 它在精简版 ICU 的运行时里会退化成按码点排，不同机器结果不一样。
  const ranked: { ref: ConvertReference; score: number; order: number }[] = [];
  references.forEach((ref, order) => {
    const score = scoreReference(phrase, ref);
    if (score >= 10) ranked.push({ ref, score, order });
  });
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.map((candidate) => candidate.ref);
}

/* ------------------------------------------------------------------ */
/* 折算 + 容错区间                                                     */
/* ------------------------------------------------------------------ */

/** 手抓量词的经验克重（无餐具可参照） */
const HAND_GRAMS: Record<MeasureKind, { normal: number; small: number; large: number }> = {
  handful: { normal: 15, small: 10, large: 20 },
  pinch: { normal: 2, small: 1, large: 3 },
  spoon: { normal: 0, small: 0, large: 0 },
  bowl: { normal: 0, small: 0, large: 0 },
  cup: { normal: 0, small: 0, large: 0 },
  plate: { normal: 0, small: 0, large: 0 },
  pot: { normal: 0, small: 0, large: 0 },
};

/** 未登记餐具时，茶匙/汤匙的通用量级（ml，按 1ml≈1g） */
const BUILTIN_SPOON_ML: Record<MeasureSubKind, number> = {
  plain: 0,
  teaspoon: 5,
  tablespoon: 15,
};

const TOLERANCE = {
  referenceBase: 0.12,
  fractionalQty: 0.08,
  unspecifiedFill: 0.1,
  heapedDefault: 0.12,
  heapedFromNote: 0.03,
  sizeAdjusted: 0.05,
  volumeDensity: 0.1,
  handful: 0.35,
  pinch: 0.4,
  builtinSpoon: 0.25,
  min: 0.15,
  max: 0.5,
} as const;

/** 从参照物备注里找"满勺约 12g"这类记录，推算满勺相对平勺的倍率 */
function heapedFactorFromNote(ref: ConvertReference): number | null {
  const note = ref.note ?? '';
  const matched = note.match(/满(?:勺|匙|碗|杯)?[^0-9零一二两三四五六七八九]{0,4}([\d]+(?:\.\d+)?)\s*(g|克|ml|毫升)/);
  if (!matched) return null;
  const full = Number(matched[1]);
  if (!Number.isFinite(full) || full <= 0 || ref.amountValue <= 0) return null;
  const factor = full / ref.amountValue;
  return factor > 1 ? factor : null;
}

function normalizeUnit(unit: string): 'g' | 'ml' | null {
  const trimmed = unit.trim().toLowerCase();
  if (['g', '克'].includes(trimmed)) return 'g';
  if (['ml', '毫升', 'cc'].includes(trimmed)) return 'ml';
  return null;
}

/** 克重保留 1 位小数，整数不带 .0 */
function roundGrams(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? Math.round(rounded) : rounded;
}

function applyTolerance(grams: number, ratio: number): { min: number; max: number } {
  const factor = Math.max(TOLERANCE.min, Math.min(TOLERANCE.max, ratio));
  return {
    min: roundGrams(Math.max(0, grams * (1 - factor))),
    max: roundGrams(grams * (1 + factor)),
  };
}

function sizeLabel(size?: MeasureSize): string {
  return size === 'small' ? '小' : size === 'large' ? '大' : '';
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把一个解析出的用量短语折算成克数。
 *
 * @param preferredReferenceId 多个参照物都匹配时，界面可指定用哪一个
 */
export function convertMeasure(
  phrase: ParsedMeasure,
  references: ConvertReference[],
  preferredReferenceId?: string,
): ConvertResult {
  /* ---------- 一把 / 一撮：手不是餐具，走经验估值 ---------- */
  if (phrase.kind === 'handful' || phrase.kind === 'pinch') {
    const table = HAND_GRAMS[phrase.kind];
    const base = phrase.size === 'small' ? table.small : phrase.size === 'large' ? table.large : table.normal;
    const grams = roundGrams(base * phrase.quantity);
    const ratio = phrase.kind === 'handful' ? TOLERANCE.handful : TOLERANCE.pinch;
    const range = applyTolerance(grams, ratio);

    return {
      ok: true,
      matched: phrase,
      grams,
      minGrams: range.min,
      maxGrams: range.max,
      unit: 'g',
      source: 'builtin',
      confidence: phrase.kind === 'handful' ? 'estimated' : 'assumed',
      explanation: `经验估值：${sizeLabel(phrase.size)}${phrase.measure}约 ${base}g × ${formatQty(phrase.quantity)} = ${grams}g（手抓轻重差异大，区间放宽）`,
      hint: '估值随食材密度变化很大（菜叶 vs. 坚果），重要用量建议称重或改用餐具参照物。',
    };
  }

  /* ---------- 勺 / 碗 / 杯：优先匹配已登记餐具 ---------- */
  const candidates = matchReferences(phrase, references);
  const ref =
    candidates.find((candidate) => candidate.id === preferredReferenceId) ?? candidates[0];

  if (!ref) {
    // 茶匙 / 汤匙有国标量级，没登记也能给个暂定参考
    const builtinMl = BUILTIN_SPOON_ML[phrase.subKind];
    if (phrase.kind === 'spoon' && builtinMl > 0) {
      const grams = roundGrams(builtinMl * phrase.quantity);
      const range = applyTolerance(grams, TOLERANCE.builtinSpoon);
      const name = phrase.subKind === 'teaspoon' ? '一茶匙' : '一汤匙';
      return {
        ok: true,
        matched: phrase,
        grams,
        minGrams: range.min,
        maxGrams: range.max,
        unit: 'g',
        source: 'builtin',
        confidence: 'assumed',
        volumeAssumed: true,
        explanation: `通用量级：${name} ≈ ${builtinMl}ml，按 1ml≈1g × ${formatQty(phrase.quantity)} ≈ ${grams}g（家里没有登记过这种勺）`,
        hint: '这是通用规格的暂定估值。把家常⽤的那只勺拿到「成员与参照物」里登记一次，以后就能按家里的实际大小换算。',
      };
    }

    return {
      ok: false,
      matched: phrase,
      unit: 'g',
      source: 'none',
      confidence: 'assumed',
      explanation: `「${phrase.text}」换算不了：这个家庭空间还没有登记对应的${measureKindLabel(phrase.kind)}。`,
      hint: `先到「成员与参照物」登记"家里那只${phrase.measure}等于多少克/毫升"，再回来换算 —— 碗、杯各家大小差一倍以上，不能凭空猜。`,
    };
  }

  const unit = normalizeUnit(ref.amountUnit);
  if (!unit) {
    return {
      ok: false,
      matched: phrase,
      unit: 'g',
      source: 'none',
      confidence: 'assumed',
      reference: ref,
      candidates,
      explanation: `参照物「${ref.label}」登记的单位是 ${ref.amountUnit}，无法折算成克。`,
      hint: '请把参照物改成 g（克）或 ml（毫升）后再换算。',
    };
  }

  /* ---------- 计算折算系数 ---------- */
  // 参照物名字里已经带"大/小"时，认为登记值本身就是大号/小号的量，不再二次缩放
  const refImpliesSize = /[大小]/.test(ref.label);
  const sizeFactor = !refImpliesSize
    ? phrase.size === 'large'
      ? 1.2
      : phrase.size === 'small'
        ? 0.8
        : 1
    : 1;

  let fillFactor = 1;
  let heapedFromNote = false;
  if (phrase.fill === 'heaped') {
    const noted = heapedFactorFromNote(ref);
    if (noted) {
      fillFactor = noted;
      heapedFromNote = true;
    } else {
      fillFactor = 1.3;
    }
  }

  const grams = roundGrams(ref.amountValue * phrase.quantity * sizeFactor * fillFactor);

  /* ---------- 容错区间：把每一层"靠眼睛"的不确定性累加 ---------- */
  let ratio = TOLERANCE.referenceBase;
  if (!Number.isInteger(phrase.quantity)) ratio += TOLERANCE.fractionalQty;
  if (!phrase.fill) ratio += TOLERANCE.unspecifiedFill;
  if (phrase.fill === 'heaped') ratio += heapedFromNote ? TOLERANCE.heapedFromNote : TOLERANCE.heapedDefault;
  if (sizeFactor !== 1) ratio += TOLERANCE.sizeAdjusted;
  const volumeAssumed = unit === 'ml';
  if (volumeAssumed) ratio += TOLERANCE.volumeDensity;

  const range = applyTolerance(grams, ratio);

  const parts: string[] = [];
  parts.push(`${ref.label} 一${phrase.measure}登记为 ${ref.amountValue}${unit}${ref.note ? '（' + ref.note + '）' : ''}`);
  const factors: string[] = [formatQty(phrase.quantity)];
  if (sizeFactor !== 1) factors.push(`大小×${sizeFactor}`);
  if (fillFactor !== 1) factors.push(`${heapedFromNote ? '满勺（按备注实测）' : '满勺（经验）'}×${roundGrams(fillFactor)}`);
  parts.push(`${phrase.text} = ${ref.amountValue}${unit} × ${factors.join(' × ')} ≈ ${grams}g`);
  if (volumeAssumed) parts.push('液体按 1ml≈1g（水/酱油/醋接近，油、酒偏轻）');

  return {
    ok: true,
    matched: phrase,
    grams,
    minGrams: range.min,
    maxGrams: range.max,
    unit: 'g',
    source: 'reference',
    confidence: 'estimated',
    reference: ref,
    candidates: candidates.length > 1 ? candidates : undefined,
    volumeAssumed,
    explanation: parts.join('；'),
  };
}

/** 一句话里有几个用量短语就换算几个，顺序与原文一致 */
export function convertText(
  text: string,
  references: ConvertReference[],
  preferredReferenceId?: string,
): ConvertResult[] {
  return parseMeasurePhrases(text).map((phrase) =>
    convertMeasure(phrase, references, preferredReferenceId),
  );
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                            */
/* ------------------------------------------------------------------ */

function formatQty(quantity: number): string {
  if (quantity === 0.5) return '0.5（半）';
  if (Math.abs(quantity - 1 / 3) < 0.01) return '1/3（小半）';
  if (Math.abs(quantity - 2 / 3) < 0.01) return '2/3（大半）';
  return String(roundGrams(quantity));
}

function measureKindLabel(kind: MeasureKind): string {
  switch (kind) {
    case 'spoon':
      return '勺';
    case 'bowl':
      return '碗/盆';
    case 'cup':
      return '杯';
    case 'plate':
      return '盘/碟';
    case 'pot':
      return '锅';
    default:
      return '餐具';
  }
}

export const CONVERT_EXAMPLES = ['半勺', '一平勺', '小半勺', '两勺', '一小把虾皮', '一撮盐', '一汤匙生抽'];
