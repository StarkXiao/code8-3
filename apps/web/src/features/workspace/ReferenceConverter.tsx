import { useMemo, useState } from 'react';
import { AutoComplete, Button, Input, Space, Tag, Typography } from 'antd';
import { convertReferenceQuantity, type KitchenReferenceDto } from '@froa/shared';

const QUICK_PHRASES = ['半勺', '一勺', '满勺', '一小把', '一撮', '半碗'];

/**
 * 参照物换算器：把"半勺""一小把"这类口述，按本空间已登记的餐具/手感参照物
 * 折算成克数（或参照物登记时的单位），并给出容错区间。
 * 换算口径在 packages/shared/src/reference.ts，前后端共用一份。
 */
export function ReferenceConverter({ references }: { references: KitchenReferenceDto[] }) {
  const [phrase, setPhrase] = useState('');
  const [referenceId, setReferenceId] = useState<string | undefined>(undefined);

  const options = useMemo(
    () =>
      phrase.trim()
        ? [{ value: phrase }, ...QUICK_PHRASES.filter((p) => p.includes(phrase.trim())).map((value) => ({ value }))]
        : QUICK_PHRASES.map((value) => ({ value })),
    [phrase],
  );

  const result = useMemo(() => {
    if (!phrase.trim()) return null;
    return convertReferenceQuantity(phrase, references, { referenceId });
  }, [phrase, references, referenceId]);

  const hasReferences = references.length > 0;

  return (
    <div className="froa-card">
      <h3 className="froa-card-title">参照物换算器</h3>
      <Typography.Paragraph type="secondary">
        把口述里的"半勺""一小把"按上面登记过的餐具折算成克数。区间不是装饰 ——
        勺量按 ±15% 起步、手感（把/撮）按 ±30% 起步，半份、小把、堆尖都会再放宽。
      </Typography.Paragraph>

      <AutoComplete
        value={phrase}
        options={options}
        style={{ width: 320 }}
        onChange={(value) => {
          setPhrase(value);
          setReferenceId(undefined);
        }}
        placeholder="输入口述用量，例如：半勺、一小把"
        disabled={!hasReferences}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {QUICK_PHRASES.map((quick) => (
          <Tag
            key={quick}
            style={{ cursor: hasReferences ? 'pointer' : 'not-allowed' }}
            onClick={() => {
              if (!hasReferences) return;
              setPhrase(quick);
              setReferenceId(undefined);
            }}
          >
            {quick}
          </Tag>
        ))}
      </div>

      {!hasReferences && (
        <Typography.Paragraph type="warning" style={{ marginTop: 12, marginBottom: 0 }}>
          还没有任何参照物可换算：先在上面登记一只勺（或"我的手一把 ≈ 80g"）再回来。
        </Typography.Paragraph>
      )}

      {result && !result.ok && result.code !== 'EMPTY' && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="warning">{result.message}</Typography.Text>
          {result.code === 'AMBIGUOUS' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {result.candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="small"
                  type={referenceId === candidate.id ? 'primary' : 'default'}
                  onClick={() => setReferenceId(candidate.id)}
                >
                  {candidate.label}（1 {result.parsed.vessel} = {candidate.amountValue}
                  {candidate.amountUnit}）
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && !result.ok && result.code === 'EMPTY' && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {result.message}
        </Typography.Paragraph>
      )}

      {result?.ok && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 22 }}>
            <strong>
              ≈ {result.value}
              {result.unit}
            </strong>
            <Typography.Text type="secondary" style={{ fontSize: 14, marginLeft: 12 }}>
              容错区间 {result.range.min}–{result.range.max}
              {result.unit}（±{Math.round(result.tolerance * 100)}%）
            </Typography.Text>
          </div>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {result.basis}
          </Typography.Paragraph>
          <Space.Compact style={{ marginTop: 8, width: '100%' }}>
            <Input readOnly value={result.basis} />
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(result.basis);
              }}
            >
              复制依据
            </Button>
          </Space.Compact>
        </div>
      )}
    </div>
  );
}
