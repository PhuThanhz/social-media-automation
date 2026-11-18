import { Alert, App, Card, Select, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../config/axios';

type PowerState = { supported: boolean; action: 'OFF' | 'SHUTDOWN' | 'SLEEP'; executeAt: number; error: string };
const key = ['queuePower'];

export default function QueuePowerPanel() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const { data } = useQuery<PowerState>({
    queryKey: key,
    queryFn: async () => (await api.get('/queue/power')).data,
    refetchInterval: 5000,
  });
  const update = useMutation({
    mutationFn: async (action: PowerState['action']) => (await api.post('/queue/power', { action })).data,
    onSuccess: (state: PowerState) => client.setQueryData(key, state),
    onError: (err: any) => message.error(err.response?.data?.message || 'Không thể cập nhật tùy chọn nguồn.'),
  });
  if (!data?.supported) return null;
  return (
    <Card size="small" title="Sau khi chạy xong lịch đăng" style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select
          aria-label="Thao tác sau khi chạy xong lịch đăng"
          value={data.action}
          disabled={update.isPending}
          onChange={(value) => update.mutate(value)}
          style={{ minWidth: 260 }}
          options={[
            { value: 'OFF', label: 'Không làm gì (mặc định)' },
            { value: 'SLEEP', label: 'Sleep máy Windows' },
            { value: 'SHUTDOWN', label: 'Tắt máy Windows' },
          ]}
        />
        <Typography.Text type="secondary">
          Áp dụng một lần cho toàn bộ hàng đợi, kể cả bài hẹn ngày sau. Khi không còn bài chờ hoặc đang đăng,
          máy sẽ đợi 60 giây rồi thực hiện. Bài lỗi được tính là đã xử lý xong. Chọn “Không làm gì” để hủy.
          Hãy lưu công việc trước khi bật. Mở lại ứng dụng sẽ trở về mặc định.
        </Typography.Text>
        {data.executeAt > 0 && <Alert type="warning" showIcon message={`Sẽ ${data.action === 'SLEEP' ? 'sleep' : 'tắt'} máy lúc ${new Date(data.executeAt).toLocaleTimeString('vi-VN')}. Chọn “Không làm gì” để hủy.`} />}
        {data.error && <Alert type="error" showIcon message={data.error} />}
      </Space>
    </Card>
  );
}
