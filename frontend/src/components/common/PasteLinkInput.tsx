import React from 'react';
import { Input, Button, App, Tag, Modal } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  CloseCircleFilled,
  CheckCircleOutlined,
  FacebookOutlined,
  TikTokOutlined,
} from '@ant-design/icons';

interface PasteLinkInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  className?: string;
  disabled?: boolean;
  autoCleanParams?: boolean;
  showPlatformBadge?: boolean;
  addonAfter?: React.ReactNode;
  inputId?: string;
  autoFocus?: boolean;
}

export const cleanSocialUrl = (rawUrl: string): string => {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  try {
    // Chuẩn hóa domain mobile về www.facebook.com
    url = url.replace(/^https?:\/\/(?:m|mobile|touch|web)\.facebook\.com/i, 'https://www.facebook.com');

    const parsed = new URL(url);

    // Nếu là Facebook multi_permalinks trong Group, chuẩn hóa về đường dẫn bài viết trực tiếp
    const multiPermalinks = parsed.searchParams.get('multi_permalinks');
    const matchGroup = parsed.pathname.match(/\/groups\/([^/?#]+)/);
    if (multiPermalinks && matchGroup) {
      return `https://www.facebook.com/groups/${matchGroup[1]}/posts/${multiPermalinks}/`;
    }

    // Chuẩn hóa /permalink/ thành /posts/ trong nhóm
    if (matchGroup && parsed.pathname.includes('/permalink/')) {
      parsed.pathname = parsed.pathname.replace('/permalink/', '/posts/');
    }

    // Loại bỏ toàn bộ các tham số tracking, bình luận, thông báo của Facebook, TikTok, Threads, UTM...
    const paramsToClean = [
      'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
      'utm_content', 'is_from_webapp', 'sender_device', 'share_id',
      '_r', 'sfnsn', 'mibextid', '__cft__[0]', '__cft__', '__tn__',
      'ref', 'set', 'rdid', 'comment_id', 'reply_comment_id', 'reply_comment_ids',
      'notif_id', 'notif_t', 'paipv', 'idorvanity', 'source', 'refsrc',
      '__eep__', 'locale', 'hc_location', 'substory_index'
    ];
    paramsToClean.forEach((p) => parsed.searchParams.delete(p));

    return parsed.toString().replace(/[?&]$/, '');
  } catch {
    return url;
  }
};

export const detectPlatform = (url?: string): { name: string; color: string; icon?: React.ReactNode } | null => {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('tiktok.com')) return { name: 'TikTok', color: 'magenta', icon: <TikTokOutlined /> };
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return { name: 'Facebook', color: 'blue', icon: <FacebookOutlined /> };
  if (lower.includes('threads.net')) return { name: 'Threads', color: 'purple' };
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return { name: 'YouTube', color: 'red' };
  if (lower.startsWith('http://') || lower.startsWith('https://')) return { name: 'Web Link', color: 'cyan', icon: <LinkOutlined /> };
  return null;
};

const PasteLinkInput: React.FC<PasteLinkInputProps> = ({
  value = '',
  onChange,
  placeholder = 'Dán đường dẫn (URL) vào đây...',
  size = 'large',
  className = '',
  disabled = false,
  autoCleanParams = true,
  showPlatformBadge = true,
  addonAfter,
  inputId,
  autoFocus = false,
}) => {
  const { message } = App.useApp();
  const inputRef = React.useRef<any>(null);
  const [modalVisible, setModalVisible] = React.useState(false);
  const [modalText, setModalText] = React.useState('');
  const platform = showPlatformBadge ? detectPlatform(value) : null;

  const handlePasteFromClipboard = async () => {
    // Thử dùng Clipboard API trước
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          const cleaned = autoCleanParams ? cleanSocialUrl(text) : text.trim();
          onChange?.(cleaned);
          message.success('📋 Đã dán link thành công!');
          return;
        }
      } catch {
        // Trình duyệt chặn do dùng kết nối HTTP (IP 192.168.x.x) -> Chuyển sang Popup dán siêu tốc
      }
    }

    // Mở Modal Dán Siêu Tốc không bị giới hạn bởi quyền HTTP Safari
    setModalText('');
    setModalVisible(true);
  };

  const handleClear = () => {
    onChange?.('');
  };

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-2 w-full">
        <Input
          id={inputId}
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            onChange?.(autoCleanParams && val.startsWith('http') ? cleanSocialUrl(val) : val);
          }}
          placeholder={placeholder}
          size={size}
          disabled={disabled}
          prefix={<LinkOutlined className="text-blue-500 text-base" />}
          suffix={
            value ? (
              <Button
                type="text"
                size="small"
                icon={<CloseCircleFilled className="text-slate-400 hover:text-slate-600 text-base" />}
                onClick={handleClear}
                className="p-0 h-6 min-w-[24px] flex items-center justify-center"
              />
            ) : null
          }
          className={`rounded-xl flex-1 font-medium bg-slate-900/80 border-slate-700/80 text-slate-100 placeholder:text-slate-500 shadow-inner ${className}`}
        />

        <Button
          type="primary"
          size={size}
          icon={<CopyOutlined />}
          onClick={handlePasteFromClipboard}
          disabled={disabled}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shrink-0 px-4 flex items-center gap-1.5 text-xs sm:text-sm shadow-md shadow-indigo-950/40 border border-blue-400/30 transition-all hover:scale-[1.02] active:scale-[0.98] h-10"
        >
          <span>Dán link</span>
        </Button>

        {addonAfter}
      </div>

      {/* MODAL DÁN SIÊU TỐC KHÔNG BỊ CHẶN BỞI HTTP SAFARI */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <CopyOutlined className="text-blue-600 text-base" />
            <span>Dán Link Bài Viết</span>
          </div>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => {
          if (modalText.trim()) {
            const cleaned = autoCleanParams ? cleanSocialUrl(modalText) : modalText.trim();
            onChange?.(cleaned);
            message.success('📋 Đã dán link thành công!');
          }
          setModalVisible(false);
        }}
        okText="Xác nhận Dán"
        cancelText="Hủy"
        centered
        width={520}
        className="max-w-[calc(100vw-24px)]"
        destroyOnHidden
      >
        <div className="space-y-3 py-2">
          <div className="text-xs text-slate-600">
            Bấm giữ vào ô bên dưới rồi chọn <b>"Dán" (Paste)</b>:
          </div>
          <Input.TextArea
            rows={3}
            autoFocus
            value={modalText}
            onChange={(e) => setModalText(e.target.value)}
            placeholder="Dán link Facebook, TikTok, Threads vào đây..."
            className="rounded-xl font-mono text-xs p-3 bg-slate-50"
          />
        </div>
      </Modal>

      {platform && (
        <div className="flex items-center gap-2 text-[11px] px-1">
          <Tag color={platform.color} icon={platform.icon} className="!mr-0 font-bold rounded-md">
            {platform.name}
          </Tag>
          <span className="text-emerald-600 font-medium flex items-center gap-1">
            <CheckCircleOutlined /> Link hợp lệ
          </span>
        </div>
      )}
    </div>
  );
};

export default PasteLinkInput;
