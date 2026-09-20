import { describe, expect, it } from 'vitest';
import {
  convertReferenceQuantity,
  parseQuantityPhrase,
  toleranceFor,
  type ReferenceLike,
} from '@froa/shared';

const references: ReferenceLike[] = [
  { id: 'r1', label: '外婆家的白瓷汤勺', amountValue: 8, amountUnit: 'g' },
  { id: 'r2', label: '搪瓷小勺', amountValue: 3, amountUnit: 'g' },
  { id: 'r3', label: '不锈钢大勺', amountValue: 15, amountUnit: 'g' },
  { id: 'r4', label: '那只蓝边饭碗', amountValue: 220, amountUnit: 'ml' },
  { id: 'r5', label: '外婆的手（一把）', amountValue: 80, amountUnit: 'g' },
];

const convert = (phrase: string, referenceId?: string) =>
  convertReferenceQuantity(phrase, references, referenceId ? { referenceId } : {});

describe('口语用量解析', () => {
  it('半勺：份数 0.5', () => {
    expect(parseQuantityPhrase('半勺')).toMatchObject({ count: 0.5, vessel: '勺', kind: 'utensil' });
  });

  it('一小把：份数 1 + 小 + 手感词', () => {
    expect(parseQuantityPhrase('一小把')).toMatchObject({
      count: 1,
      size: 'small',
      vessel: '把',
      kind: 'handful',
    });
  });

  it('两大勺：份数 2 + 大；阿拉伯数字也支持', () => {
    expect(parseQuantityPhrase('两大勺')).toMatchObject({ count: 2, size: 'large', vessel: '勺' });
    expect(parseQuantityPhrase('2.5勺')?.count).toBe(2.5);
  });

  it('满勺 / 平勺：不带数词按 1 份', () => {
    expect(parseQuantityPhrase('满勺')).toMatchObject({ count: 1, heap: 'heaped' });
    expect(parseQuantityPhrase('一平勺')).toMatchObject({ count: 1, heap: 'level' });
  });

  it('一撮 / 一捏归一为手感量词', () => {
    expect(parseQuantityPhrase('一撮盐')?.vessel).toBe('撮');
    expect(parseQuantityPhrase('一捏糖')?.kind).toBe('handful');
  });

  it('认不出用量词返回 null', () => {
    expect(parseQuantityPhrase('差不多就行')).toBeNull();
  });
});

describe('参照物换算', () => {
  it('半勺 → 4g，默认容错 ±15% 叠加半份 +5% = ±20%：3.2–4.8g', () => {
    // 空间里有三把勺，光说"勺"分不清是哪把：先报歧义，选定白瓷汤勺后换算
    const ambiguous = convert('半勺');
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) return;
    expect(ambiguous.code).toBe('AMBIGUOUS');

    const result = convert('半勺', 'r1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(4);
    expect(result.unit).toBe('g');
    expect(result.range).toEqual({ min: 3.2, max: 4.8 });
    expect(result.tolerance).toBe(0.2);
    expect(result.reference.id).toBe('r1');
  });

  it('一小把 → 40g（80 × 小把 0.5），手感容错 30% + 小修饰 5% = 35%：26–54g', () => {
    const result = convert('一小把');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(40);
    expect(result.tolerance).toBe(0.35);
    expect(result.range).toEqual({ min: 26, max: 54 });
  });

  it('半小把 → 80 × 0.5 × 0.5 = 20g，小修饰与半份都叠加容错 = 40%：12–28g', () => {
    const result = convert('半小把');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(20);
    expect(result.tolerance).toBe(0.4);
    expect(result.range).toEqual({ min: 12, max: 28 });
  });

  it('两勺（选定白瓷汤勺）→ 16g，整份无叠加，仅默认 ±15%', () => {
    const result = convert('两勺', 'r1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(16);
    expect(result.range).toEqual({ min: 13.6, max: 18.4 });
  });

  it('满勺按 1.5 倍折算 → 12g，堆尖再 +5% 容错', () => {
    const result = convert('一满勺', 'r1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(12);
    expect(result.tolerance).toBe(0.2);
    expect(result.range).toEqual({ min: 9.6, max: 14.4 });
  });

  it('大勺优先选"不锈钢大勺"，不会选到"搪瓷小勺"', () => {
    const result = convert('一大勺');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference.id).toBe('r3');
    expect(result.value).toBe(15);
  });

  it('小勺优先选"搪瓷小勺"', () => {
    const result = convert('一小勺');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference.id).toBe('r2');
  });

  it('半碗 → 110ml，沿用参照物登记的 ml 单位，不擅自换算成克', () => {
    const result = convert('半碗');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(110);
    expect(result.unit).toBe('ml');
  });

  it('残词"白瓷"可消歧：两个勺子里选带白瓷的那个', () => {
    const result = convert('一白瓷勺');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference.id).toBe('r1');
  });

  it('basis 是一句可直接放进规格依据的人话', () => {
    const result = convert('半勺', 'r1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basis).toContain('半勺 ≈ 4g（3.2–4.8g）');
    expect(result.basis).toContain('外婆家的白瓷汤勺');
  });

  it('没有登记该量词 → NOT_REGISTERED，并提示先登记', () => {
    const result = convertReferenceQuantity('一杯', [
      { id: 'r1', label: '白瓷勺', amountValue: 8, amountUnit: 'g' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_REGISTERED');
    expect(result.message).toContain('杯');
  });

  it('没登记手感参照 → 提示量化"一把"', () => {
    const result = convertReferenceQuantity('一小把', [
      { id: 'r1', label: '白瓷勺', amountValue: 8, amountUnit: 'g' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_REGISTERED');
    expect(result.message).toContain('一把');
  });

  it('多个勺同分且无其它线索 → AMBIGUOUS，回带候选', () => {
    const result = convertReferenceQuantity('一勺', [
      { id: 'a', label: '白瓷勺', amountValue: 8, amountUnit: 'g' },
      { id: 'b', label: '铁勺', amountValue: 10, amountUnit: 'g' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== 'AMBIGUOUS') throw new Error('应当报歧义');
    expect(result.candidates.map((c: ReferenceLike) => c.id)).toEqual(['a', 'b']);
  });

  it('歧义时用户显式指定 referenceId 后正常换算', () => {
    const result = convertReferenceQuantity(
      '一勺',
      [
        { id: 'a', label: '白瓷勺', amountValue: 8, amountUnit: 'g' },
        { id: 'b', label: '铁勺', amountValue: 10, amountUnit: 'g' },
      ],
      { referenceId: 'b' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference.id).toBe('b');
    expect(result.value).toBe(10);
  });

  it('认不出任何用量词 → EMPTY', () => {
    const result = convert('火候差不多就行');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY');
  });
});

describe('容错率规则', () => {
  it('餐具默认 15%，手感 30%，捏/撮更粗 35%', () => {
    expect(toleranceFor(parseQuantityPhrase('一勺')!)).toBe(0.15);
    expect(toleranceFor(parseQuantityPhrase('一把')!)).toBe(0.3);
    expect(toleranceFor(parseQuantityPhrase('一撮')!)).toBe(0.35);
  });

  it('多重不确定性叠加且封顶 50%', () => {
    // 餐具：0.15 + 0.05 小 + 0.05 半份 + 0.05 堆尖 = 0.3
    expect(toleranceFor(parseQuantityPhrase('半小满尖勺')!)).toBe(0.3);
    // 手感捏：0.35 + 0.05 + 0.05 = 0.45
    expect(toleranceFor(parseQuantityPhrase('半小捏')!)).toBe(0.45);
  });
});
