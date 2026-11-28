import { useState } from 'react';
import { Input, Popover, Spin, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import api from '../../config/axios';
import { cleanSocialUrl } from '../common/PasteLinkInput';

interface CheckLinkItem {
  id: number;
  status: string;
  matchedBy: 'SOURCE' | 'PUBLISHED_LINK' | 'GROUP_LINK';
  postType?: string;
  targetName?: string | null;
  targetFanpageId?: string | null;
  targetGroupNames?: string | null;
  groupName?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  publishedPostUrl?: string | null;
  errorMessage?: string | null;
  campaignName?: string | null;
  contentPreview?: string | null;
}

interface CheckLinkInbox {
  id: number;
  status: string;
  sourceName?: string | null;
  foundAt?: string | null;
}

interface CheckLinkResult {
  url: string;
  summary: 'PUBLISHED' | 'QUEUED' | 'FAILED_ONLY' | 'INBOX_ONLY' | 'NOT_FOUND' | 'NOT_A_POST' | 'INVALID';
  items: CheckLinkItem[];
  inbox: CheckLinkInbox[];
}

const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: 'Đã đăng',
  PENDING: 'Đang chờ',
  PROCESSING: 'Đang đăng',
  PENDING_APPROVAL: 'Chờ duyệt',
  NEEDS_REVIEW: 'Cần xem lại',
  FAILED: 'Lỗi',
  CANCELLED: 'Đã hủy',
};

const INBOX_LABEL: Record<string, string> = {
  NEW: 'đang chờ duyệt',
  QUEUED: 'đã đưa vào hàng chờ',
  DISMISSED: 'đã bỏ qua',
};

const fmt = (t?: string | null) => (t ? dayjs(t).format('HH:mm DD/MM/YYYY') : '');

const looksLikeUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\/\S*/i.test(s.trim());

function summaryText(r: CheckLinkResult): string {
  const count = (st: string[]) => r.items.filter((i) => st.includes(i.status)).length;
  const published = count(['PUBLISHED']);
  const queued = r.items.filter((i) => ['PENDING', 'PROCESSING', 'PENDING_APPROVAL', 'NEEDS_REVIEW'].includes(i.status));
  switch (r.summary) {
    case 'PUBLISHED':
      return `Đã đăng ${published} lần${queued.length ? ` · còn ${queued.length} bài đang chờ` : ''}`;
    case 'QUEUED': {
      const next = queued.map((i) => i.scheduledAt).filter(Boolean).sort()[0];
      return `Đang nằm trong hàng chờ (${queued.length} bài)${next ? ` · lịch ${fmt(next)}` : ''}`;
    }
    case 'FAILED_ONLY':
      return 'Có trong tool nhưng chưa đăng được (lỗi hoặc đã hủy)';
    case 'INBOX_ONLY':
      return `Chưa đăng — đang nằm trong Inbox viral (${INBOX_LABEL[r.inbox[0]?.status] || r.inbox[0]?.status})`;
    case 'NOT_A_POST':
      return 'Đây là link nhóm/trang, không phải link một bài cụ thể';
    case 'INVALID':
      return 'Không đọc được link này';
    default:
      return 'Chưa có trong tool — chưa đăng, chưa xếp lịch';
  }
}

/** Ô "Kiểm tra link" trên thanh trên cùng: dán link nguồn hoặc link bài đã đăng → biết bài đã đăng / đang chờ chưa. */
export default function LinkCheckBar() {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['check-link', query],
    queryFn: async () => (await api.get<CheckLinkResult>('/queue/check-link', { params: { url: query } })).data,
    enabled: !!query,
    staleTime: 15_000,
    retry: 1,
  });

  const run = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const cleaned = cleanSocialUrl(v);
    setValue(cleaned);
    setQuery(cleaned);
    setOpen(true);
  };

  const content = (
    <div className="link-check-result">
      {isFetching ? (
        <div className="link-check-loading"><Spin size="small" /> Đang kiểm tra…</div>
      ) : isError ? (
        <div className="link-check-summary is-failed">Không kiểm tra được — backend chưa phản hồi</div>
      ) : data ? (
        <>
          <div className={`link-check-summary is-${data.summary.toLowerCase()}`}>{summaryText(data)}</div>
          {data.items.length > 0 && (
            <ul className="link-check-list">
              {data.items.map((it) => {
                const target = it.groupName || it.targetName || it.targetGroupNames || it.targetFanpageId || '—';
                const when = it.status === 'PUBLISHED' ? fmt(it.publishedAt) : fmt(it.scheduledAt);
                return (
                  <li key={it.id} className="link-check-row">
                    <div className="link-check-row-head">
                      <span className={`link-check-status st-${it.status.toLowerCase()}`}>{STATUS_LABEL[it.status] || it.status}</span>
                      <span className="link-check-target" title={target}>{target}</span>
                      {when && <span className="link-check-when">{when}</span>}
                    </div>
                    {it.contentPreview && <div className="link-check-preview">{it.contentPreview}</div>}
                    {it.status === 'FAILED' && it.errorMessage && <div className="link-check-error">{it.errorMessage}</div>}
                    <div className="link-check-meta">
                      <Typography.Link
                        className="link-check-id"
                        onClick={() => { navigator.clipboard?.writeText(String(it.id)); message.success(`Đã copy mã bài #${it.id}`); }}
                      >
                        #{it.id}
                      </Typography.Link>
                      {it.campaignName && <span>{it.campaignName}</span>}
                      {it.matchedBy !== 'SOURCE' && <span>khớp link đã đăng</span>}
                      {it.publishedPostUrl && (
                        <a href={it.publishedPostUrl} target="_blank" rel="noreferrer">Mở bài</a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {data.inbox.length > 0 && data.summary !== 'INBOX_ONLY' && (
            <div className="link-check-inbox">
              Inbox viral: {INBOX_LABEL[data.inbox[0].status] || data.inbox[0].status}
              {data.inbox[0].sourceName ? ` · ${data.inbox[0].sourceName}` : ''}
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={open && !!query}
      onOpenChange={(o) => { if (!o) setOpen(false); }}
      trigger="click"
      placement="bottomRight"
      content={content}
      arrow={false}
    >
      <Input
        className="link-check-input"
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Dán link để kiểm tra đã đăng chưa…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (!e.target.value) { setQuery(''); setOpen(false); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (looksLikeUrl(text)) { e.preventDefault(); run(text); }
        }}
        onPressEnter={() => run(value)}
        onFocus={() => { if (query) setOpen(true); }}
      />
    </Popover>
  );
}
