import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, AutoComplete, Button, Card, Empty, Input, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  CONFIDENCE_LABELS,
  CONVERT_EXAMPLES,
  convertMeasure,
  convertText,
  type ConvertReference,
  type ConvertResult,
} from '@froa/shared';
import { workspaceApi } from '../../api/endpoints';

/**
 * 参照物换算器。
 *
 * 输入"半勺 / 一小把 / 一平勺"这类口语用量，按本空间已登记的餐具折算成克数，
 * 并给出容错区间。换算只给"推算/暂定"，落笔仍需人确认。
 */
export function ConverterPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [text, setText] = useState('');

  const references = useQuery({
    queryKey: ['references', workspaceId],
    queryFn: () => workspaceApi.references(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const refs = references.data ?? [];

  // 结果顺序固定后，每条记住用户手选的参照物
  const [picked, setPicked] = useState<Record<number, string>>({});

  const results = useMemo(() => convertText(text, refs), [text, refs]);
  const display = useMemo(
    () =>
      results.map((result, index) =>
        picked[index] ? convertMeasure(result.matched, refs, picked[index]) : result,
      ),
    [results, picked, refs],
  );

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>参照物换算器</h1>
          <div className="froa-hint">
            输入长辈的原话（"半勺老抽""一小把虾皮"），按本空间登记过的餐具折成克数，并给出容错区间。
          </div>
        </div>
        <Link to={`/w/${workspaceId}/members`}>
          <Button>管理餐具参照物</Button>
        </Link>
      </div>

      <Card>
        <AutoComplete
          style={{ width: '100%' }}
          value={text}
          onChange={setText}
          options={CONVERT_EXAMPLES.map((value) => ({ value, label: value }))}
          filterOption={false}
        >
          <Input
            size="large"
            allowClear
            placeholder="例如：半勺老抽，再来一小把虾皮"
            suffix={
              text ? (
                <ReloadOutlined
                  onClick={() => {
                    setText('');
                    setPicked({});
                  }}
                />
              ) : undefined
            }
          />
        </AutoComplete>

        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          支持「半/小半/大半/一/两/三…」+「平/满」+「大/小」+「勺/匙/汤匙/茶匙/碗/杯/把/撮」。
          区间会把份数、平满、手抓等每一层"靠眼睛"的误差都算进去。
        </Typography.Paragraph>
      </Card>

      {text.trim() && display.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="这句话里没有认出用量短语"
          description="试试「半勺」「一小把」「一平勺」这样的说法；或者把整句原话贴进来，会自动挑出里面的用量。"
        />
      )}

      {display.length > 0 && (
        <div className="froa-stack">
          {display.map((result, index) => (
            <ResultCard
              key={`${result.matched.index}-${result.matched.text}`}
              result={result}
              onPick={(referenceId) => setPicked((prev) => ({ ...prev, [index]: referenceId }))}
            />
          ))}
          <Alert
            type="warning"
            showIcon
            message="换算结果只能作为「推算/暂定」参考，不是已确认结论"
            description="真正写进食谱规格时，请由长辈或复做验证确认 —— 规则引擎永远不替人下结论。"
          />
        </div>
      )}

      {!text.trim() && (
        <Card size="small">
          <Typography.Text strong>本空间已登记的参照物</Typography.Text>
          {refs.length === 0 ? (
            <Empty
              style={{ marginTop: 12 }}
              description={
                <span>
                  还没有登记任何餐具。
                  <br />
                  先把"家里那只勺、那只碗等于多少克"量化一次，换算器才认得它们。
                </span>
              }
            >
              <Link to={`/w/${workspaceId}/members`}>
                <Button type="primary">去登记参照物</Button>
              </Link>
            </Empty>
          ) : (
            <Space size={[8, 8]} wrap style={{ marginTop: 12 }}>
              {refs.map((ref) => (
                <Tag key={ref.id}>
                  {ref.label}：1 ≈ {ref.amountValue}
                  {ref.amountUnit}
                </Tag>
              ))}
            </Space>
          )}
        </Card>
      )}
    </div>
  );
}

/** 单条换算结果卡片 */
function ResultCard({
  result,
  onPick,
}: {
  result: ConvertResult;
  onPick: (referenceId: string) => void;
}) {
  const { matched } = result;

  if (!result.ok) {
    return (
      <Alert
        type="error"
        showIcon
        message={
          <span>
            <Tag color="red">{matched.text}</Tag>
            无法换算
          </span>
        }
        description={
          <div className="froa-stack" style={{ gap: 6 }}>
            <span>{result.explanation}</span>
            {result.hint && <Typography.Text type="secondary">{result.hint}</Typography.Text>}
          </div>
        }
      />
    );
  }

  const rangeColor = result.source === 'builtin' ? 'gold' : 'blue';

  return (
    <Card>
      <Space wrap align="center" size="middle">
        <Tag color="purple" style={{ fontSize: '1rem', padding: '2px 10px' }}>
          {matched.text}
        </Tag>
        <ArrowRightOutlined />
        <Typography.Text strong style={{ fontSize: '1.6rem' }}>
          {result.grams}g
        </Typography.Text>
        <Tag color={rangeColor} style={{ fontSize: '1rem', padding: '2px 10px' }}>
          容错 {result.minGrams}–{result.maxGrams}g
        </Tag>
        <Tag>{CONFIDENCE_LABELS[result.confidence]}</Tag>
        <Tag color={result.source === 'reference' ? 'green' : 'orange'}>
          {result.source === 'reference' ? '按已登记餐具' : '经验估值'}
        </Tag>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 4 }}>
        {result.explanation}
      </Typography.Paragraph>

      {result.reference && (
        <Typography.Text type="secondary">
          采用参照物：{result.reference.label}（{result.reference.amountValue}
          {result.reference.amountUnit}）
        </Typography.Text>
      )}

      {result.candidates && result.candidates.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">用了哪只？</Typography.Text>
          <Space size={[4, 4]} wrap style={{ marginLeft: 8 }}>
            {result.candidates.map((candidate) => (
              <Button
                key={candidate.id}
                size="small"
                type={candidate.id === result.reference?.id ? 'primary' : 'default'}
                onClick={() => onPick(candidate.id)}
              >
                {candidate.label}
              </Button>
            ))}
          </Space>
        </div>
      )}

      {result.hint && (
        <Typography.Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
          {result.hint}
        </Typography.Paragraph>
      )}
    </Card>
  );
}
