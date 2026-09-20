import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, WORKSPACE_ROLES, type WorkspaceRole } from '@froa/shared';
import { workspaceApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { ReferenceConverter } from './ReferenceConverter';

const ROLE_HINTS: Record<WorkspaceRole, string> = {
  owner: '可管理成员与全部内容',
  editor: '可整理规格、发布版本',
  contributor: '可录音、回答追问、提交复做验证',
  viewer: '只能查看',
};

export function MembersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const me = useAuthStore((s) => s.user);
  const [form] = Form.useForm<{ label: string; amountValue: number; amountUnit: string; note?: string }>();

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => workspaceApi.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => workspaceApi.members(workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const references = useQuery({
    queryKey: ['references', workspaceId],
    queryFn: () => workspaceApi.references(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const isOwner = workspace.data?.role === 'owner';

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      workspaceApi.updateRole(workspaceId!, userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
      message.success('角色已更新');
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => workspaceApi.removeMember(workspaceId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
      message.success('已移除成员');
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const referenceMutation = useMutation({
    mutationFn: (values: { label: string; amountValue: number; amountUnit: string; note?: string }) =>
      workspaceApi.addReference(workspaceId!, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['references', workspaceId] });
      form.resetFields();
      message.success('参照物已登记');
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const [rotateCode, setRotateCode] = useState<string | null>(null);
  const rotateMutation = useMutation({
    mutationFn: () => workspaceApi.rotateInvite(workspaceId!),
    onSuccess: (result) => {
      setRotateCode(result.inviteCode);
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  if (members.isLoading) {
    return <Spin size="large" />;
  }

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>成员与参照物</h1>
          <div className="froa-hint">
            角色决定谁能"下结论"。贡献者可以录音、回答追问、提交复做验证，但不能改规格或发布版本。
          </div>
        </div>
        <Button onClick={() => rotateMutation.mutate()} loading={rotateMutation.isPending} disabled={!isOwner}>
          重置邀请码
        </Button>
      </div>

      {rotateCode && (
        <Typography.Text type="success">
          新邀请码：<strong>{rotateCode}</strong>（旧邀请码已失效）
        </Typography.Text>
      )}

      <Table
        rowKey="id"
        dataSource={members.data ?? []}
        pagination={false}
        columns={[
          {
            title: '成员',
            dataIndex: 'displayName',
            render: (_, record) => (
              <span>
                {record.displayName}
                {record.userId === me?.id ? '（我）' : ''}
              </span>
            ),
          },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (role: WorkspaceRole, record) =>
              isOwner && record.userId !== workspace.data?.ownerId ? (
                <Select
                  size="small"
                  value={role}
                  style={{ width: 130 }}
                  onChange={(next) => roleMutation.mutate({ userId: record.userId, role: next })}
                  options={WORKSPACE_ROLES.filter((r) => r !== 'owner').map((r) => ({
                    value: r,
                    label: `${ROLE_LABELS[r]}（${ROLE_HINTS[r]}）`,
                  }))}
                />
              ) : (
                <Tag>{ROLE_LABELS[role]}</Tag>
              ),
          },
          {
            title: '加入时间',
            dataIndex: 'joinedAt',
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: '',
            render: (_, record) =>
              isOwner && record.userId !== workspace.data?.ownerId ? (
                <Popconfirm
                  title="确定移除该成员？"
                  description="移除后他将无法再访问这个空间的任何食谱与语音。"
                  onConfirm={() => removeMutation.mutate(record.userId)}
                  okText="移除"
                  cancelText="取消"
                >
                  <Button danger type="text" size="small">
                    移除
                  </Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />

      <div className="froa-card">
        <h3 className="froa-card-title">参照物登记</h3>
        <Typography.Paragraph type="secondary">
          先把"家里那只勺、那只碗"量化一次，之后所有"一勺""一碗"都能换算成克 ——
          这是把模糊用量变成数值最有效的办法。
        </Typography.Paragraph>

        <Form
          form={form}
          layout="inline"
          onFinish={(values) => referenceMutation.mutate(values)}
          style={{ marginBottom: '1rem', rowGap: 8 }}
        >
          <Form.Item label="参照物" name="label" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="外婆家的白瓷汤勺" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item label="等于" name="amountValue" rules={[{ required: true, message: '必填' }]}>
            <InputNumber min={0.1} step={0.5} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item label="单位" name="amountUnit" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="g / ml" style={{ width: 90 }} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input placeholder="一平勺约 8g" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={referenceMutation.isPending}>
              登记
            </Button>
          </Form.Item>
        </Form>

        <Table
          rowKey="id"
          size="small"
          dataSource={references.data ?? []}
          pagination={false}
          columns={[
            { title: '参照物', dataIndex: 'label' },
            {
              title: '换算',
              render: (_, record) => `1 个 = ${record.amountValue}${record.amountUnit}`,
            },
            { title: '备注', dataIndex: 'note' },
          ]}
        />
      </div>

      <ReferenceConverter references={references.data ?? []} />
    </div>
  );
}
