import { describe, expect, it } from 'vitest';
import {
  convertMeasure,
  convertText,
  matchReferences,
  parseMeasurePhrases,
  parseQuantity,
  type ConvertReference,
} from '@froa/shared';

// 与 seed.ts 保持一致的家庭参照物
const references: ConvertReference[] = [
  { id: 'ref-spoon', label: '外婆家的白瓷汤勺', amountValue: 8, amountUnit: 'g', note: '一平勺约 8g，满勺约 12g' },
  { id: 'ref-small-spoon', label: '搪瓷小勺', amountValue: 3, amountUnit: 'g', note: '一平勺约 3g（用来量盐和糖）' },
  { id: 'ref-bowl', label: '那只蓝边饭碗', amountValue: 220, amountUnit: 'ml', note: '一碗水约 220ml' },
];

describe('口语用量解析', () => {
  it('解析份数、平/满、大/小和量词', () => {
    const [half] = parseMeasurePhrases('半勺');
    expect(half?.quantity).toBe(0.5);
    expect(half?.kind).toBe('spoon');
    expect(half?.measure).toBe('勺');

    const [flat] = parseMeasurePhrases('一平勺糖');
    expect(flat?.fill).toBe('flat');
    expect(flat?.quantity).toBe(1);

    const [small] = parseMeasurePhrases('一小勺老抽');
    expect(small?.size).toBe('small');
    expect(small?.quantity).toBe(1);

    // "小半"是一个份数词（约 1/3），不是"小 + 半勺"
    const [fraction] = parseMeasurePhrases('小半勺老抽');
    expect(fraction?.quantity).toBeCloseTo(1 / 3);
    expect(fraction?.size).toBeUndefined();

    const [handful] = parseMeasurePhrases('抓一小把虾皮');
    expect(handful?.kind).toBe('handful');
    expect(handful?.size).toBe('small');
  });

  it('支持中文数字、两、阿拉伯数字与小半/大半', () => {
    expect(parseQuantity('两')).toBe(2);
    expect(parseQuantity('二十')).toBe(20);
    expect(parseQuantity('3.5')).toBe(3.5);
    expect(parseQuantity('小半')).toBeCloseTo(1 / 3);
    expect(parseQuantity('大半')).toBeCloseTo(2 / 3);

    const [two, three] = parseMeasurePhrases('两勺盐和三勺糖');
    expect(two?.quantity).toBe(2);
    expect(three?.quantity).toBe(3);
  });

  it('长词量词不被单字截断', () => {
    const [teaspoon, tablespoon] = parseMeasurePhrases('一茶匙盐、一汤匙生抽');
    expect(teaspoon?.subKind).toBe('teaspoon');
    expect(tablespoon?.subKind).toBe('tablespoon');
  });

  it('没有量词的普通句子不产生误报', () => {
    expect(parseMeasurePhrases('把肉切成三厘米见方的块')).toHaveLength(0);
    expect(parseMeasurePhrases('炖到筷子能戳透')).toHaveLength(0);
  });

  it('一句话里的多个短语按出现顺序返回', () => {
    const phrases = parseMeasurePhrases('半勺糖，再来一小把虾皮，加一撮盐');
    expect(phrases.map((p) => p.text)).toEqual(['半勺', '一小把', '一撮']);
  });
});

describe('参照物匹配', () => {
  it('按餐具类型选参照物，平勺词加权', () => {
    const [phrase] = parseMeasurePhrases('半勺老抽');
    const matched = matchReferences(phrase!, references);
    // 两只勺都匹配，带"小"的备注/名称不影响"半勺"首选白瓷汤勺
    expect(matched[0]?.id).toBe('ref-spoon');
  });

  it('一小把不匹配任何餐具', () => {
    const [phrase] = parseMeasurePhrases('一小把虾皮');
    expect(matchReferences(phrase!, references)).toHaveLength(0);
  });
});

describe('按已登记餐具折算克数', () => {
  it('半勺 = 8g × 0.5 = 4g，并给出容错区间', () => {
    const [phrase] = parseMeasurePhrases('半勺');
    const result = convertMeasure(phrase!, references);

    expect(result.ok).toBe(true);
    expect(result.source).toBe('reference');
    expect(result.grams).toBe(4);
    expect(result.reference?.id).toBe('ref-spoon');
    expect(result.minGrams).toBeLessThan(4);
    expect(result.maxGrams).toBeGreaterThan(4);
    expect(result.confidence).toBe('estimated');
    expect(result.explanation).toContain('8g');
  });

  it('两勺 = 8g × 2 = 16g', () => {
    const [phrase] = parseMeasurePhrases('两勺');
    const result = convertMeasure(phrase!, references);
    expect(result.grams).toBe(16);
  });

  it('满勺优先读参照物备注里的 12g，而不是写死的倍率', () => {
    const [phrase] = parseMeasurePhrases('一满勺豆瓣酱');
    const result = convertMeasure(phrase!, references);
    // 8g × 12/8 = 12g
    expect(result.grams).toBe(12);
    expect(result.explanation).toContain('备注');
  });

  it('"小勺"参照物登记值本身就是小号，遇到"一小勺"不再二次缩放', () => {
    const [phrase] = parseMeasurePhrases('一小勺盐');
    const result = convertMeasure(phrase!, references, 'ref-small-spoon');
    // 搪瓷小勺名字里带"小"，3g × 1 = 3g，不应再乘 0.8
    expect(result.grams).toBe(3);
  });

  it('以 ml 登记的碗按 1ml≈1g 估算并显式提示密度误差', () => {
    const [phrase] = parseMeasurePhrases('一碗水');
    const result = convertMeasure(phrase!, references);
    expect(result.ok).toBe(true);
    expect(result.grams).toBe(220);
    expect(result.volumeAssumed).toBe(true);
    expect(result.explanation).toContain('1ml≈1g');
  });

  it('多个参照物命中时返回候选，可指定采用哪一个', () => {
    const [phrase] = parseMeasurePhrases('一勺糖');
    const result = convertMeasure(phrase!, references);
    expect(result.candidates?.map((ref) => ref.id).sort()).toEqual([
      'ref-small-spoon',
      'ref-spoon',
    ]);

    const small = convertMeasure(phrase!, references, 'ref-small-spoon');
    expect(small.grams).toBe(3);
  });
});

describe('经验估值与无法换算', () => {
  it('一小把给 10–20g 的宽区间经验值', () => {
    const [phrase] = parseMeasurePhrases('一小把虾皮');
    const result = convertMeasure(phrase!, references);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('builtin');
    expect(result.grams).toBe(10);
    expect(result.maxGrams! - result.minGrams!).toBeGreaterThanOrEqual(6);
  });

  it('一撮给 1–2g 暂定估值', () => {
    const [phrase] = parseMeasurePhrases('一撮盐');
    const result = convertMeasure(phrase!, references);
    expect(result.source).toBe('builtin');
    expect(result.grams).toBe(2);
  });

  it('没登记的勺明确换算失败并提示去登记，而不是瞎猜', () => {
    const [phrase] = parseMeasurePhrases('半盆面');
    const result = convertMeasure(phrase!, references);
    expect(result.ok).toBe(false);
    expect(result.source).toBe('none');
    expect(result.hint).toContain('登记');
  });

  it('没登记但茶匙/汤匙有国标量级，给暂定估值并说明是通用规格', () => {
    const [teaspoon] = parseMeasurePhrases('一茶匙盐');
    const result = convertMeasure(teaspoon!, []);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('builtin');
    expect(result.grams).toBe(5);
    expect(result.confidence).toBe('assumed');
  });
});

describe('整句换算', () => {
  it('一句话里多个短语分别折算', () => {
    const results = convertText('半勺糖、一小把虾皮', references);
    expect(results).toHaveLength(2);
    expect(results[0]?.grams).toBe(4);
    expect(results[1]?.source).toBe('builtin');
  });
});
