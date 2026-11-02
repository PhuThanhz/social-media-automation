// Đăng video vừa xuất thẳng lên kênh TikTok đã kết nối (cookie) — chọn kênh, sửa caption, bấm đăng.
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import { LoadingOutlined, CheckCircleFilled } from '@ant-design/icons';
import api from '../../config/axios';

interface Channel { id: number; name: string }

const TikTokIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.6c.27 0 .53.04.78.12V9.75a5.7 5.7 0 0 0-.78-.05A5.69 5.69 0 1 0 15.55 15.4V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.25-1.48Z" /></svg>
);

export default function TikTokPublish({ videoUrl, defaultCaption, onOpenConnections }: { videoUrl: string; defaultCaption: string; onOpenConnections: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState<number | null>(() => Number(localStorage.getItem('videoEditor.tiktokChannel')) || null);
  const [caption, setCaption] = useState(defaultCaption);
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; text: string; warning?: string }>({ status: 'idle', text: '' });

  useEffect(() => {
    api.get('/connections').then((r) => {
      const list: Channel[] = (Array.isArray(r.data) ? r.data : [])
        .filter((a: { platform?: string; accountType?: string }) => String(a.platform).toUpperCase() === 'TIKTOK' || String(a.accountType).toUpperCase() === 'TIKTOK_COOKIE')
        .map((a: { id: number; pageName?: string; platformAccountId?: string }) => ({ id: a.id, name: a.pageName || a.platformAccountId || `Kênh #${a.id}` }));
      setChannels(list);
      setChannelId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list[0]?.id ?? null));
    }).catch(() => setChannels([]));
  }, []);

  const publish = async () => {
    if (!channelId) return;
    localStorage.setItem('videoEditor.tiktokChannel', String(channelId));
    setState({ status: 'running', text: 'Đang gửi video sang TikTok…' });
    try {
      const res = await api.post('/video-studio/post-tiktok', { accountId: channelId, videoUrl, caption }, { timeout: 30000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      const jobId = res.data.jobId as string;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = (await api.get(`/video-studio/render-project/${jobId}`, { timeout: 15000 })).data || {};
        if (j.status === 'done') { setState({ status: 'done', text: j.message || 'Đã đăng lên TikTok', warning: j.warning }); return; }
        if (j.status === 'error') throw new Error(j.error || 'Đăng TikTok lỗi');
        setState({ status: 'running', text: 'TikTok đang tải và xử lý video… (có thể mất 1–3 phút)' });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setState({ status: 'error', text: err?.response?.data?.error || err?.message || 'Đăng TikTok lỗi' });
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-semibold"><TikTokIcon /> Đăng lên TikTok</div>
      {channels === null ? (
        <div className="text-[12px] text-slate-400"><LoadingOutlined /> Đang tải danh sách kênh…</div>
      ) : channels.length === 0 ? (
        <Alert type="info" showIcon className="!text-[12px]" message="Chưa kết nối kênh TikTok nào"
          description={<Button size="small" onClick={onOpenConnections}>Kết nối kênh TikTok</Button>} />
      ) : state.status === 'done' ? (
        <Alert type={state.warning ? 'warning' : 'success'} showIcon icon={state.warning ? undefined : <CheckCircleFilled className="text-emerald-400" />} message={state.text} description={state.warning} />
      ) : (
        <>
          <Select size="small" className="w-full" value={channelId ?? undefined} onChange={setChannelId} options={channels.map((c) => ({ value: c.id, label: c.name }))} disabled={state.status === 'running'} />
          <Input.TextArea value={caption} onChange={(e) => setCaption(e.target.value)} autoSize={{ minRows: 3, maxRows: 7 }} maxLength={2200} showCount placeholder="Caption + hashtag cho TikTok" disabled={state.status === 'running'} />
          {state.status === 'error' && <Alert type="error" showIcon className="!text-[12px]" message={state.text} />}
          {state.status === 'running' && <div className="text-[12px] text-slate-400"><LoadingOutlined /> {state.text}</div>}
          <Button type="primary" block icon={<TikTokIcon />} loading={state.status === 'running'} disabled={!channelId} onClick={publish}>
            {state.status === 'error' ? 'Thử đăng lại' : 'Đăng ngay'}
          </Button>
        </>
      )}
    </div>
  );
}
