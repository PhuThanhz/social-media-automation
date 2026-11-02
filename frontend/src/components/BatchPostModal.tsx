import { useState } from 'react';
import { Modal, Form, Input, Select, Switch, DatePicker, Button, App, Typography, Card } from 'antd';
import { ThunderboltOutlined, LinkOutlined, ClockCircleOutlined, UserOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import api from '../config/axios';

const { Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
}

interface BatchPostModalProps {
  open: boolean;
  onClose: () => void;
}

export const BatchPostModal = ({ open, onClose }: BatchPostModalProps) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<'FANPAGE' | 'GROUP' | 'TIKTOK' | 'THREADS'>('FANPAGE');
  const [selectedFanpageAccountType, setSelectedFanpageAccountType] = useState<string | undefined>(undefined);

  // Fetch danh sách tài khoản đã kết nối
  const { data: socialAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    }
  });

  const batchMutation = useMutation({
    mutationFn: async (values: any) => {
      const rawUrls = values.urlsText || '';
      const urlList = rawUrls
        .split('\n')
        .map((u: string) => u.trim())
        .filter((u: string) => u.length > 0);

      if (urlList.length === 0) {
        throw new Error('Vui lòng dán ít nhất 1 đường dẫn URL bài viết!');
      }
      if (!values.targetFanpageId) {
        throw new Error('Vui lòng chọn Fanpage/Nick đăng bài!');
      }

      let interval = values.intervalMinutes || 15;
      if (values.fitToday && urlList.length > 0) {
        const now = dayjs();
        const endOfDay = now.hour(23).minute(45).second(0);
        const diffMinutes = Math.max(10, endOfDay.diff(now, 'minute'));
        interval = Math.max(2, Math.min(15, Math.floor(diffMinutes / urlList.length)));
      }

      const scheduledAtStr = values.scheduledAt
        ? (values.scheduledAt as Dayjs).format('YYYY-MM-DDTHH:mm:ss')
        : dayjs().format('YYYY-MM-DDTHH:mm:ss');

      // Chế độ Group: đăng THẲNG vào từng Group đã chọn (không đăng lên tường Fanpage) — gọi riêng
      // endpoint /queue/post-urls-to-group cho MỖI Group, vì backend chỉ nhận 1 targetGroupId/lần gọi.
      if (values.postingTarget === 'GROUP') {
        const groups: string[] = Array.isArray(values.groupId) ? values.groupId : [values.groupId];
        if (groups.length === 0) {
          throw new Error('Vui lòng chọn ít nhất 1 Group Facebook!');
        }
        const pageId = String(values.targetFanpageId).split(':')[0];
        let totalPosted = 0;
        let totalRequested = 0;
        for (const groupId of groups) {
          const payload = {
            urls: urlList,
            intervalMinutes: interval,
            publishNow: values.publishNow || false,
            scheduledAt: scheduledAtStr,
            pageId,
            targetFanpageId: values.targetFanpageId,
            targetGroupId: groupId,
            affiliateLink: values.affiliateLink?.trim() || undefined,
            enableGroupComment: values.affiliateLink?.trim() ? true : undefined,
          };
          const response = await api.post('/queue/post-urls-to-group', payload);
          totalPosted += response.data?.posted || 0;
          totalRequested += response.data?.total || urlList.length;
        }
        if (values.fitToday) {
          try {
            await api.post('/queue/pack-continuous', { gapSeconds: Math.round(interval * 60) });
          } catch (ignored) {}
        }
        return { count: totalPosted, total: totalRequested, mode: 'GROUP' as const };
      }

      const payload = {
        urls: urlList,
        intervalMinutes: interval,
        publishNow: values.publishNow || false,
        scheduledAt: scheduledAtStr,
        targetFanpageId: values.targetFanpageId,
        affiliateLink: values.affiliateLink?.trim() || undefined,
        groupNames: values.groupNames && values.groupNames.length > 0 ? values.groupNames : undefined,
        enableGroupComment: values.affiliateLink?.trim() ? true : undefined,
        appendToQueue: values.fitToday || false,
        gapSeconds: Math.round(interval * 60),
      };

      const response = await api.post('/queue/add-from-urls', payload);
      return { ...response.data, mode: 'FANPAGE' as const };
    },
    onSuccess: (data) => {
      message.success(`🎉 Đã tạo thành công ${data.count || 0} bài viết vào Hàng Đợi với lịch đăng giãn cách!`);
      form.resetFields();
      onClose();
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
      queryClient.invalidateQueries({ queryKey: ['posting-window'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi tạo danh sách đăng bài!');
    }
  });

  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-800 pb-2 border-b border-slate-100">
          <ThunderboltOutlined className="text-emerald-600 text-xl" />
          <div>
            <div className="font-bold text-lg">Đăng Bài Hàng Loạt (Multi-Link Batch Scheduler)</div>
            <div className="text-xs text-slate-500 font-normal">Dán 50 link dồn 1 lúc và chọn lịch đăng bài giãn cách tự động</div>
          </div>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      className="rounded-2xl overflow-hidden"
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => batchMutation.mutate(values)}
        initialValues={{
          intervalMinutes: 3,
          publishNow: false,
          postingTarget: 'FANPAGE',
          groupNames: ['Đảo Mèo'],
          scheduledAt: dayjs().add(2, 'minute')
        }}
        className="mt-4 space-y-4"
      >
        <Form.Item
          name="urlsText"
          label={<span className="font-bold text-slate-700">Danh sách Link Bài Viết (Mỗi link 1 dòng - Tối đa 50 link)</span>}
          rules={[{ required: true, message: 'Dán danh sách các link bài viết vào đây!' }]}
        >
          <TextArea
            rows={6}
            placeholder={`https://www.tiktok.com/@user/video/123456789...\nhttps://www.threads.net/share/AbcXyz...\nhttps://genk.vn/bai-viet-cong-nghe.chn\nhttps://vt.tiktok.com/ZSr...`}
            className="rounded-xl font-mono text-xs p-3 bg-slate-50 border-slate-200"
          />
        </Form.Item>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Form.Item
            name="intervalMinutes"
            label={
              <span className="font-bold text-slate-700 flex items-center gap-1">
                <ClockCircleOutlined className="text-emerald-600" /> Khoảng cách đăng bài (Giãn thời gian)
              </span>
            }
            rules={[{ required: true }]}
          >
            <Select size="large" className="rounded-xl">
              <Option value={1}>⚡ 1 phút / bài (Siêu tốc)</Option>
              <Option value={2}>⚡ 2 phút / bài (Nhanh - tự động cuốn chiếu)</Option>
              <Option value={3}>⚡ 3 phút / bài (Khuyên dùng - tối ưu)</Option>
              <Option value={5}>⏱ 5 phút / bài</Option>
              <Option value={10}>⏱ 10 phút / bài</Option>
              <Option value={15}>⏱ 15 phút / bài</Option>
              <Option value={20}>⏱ 20 phút / bài</Option>
              <Option value={30}>⏱ 30 phút / bài</Option>
              <Option value={60}>⏱ 1 giờ / bài</Option>
              <Option value={120}>⏱ 2 giờ / bài</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="postingTarget"
            label={
              <span className="font-bold text-slate-700 flex items-center gap-1">
                <UserOutlined className="text-indigo-600" /> Chọn Đối Tượng Đăng Bài
              </span>
            }
            rules={[{ required: true }]}
          >
            <Select
              size="large"
              className="rounded-xl"
              onChange={(val) => {
                setTargetType(val as any);
                // Danh sách Fanpage/Nick hợp lệ khác nhau giữa 2 chế độ (GROUP chỉ nhận PERSONAL_COOKIE)
                // — xóa lựa chọn cũ để tránh giữ lại 1 giá trị không còn hợp lệ ở chế độ mới.
                form.setFieldValue('targetFanpageId', undefined);
                setSelectedFanpageAccountType(undefined);
              }}
            >
              <Option value="FANPAGE">🚩 Fanpage / Nick đã kết nối (đăng lên tường)</Option>
              <Option value="GROUP">👥 Group Facebook (đăng thẳng vào Group)</Option>
              <Option value="TIKTOK">🎵 Kênh TikTok (Tự động đăng Video)</Option>
              <Option value="THREADS">🧵 Tài khoản Threads (Tự động đăng bài)</Option>
            </Select>
          </Form.Item>
        </div>

        {targetType === 'FANPAGE' && (
          <Form.Item
            name="targetFanpageId"
            label={<span className="font-semibold text-slate-700">Chọn Fanpage Mục Tiêu</span>}
            rules={[{ required: true, message: 'Vui lòng chọn Fanpage!' }]}
          >
            <Select
              size="large"
              className="rounded-xl"
              placeholder="Chọn Fanpage..."
              onChange={(val: string) => {
                const acc = socialAccounts?.find((a) => `${a.platformAccountId}:${a.accountType || 'PAGE_TOKEN'}:${a.id}` === val);
                setSelectedFanpageAccountType(acc?.accountType);
              }}
            >
              {socialAccounts?.filter((acc) => acc.platform === 'FACEBOOK_PAGE').map((acc) => {
                const val = `${acc.platformAccountId}:${acc.accountType || 'PAGE_TOKEN'}:${acc.id}`;
                const isPlaywright = acc.accountType === 'PERSONAL_COOKIE' || !acc.accountType;
                const label = isPlaywright
                  ? `🎭 ${acc.pageName || acc.platformAccountId} — Playwright Cookie #${acc.id}`
                  : `⚡ ${acc.pageName || acc.platformAccountId} — Graph API (Meta Official)`;
                return (
                  <Option key={acc.id} value={val}>
                    {label}
                  </Option>
                );
              })}
            </Select>
          </Form.Item>
        )}

        {targetType === 'TIKTOK' && (
          <Form.Item
            name="targetFanpageId"
            label={<span className="font-semibold text-slate-700">Chọn Kênh TikTok Mục Tiêu</span>}
            rules={[{ required: true, message: 'Vui lòng chọn Kênh TikTok!' }]}
          >
            <Select
              size="large"
              className="rounded-xl"
              placeholder="Chọn Kênh TikTok..."
            >
              {socialAccounts?.filter((acc) => acc.platform === 'TIKTOK' || acc.accountType === 'TIKTOK_COOKIE').map((acc) => {
                const val = `${acc.platformAccountId}:${acc.accountType || 'TIKTOK_COOKIE'}:${acc.id}`;
                return (
                  <Option key={acc.id} value={val}>
                    🎵 {acc.pageName || acc.platformAccountId} — TikTok Playwright Cookie #{acc.id}
                  </Option>
                );
              })}
            </Select>
          </Form.Item>
        )}

        {targetType === 'THREADS' && (
          <Form.Item
            name="targetFanpageId"
            label={<span className="font-semibold text-slate-700">Chọn Tài khoản Threads Mục Tiêu</span>}
            rules={[{ required: true, message: 'Vui lòng chọn tài khoản Threads!' }]}
            extra={<span className="text-xs text-slate-400">Threads giới hạn 500 ký tự & tối đa 10 ảnh/video mỗi bài — nội dung dài hơn sẽ tự cắt bớt.</span>}
          >
            <Select
              size="large"
              className="rounded-xl"
              placeholder="Chọn tài khoản Threads..."
            >
              {socialAccounts?.filter((acc) => acc.platform === 'THREADS' || acc.accountType === 'THREADS_COOKIE').map((acc) => {
                const val = `${acc.platformAccountId}:${acc.accountType || 'THREADS_COOKIE'}:${acc.id}`;
                return (
                  <Option key={acc.id} value={val}>
                    🧵 {acc.pageName || acc.platformAccountId} — Threads Playwright Cookie #{acc.id}
                  </Option>
                );
              })}
            </Select>
          </Form.Item>
        )}

        {targetType === 'FANPAGE' && selectedFanpageAccountType === 'PERSONAL_COOKIE' && (
          <Form.Item
            name="groupNames"
            label={<span className="font-semibold text-slate-700">👥 Chia sẻ thêm vào Group (Tùy chọn, chỉ áp dụng khi đăng Video)</span>}
            extra={<span className="text-xs text-slate-400">Chỉ hoạt động khi bài có kèm Video (đăng dạng Reel qua Playwright). Gõ tên Group rồi nhấn Enter để thêm.</span>}
          >
            <Select mode="tags" size="large" className="rounded-xl" placeholder="Vd: Đảo Mèo, Đảo Mèo 2..." open={false} suffixIcon={null} />
          </Form.Item>
        )}

        <Form.Item
          name="affiliateLink"
          label={
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <LinkOutlined className="text-orange-500" /> Link Affiliate (Tùy chọn — mỗi dòng 1 link)
            </span>
          }
          extra={<span className="text-xs text-slate-400">Link sẽ tự động comment vào từng bài. Điền 1 link thì cả 50 bài dùng chung link đó. Điền nhiều link (mỗi dòng 1 link) thì hệ thống tự xoay vòng: bài 1 dùng link 1, bài 2 dùng link 2,... hết vòng quay lại link 1.</span>}
        >
          <TextArea
            rows={3}
            placeholder={'Vd:\nhttps://shope.ee/abc123\nhttps://shope.ee/xyz456'}
            className="rounded-xl font-mono text-xs"
          />
        </Form.Item>

        {targetType === 'GROUP' && (
          <>
            <Form.Item
              name="targetFanpageId"
              label={<span className="font-semibold text-slate-700">Đăng vào Group dưới danh nghĩa</span>}
              rules={[{ required: true, message: 'Vui lòng chọn danh tính đăng bài!' }]}
              extra={<span className="text-[11px] text-slate-500">Facebook chỉ cho phép đăng vào Group bằng cookie tài khoản cá nhân (không dùng được Graph API Token).</span>}
            >
              <Select size="large" className="rounded-xl" placeholder="Chọn Fanpage/Nick (Playwright Cookie)...">
                {socialAccounts
                  ?.filter((acc) => acc.platform === 'FACEBOOK_PAGE' && (acc.accountType === 'PERSONAL_COOKIE' || !acc.accountType))
                  .map((acc) => {
                    const val = `${acc.platformAccountId}:${acc.accountType || 'PERSONAL_COOKIE'}:${acc.id}`;
                    return (
                      <Option key={acc.id} value={val}>
                        🎭 {acc.pageName || acc.platformAccountId} — Playwright Cookie #{acc.id}
                      </Option>
                    );
                  })}
              </Select>
            </Form.Item>

            <Form.Item
              name="groupId"
              label={<span className="font-semibold text-slate-700">Chọn Group Facebook Mục Tiêu (Có thể chọn nhiều Group)</span>}
              rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 Group Facebook!' }]}
            >
              <Select
                mode="multiple"
                size="large"
                className="rounded-xl"
                placeholder="Bấm chọn 1 hoặc nhiều Group (Vd: Chọn cả Đảo Mèo 1 & 2)..."
                showSearch
                optionFilterProp="label"
                allowClear
              >
                {socialAccounts
                  ?.filter((acc) => acc.platform === 'FACEBOOK_GROUP')
                  .map((acc) => (
                    <Option key={acc.id} value={acc.platformAccountId} label={`${acc.pageName || acc.platformAccountId} ${acc.platformAccountId}`}>
                      👥 {acc.pageName || acc.platformAccountId} (ID: {acc.platformAccountId})
                    </Option>
                  ))}
              </Select>
            </Form.Item>
          </>
        )}

        <Card size="small" className="bg-slate-50 border border-slate-200 rounded-xl p-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <Form.Item name="publishNow" valuePropName="checked" className="!mb-0">
                <Switch />
                <span className="ml-2 font-bold text-slate-800 text-sm">Đăng 1 bài ngay lập tức, các bài còn lại giãn cách</span>
              </Form.Item>
              <Text className="text-xs text-slate-500 block mt-1">
                Nếu tắt: bài đầu tiên sẽ bắt đầu vào Ngày & Giờ đã chọn bên dưới.
              </Text>

              <div className="mt-3 pt-3 border-t border-slate-200">
                <Form.Item name="fitToday" valuePropName="checked" className="!mb-0" initialValue={true}>
                  <Switch defaultChecked />
                  <span className="ml-2 font-bold text-amber-600 text-sm">⚡ Tự động tính khoảng cách để đăng hết trong hôm nay</span>
                </Form.Item>
                <Text className="text-xs text-slate-500 block mt-1">
                  Tự động chia đều giờ từ bây giờ tới 23:59, đảm bảo 100% bài không bị tràn sang ngày mai.
                </Text>
              </div>
            </div>

            <Form.Item name="scheduledAt" label={<span className="font-semibold text-xs text-slate-600">Thời điểm bắt đầu bài 1</span>} className="!mb-0">
              <DatePicker
                showTime
                format="YYYY-MM-DD HH:mm"
                className="rounded-lg"
                placeholder="Chọn thời điểm bài 1"
              />
            </Form.Item>
          </div>
        </Card>

        <div className="pt-2 flex items-center justify-end gap-3">
          <Button onClick={onClose} size="large" className="rounded-xl">
            Hủy
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={batchMutation.isPending}
            icon={<SendOutlined />}
            className="bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl px-8 border-none"
          >
            Tạo Lịch Đăng Hàng Loạt
          </Button>
        </div>
      </Form>
    </Modal>
  );
};
