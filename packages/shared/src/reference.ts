/**
 * 参照物换算器。
 *
 * 输入一句口语用量（"半勺""一小把""两大勺"），结合本空间已登记的餐具参照物，
 * 按参照物登记时的量化值（如"一平勺 = 8g"）折算成数值，并给出容错区间。
 *
 * 容错率不是拍脑袋：
 * - 勺/碗/杯这类餐具有"平勺/满勺"的刻度语义，默认 ±15%；
 * - "把/捏/撮"是纯手感，人和人差别最大，默认 ±30%~35%；
 * - "小/大"的修饰本身带不确定性，再叠加 ±5%；
 * - 舀不满一勺（半勺子）目测误差更大，再叠加 ±5%；堆尖同样 +5%。
 *
 * 客户端与服务端共用这一份实现，换算口径只有一处。
 */

/** 换算所需的参照物字段（KitchenReference 的结构子集） */
export interface ReferenceLike {
  id: string;
  label: string;
  amountValue: number;
  amountUnit: string;
}

export type HeapKind = 'level' | 'heaped';
export type SizeKind = 'small' | 'large';

export interface ParsedQuantity {
  /** 份数，例如"半勺"是 0.5，"两勺"是 2 */
  count: number;
  /** 平勺 / 满勺（堆尖） */
  heap?: HeapKind;
  /** 小 / 大（"一小把""大勺"） */
  size?: SizeKind;
  /** 命中的量词关键字，例如 勺 / 碗 / 把 */
  vessel: string;
  /** 量词类别：餐具还是手感（决定默认容错率） */
  kind: 'utensil' | 'handful';
  /** 去掉数词/量词/修饰词后，用于在参照物名称里匹配的残词，例如"白瓷""汤" */
  tokens: string[];
  raw: string;
}

export interface ConvertedQuantity {
  ok: true;
  /** 总折算系数（份数 × 平/满 × 小/大把） */
  factor: number;
  /** 折算中间值 */
  value: number;
  /** 容错区间 */
  range: { min: number; max: number };
  /** 实际采用的容错率 */
  tolerance: number;
  /** 输出单位，沿用参照物登记的单位（g/ml…）。不同食材密度不同，不擅自做 ml→g */
  unit: string;
  reference: ReferenceLike;
  parsed: ParsedQuantity;
  /** 可直接放进规格"参照物/依据"里的人话，例如"半勺 ≈ 4g（3.2–4.8g），依据：外婆家的白瓷汤勺 1 平勺 = 8g" */
  basis: string;
}

export type ConvertError =
  | { ok: false; code: 'EMPTY'; message: string }
  | {
      ok: false;
      code: 'NOT_REGISTERED';
      message: string;
      parsed: ParsedQuantity;
    }
  | {
      ok: false;
      code: 'AMBIGUOUS';
      message: string;
      parsed: ParsedQuantity;
      /** 分不清时的候选参照物，交用户选 */
      candidates: ReferenceLike[];
    };

export type ConvertResult = ConvertedQuantity | ConvertError;

const CN_NUMBERS: Record<string, number> = {
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
  十: 10,
  半: 0.5,
};

/** 手感量词（没有餐具，靠手）——容错率显著高于餐具 */
const HANDFUL_WORDS = ['一撮', '一捏', '把', '撮', '捏', '捧', '掐'] as const;
/** 餐具量词，顺序即匹配优先级（先长后短，"汤勺"不会被提前截走） */
const UTENSIL_WORDS = ['汤勺', '勺', '碗', '杯', '盆', '瓶', '罐', '锅', '盘', '碟', '盒'] as const;

const HEAP_WORDS: Array<[string, HeapKind]> = [
  ['冒尖', 'heaped'],
  ['堆尖', 'heaped'],
  ['满', 'heaped'],
  ['尖', 'heaped'],
  ['平', 'level'],
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 解析一句口语用量。识别不出来用量词时返回 null。
 * 故意写成"逐类词抽取"而不是一整条正则：口述语序自由
 *（"半勺""勺来半勺""小半勺"），逐类抽取对语序不敏感。
 */
export function parseQuantityPhrase(rawInput: string): ParsedQuantity | null {
  const raw = rawInput.trim();
  if (!raw) return null;

  let text = raw;

  // 份数：阿拉伯数字（含小数）优先，其次中文数词
  let count: number | null = null;
  const decimal = text.match(/\d+(?:\.\d+)?/);
  if (decimal) {
    count = Number(decimal[0]);
    text = text.replace(decimal[0], '');
  } else {
    for (const [word, value] of Object.entries(CN_NUMBERS)) {
      if (text.includes(word)) {
        count = value;
        text = text.replace(word, '');
        break;
      }
    }
  }
  if (count === null) count = 1; // "满勺""平勺"这类不带数词的，按 1 份

  // 平 / 满
  let heap: HeapKind | undefined;
  for (const [word, kind] of HEAP_WORDS) {
    if (text.includes(word)) {
      heap = kind;
      text = text.replaceAll(word, '');
      break;
    }
  }

  // 小 / 大
  let size: SizeKind | undefined;
  if (text.includes('小')) {
    size = 'small';
    text = text.replaceAll('小', '');
  } else if (text.includes('大')) {
    size = 'large';
    text = text.replaceAll('大', '');
  }

  // 量词：先找手感词，再找餐具词
  let vessel: string | null = null;
  let kind: ParsedQuantity['kind'] | null = null;
  for (const word of HANDFUL_WORDS) {
    if (text.includes(word)) {
      vessel = word.length === 2 && word.startsWith('一') ? word.charAt(1) : word; // "一撮"归一到"撮"
      kind = 'handful';
      text = text.replaceAll(word, '');
      break;
    }
  }
  if (!vessel) {
    for (const word of UTENSIL_WORDS) {
      if (text.includes(word)) {
        vessel = word;
        kind = 'utensil';
        text = text.replaceAll(word, '');
        break;
      }
    }
  }
  if (!vessel || !kind) return null;

  // 剩下的单字都是在参照物名称里找归属用的线索（"白瓷""汤""蓝边"…）
  const tokens = text.replace(/[的来了个用约左右上下大概\s，,。.]/g, '').split('').filter(Boolean);

  return { count, heap, size, vessel, kind, tokens, raw };
}

/** 在本空间已登记参照物中找出与用量词匹配的候选并打分 */
function scoreReferences(
  parsed: ParsedQuantity,
  references: readonly ReferenceLike[],
): Array<{ reference: ReferenceLike; score: number }> {
  const scored: Array<{ reference: ReferenceLike; score: number }> = [];

  for (const reference of references) {
    const label = reference.label;
    if (!label.includes(parsed.vessel)) continue;

    // 命中量词得基础分；残词与大小修饰每命中一个加一分（"白瓷""小"…）
    let score = 1;
    for (const token of parsed.tokens) {
      if (label.includes(token)) score += 1;
    }
    if (parsed.size === 'small') {
      if (label.includes('小')) score += 2;
      if (label.includes('大')) score -= 2; // "小勺"不该选到"大勺"
    } else if (parsed.size === 'large') {
      if (label.includes('大')) score += 2;
      if (label.includes('小')) score -= 2;
    }

    scored.push({ reference, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * 容错率：
 * 手感 30%（捏/撮更粗，35%）；餐具 15%；
 * 大小修饰 +5%；不满一份 +5%；堆尖 +5%。封顶 50%。
 */
export function toleranceFor(parsed: ParsedQuantity): number {
  let tolerance = parsed.kind === 'handful' ? (parsed.vessel === '捏' || parsed.vessel === '撮' ? 0.35 : 0.3) : 0.15;
  if (parsed.size) tolerance += 0.05;
  if (parsed.count < 1) tolerance += 0.05;
  if (parsed.heap === 'heaped') tolerance += 0.05;
  return Math.min(0.5, Math.round(tolerance * 100) / 100);
}

/** 份数之外的折算系数：登记值按"一平勺"量化，故平勺 1.0、满勺 1.5；手感的小/大把折算 */
function extraFactor(parsed: ParsedQuantity): number {
  let factor = 1;
  if (parsed.heap === 'heaped') factor *= 1.5;
  // 大小对餐具是"选哪只勺"的线索（参与参照物匹配），不缩放；
  // 对手里的"把"才是真的缩放（同一把手里的多与少）
  if (parsed.kind === 'handful') {
    if (parsed.size === 'small') factor *= 0.5;
    if (parsed.size === 'large') factor *= 1.5;
  }
  return factor;
}

function describeHeap(parsed: ParsedQuantity): string {
  if (parsed.heap === 'heaped') return '满';
  if (parsed.heap === 'level') return '平';
  return '';
}

/**
 * 把口语用量换算成数值。
 *
 * @param phrase  原口述，例如"半勺""一小把""两大勺"
 * @param references 本空间已登记的参照物（通常是 GET /workspaces/:id/references 的结果）
 * @param options.referenceId 参照物有歧义时，用户显式指定用哪一个
 */
export function convertReferenceQuantity(
  phrase: string,
  references: readonly ReferenceLike[],
  options: { referenceId?: string } = {},
): ConvertResult {
  const parsed = parseQuantityPhrase(phrase);
  if (!parsed) {
    return { ok: false, code: 'EMPTY', message: '没认出用量词，试试"半勺""一小把""两碗"这样的说法' };
  }

  // 用户显式指定参照物（消除歧义）：仍要求它确实对得上这个量词
  if (options.referenceId) {
    const forced = references.find((r) => r.id === options.referenceId);
    if (forced && forced.label.includes(parsed.vessel)) {
      return buildConverted(parsed, forced);
    }
  }

  const scored = scoreReferences(parsed, references);
  if (scored.length === 0) {
    return {
      ok: false,
      code: 'NOT_REGISTERED',
      parsed,
      message:
        parsed.kind === 'handful'
          ? `还没有登记过"一${parsed.vessel}"是多少：先在上面量化一次（例如"我的手一把 ≈ 80g"），再回来换算`
          : `本空间还没有登记"${parsed.vessel}"：先在上面登记家里那只${parsed.vessel}一平${parsed.vessel}是多少克`,
    };
  }

  const best = scored[0]!;
  const second = scored[1];
  // 只有量词基础分、且不止一个同分候选时，无法判断指的是哪只勺/哪只碗
  const tied = second && second.score === best.score;
  if (tied && best.score === 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      parsed,
      candidates: scored.filter((s) => s.score === best.score).map((s) => s.reference),
      message: `本空间登记了多个"${parsed.vessel}"，你说的是哪一个？`,
    };
  }

  return buildConverted(parsed, best.reference);
}

function buildConverted(parsed: ParsedQuantity, reference: ReferenceLike): ConvertedQuantity {
  const factor = parsed.count * extraFactor(parsed);
  const value = round1(reference.amountValue * factor);
  const tolerance = toleranceFor(parsed);
  const range = {
    min: round1(value * (1 - tolerance)),
    max: round1(value * (1 + tolerance)),
  };

  const sizeText = parsed.kind === 'handful' && parsed.size === 'small' ? '小' : '';
  const countText = parsed.count === 0.5 ? '半' : String(parsed.count);
  const spoken = `${countText}${describeHeap(parsed)}${sizeText}${parsed.vessel}`;
  const basis =
    `${spoken} ≈ ${value}${reference.amountUnit}（${range.min}–${range.max}${reference.amountUnit}）；` +
    `依据：${reference.label} 1 ${describeHeap(parsed) || '平'}${parsed.vessel} = ${reference.amountValue}${reference.amountUnit}`;

  return {
    ok: true,
    factor: Math.round(factor * 100) / 100,
    value,
    range,
    tolerance,
    unit: reference.amountUnit,
    reference,
    parsed,
    basis,
  };
}
