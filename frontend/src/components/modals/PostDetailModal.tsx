import React from 'react';
import {
  Drawer,
  Tag,
  Button,
  Image,
  message,
} from 'antd';
import {
  CloseOutlined,
  CopyOutlined,
  LinkOutlined,
  RedoOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  FileImageOutlined,
  MessageOutlined,
  TeamOutlined,
  HistoryOutlined,
  FacebookOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import api from '../../config/axios';

export interface PostQueueItem {
  id: number;
  originalUrl?: string;
  title?: string;
  content?: string;
  mediaUrls?: string;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  scheduledAt?: string;
  publishedAt?: string;
  errorMessage?: string;
  targetFanpageId?: string;
  targetGroupNames?: string;
  affiliateLink?: string;
  publishedPostUrl?: string;
  publishedGroupPostUrls?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SocialAccount {
  id: number;
  platformAccountId: string;
  pageName: string;
  platform: string;
  postingIdentityAccountId?: number;
}

function sanitizeDuplicateCaption(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split('\n');
  const dedupeLines: string[] = [];
  for (const l of lines) {
    const tr = l.trim();
    if (dedupeLines.length > 0 && dedupeLines[dedupeLines.length - 1].trim() === tr && tr.length > 0) {
      continue;
    }
    dedupeLines.push(l);
  }
  const paras = dedupeLines.join('\n').split(/\n\s*\n/);
  const dedupeParas: string[] = [];
  for (const p of paras) {
    const tr = p.trim();
    if (!tr) continue;
    if (dedupeParas.length > 0 && dedupeParas[dedupeParas.length - 1].trim() === tr) {
      continue;
    }
    dedupeParas.push(tr);
  }
  return dedupeParas.join('\n\n').trim();
}

interface PostDetailModalProps {
  open: boolean;
  post: PostQueueItem | null;
  onClose: () => void;
  onDiagnose?: (post: PostQueueItem) => void;
  onRepost?: (post: PostQueueItem) => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({
  open,
  post,
  onClose,
  onDiagnose,
  onRepost,
}) => {
  // Lấy danh sách kết nối Fanpage / Group để quy đổi ID thành Tên thật hiển thị
  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const res = await api.get('/connections');
      return res.data;
    },
    staleTime: 60000,
    enabled: open && !!post,
  });

  if (!post) return null;

  const resolveGroupName = (raw: string) => {
    if (!raw) return '';
    const trimmed = raw.trim();
    const matched = (socialAccounts || []).find(
      (a) => a.platformAccountId === trimmed || String(a.id) === trimmed
    );
    if (matched && matched.pageName) {
      return matched.pageName;
    }
    return trimmed;
  };

  const resolvePosterIdentity = () => {
    if (post.targetFanpageId) {
      const raw = post.targetFanpageId.trim();
      const parts = raw.split(':');

      if (parts.length >= 3) {
        const dbId = parts[2].trim();
        const platformId = parts[0].trim();
        const matched = (socialAccounts || []).find(
          (a) => String(a.id) === dbId || a.platformAccountId === platformId
        );
        if (matched?.pageName) return matched.pageName;
      }

      if (parts.length === 2) {
        const part1 = parts[1].trim();
        if (part1 && part1 !== 'PERSONAL_COOKIE' && part1 !== 'PAGE_TOKEN') {
          return part1;
        }
        const platformId = parts[0].trim();
        const matched = (socialAccounts || []).find(
          (a) => a.platformAccountId === platformId || String(a.id) === platformId
        );
        if (matched?.pageName) return matched.pageName;
      }

      const matched = (socialAccounts || []).find(
        (a) => String(a.id) === raw || a.platformAccountId === raw || a.platformAccountId === parts[0]
      );
      if (matched?.pageName) return matched.pageName;
    }

    if (post.targetGroupNames && (socialAccounts || []).length > 0) {
      const isGroupOnly = post.targetGroupNames.startsWith('GROUP_ONLY:');
      const rawGroupNames = isGroupOnly ? post.targetGroupNames.replace('GROUP_ONLY:', '') : post.targetGroupNames;
      const firstGroupIdOrName = rawGroupNames.split(',')[0]?.trim();

      if (firstGroupIdOrName) {
        const groupAccount = (socialAccounts || []).find(
          (a) => a.platform === 'FACEBOOK_GROUP' &&
                 (a.platformAccountId === firstGroupIdOrName ||
                  a.pageName?.toLowerCase() === firstGroupIdOrName.toLowerCase() ||
                  String(a.id) === firstGroupIdOrName)
        );
        if (groupAccount?.postingIdentityAccountId) {
          const identityAccount = (socialAccounts || []).find((a) => a.id === groupAccount.postingIdentityAccountId);
          if (identityAccount?.pageName) return identityAccount.pageName;
        }
      }
    }

    const defaultPage = (socialAccounts || []).find((a) => a.platform === 'FACEBOOK_PAGE');
    return defaultPage?.pageName || null;
  };

  const rawMediaUrls = (post.mediaUrls || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const isVideoUrl = (u: string) =>
    /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(u);

  const videoUrls = rawMediaUrls.filter(isVideoUrl);
  const photoUrls = rawMediaUrls.filter((u) => !isVideoUrl(u));

  const isGroupOnly = post.targetGroupNames?.startsWith('GROUP_ONLY:');
  const cleanGroupNames = isGroupOnly
    ? post.targetGroupNames?.replace('GROUP_ONLY:', '')
    : post.targetGroupNames;
  const groupList = (cleanGroupNames || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const handleCopyCaption = () => {
    const text = post.content || post.title || '';
    if (!text) {
      message.info('Không có nội dung để sao chép');
      return;
    }
    navigator.clipboard.writeText(text);
    message.success('Đã sao chép nội dung Caption vào bộ nhớ tạm');
  };

  const getStatusBadge = () => {
    switch (post.status) {
      case 'PUBLISHED':
        return {
          label: 'ĐÃ XUẤT BẢN',
          color: 'emerald',
          icon: <CheckCircleOutlined />,
          bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        };
      case 'PROCESSING':
        return {
          label: 'ĐANG XỬ LÝ',
          color: 'purple',
          icon: <LoadingOutlined spin />,
          bg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        };
      case 'FAILED':
        return {
          label: 'THẤT BẠI',
          color: 'rose',
          icon: <CloseCircleOutlined />,
          bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        };
      case 'PENDING':
      default:
        return {
          label: 'CHỜ ĐĂNG',
          color: 'sky',
          icon: <ClockCircleOutlined />,
          bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
        };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="large"
      placement="right"
      closable={false}
      maskClosable={true}
      destroyOnHidden
      styles={{
        body: {
          padding: 0,
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          overflow: 'hidden',
        },
        wrapper: {
          width: 'calc(100vw - 72px)',
          maxWidth: '100vw',
          boxShadow: '-15px 0 40px rgba(0,0,0,0.6)',
        },
      }}
    >
      <div className="flex flex-col h-full bg-[#0b1120] text-slate-100 select-text">
        {/* Top Header Bar */}
        <div className="shrink-0 px-6 py-4 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Left: Pink Close Button + Titles */}
            <div className="flex items-center gap-3.5 min-w-0">
              <button
                onClick={onClose}
                type="button"
                title="Đóng (Esc)"
                className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white shadow-md transition cursor-pointer"
              >
                <CloseOutlined className="text-xs font-black" />
              </button>

              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block animate-pulse"></span>
                    BÀI VIẾT #{post.id}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.2 rounded-full border ${statusBadge.bg} flex items-center gap-1`}
                  >
                    {statusBadge.icon}
                    {statusBadge.label}
                  </span>
                </div>

                <h1 className="text-lg sm:text-xl font-bold text-slate-50 tracking-tight truncate !mb-0 max-w-2xl">
                  {post.title || `Bài viết #${post.id}`}
                </h1>

                <div className="flex items-center gap-2 text-xs text-slate-400 pt-0.5 flex-wrap">
                  {resolvePosterIdentity() && (
                    <>
                      <span className="text-slate-500">Đăng bởi nick:</span>
                      <span className="text-blue-400 font-bold flex items-center gap-1">
                        <FacebookOutlined /> {resolvePosterIdentity()}
                      </span>
                      <span className="text-slate-600">•</span>
                    </>
                  )}
                  {groupList.length > 0 && (
                    <>
                      <span className="text-slate-500">Đăng vào:</span>
                      <span className="text-purple-300 font-bold">
                        {groupList.map(resolveGroupName).join(', ')}
                      </span>
                      <span className="text-slate-600">•</span>
                    </>
                  )}
                  <span className="text-slate-500">Hẹn giờ:</span>
                  <span className="text-slate-300 font-medium">
                    {post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm DD/MM/YYYY') : 'Đăng ngay'}
                  </span>
                  {post.publishedAt && (
                    <>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-500">Đã đăng:</span>
                      <span className="text-emerald-400 font-medium">
                        {dayjs(post.publishedAt).format('HH:mm DD/MM/YYYY')}
                      </span>
                      {(() => {
                        const start = post.createdAt ? dayjs(post.createdAt) : (post.scheduledAt ? dayjs(post.scheduledAt) : null);
                        const end = dayjs(post.publishedAt);
                        if (start && end.isAfter(start)) {
                          const diffSec = end.diff(start, 'second');
                          const text = diffSec < 60 ? `${diffSec}s` : `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
                          return (
                            <>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-500">Thời lượng đăng:</span>
                              <span className="text-emerald-300 font-mono font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                ⏱️ {text}
                              </span>
                            </>
                          );
                        }
                        return null;
                      })()}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {onDiagnose && (
                <Button
                  size="middle"
                  icon={<HistoryOutlined />}
                  onClick={() => {
                    onDiagnose(post);
                    onClose();
                  }}
                  className="rounded-lg bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:bg-slate-700 text-xs font-semibold"
                >
                  Lịch sử log
                </Button>
              )}
              {post.publishedPostUrl && (
                <Button
                  size="middle"
                  icon={<LinkOutlined />}
                  href={post.publishedPostUrl}
                  target="_blank"
                  className="rounded-lg bg-blue-600/20 border-blue-500/40 text-blue-400 hover:text-blue-300 text-xs font-semibold"
                >
                  Mở bài Facebook
                </Button>
              )}
              <Button
                size="middle"
                icon={<CopyOutlined />}
                onClick={handleCopyCaption}
                className="rounded-lg bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:bg-slate-700 text-xs font-semibold"
              >
                Sao chép Caption
              </Button>
              {onRepost && (
                <Button
                  size="middle"
                  type="primary"
                  icon={<RedoOutlined />}
                  onClick={() => {
                    onRepost(post);
                    onClose();
                  }}
                  className="rounded-lg bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 border-none text-white text-xs font-bold shadow-md"
                >
                  Đăng lại bài
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-950/60 custom-modal-scrollbar">
          {/* Lỗi nếu có */}
          {post.errorMessage && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 flex items-start gap-3 shadow-inner">
              <WarningOutlined className="text-rose-400 text-lg shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-xs uppercase tracking-wider text-rose-300">
                  Thông báo lỗi hệ thống:
                </div>
                <div className="text-xs font-mono leading-relaxed text-rose-200">
                  {post.errorMessage}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 1: MEDIA (VIDEO & ALBUM ẢNH) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-rose-400">
                <span className="w-1 h-3.5 rounded-full bg-rose-500 inline-block"></span>
                <span>VIDEO & HÌNH ẢNH ĐÍNH KÈM</span>
              </div>
              <div className="text-xs text-slate-400 font-medium flex items-center gap-2">
                {videoUrls.length > 0 && (
                  <Tag color="purple" className="!m-0 !font-bold">
                    🎥 {videoUrls.length} Video
                  </Tag>
                )}
                {photoUrls.length > 0 && (
                  <Tag color="blue" className="!m-0 !font-bold">
                    🖼️ {photoUrls.length} Ảnh
                  </Tag>
                )}
              </div>
            </div>

            {videoUrls.length === 0 && photoUrls.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
                Bài viết này không có video hoặc hình ảnh đính kèm
              </div>
            ) : (
              <div className="space-y-4">
                {/* Video Player */}
                {videoUrls.map((vUrl, vIdx) => (
                  <div
                    key={`v-${vIdx}`}
                    className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col items-center justify-center shadow-lg"
                  >
                    <div className="relative max-w-md w-full rounded-lg overflow-hidden bg-black border border-slate-700/60 shadow-xl flex items-center justify-center">
                      <video
                        src={vUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-[320px] object-contain mx-auto"
                      />
                    </div>
                  </div>
                ))}

                {/* Album ảnh */}
                {photoUrls.length > 0 && (
                  <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl shadow-lg space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
                      <span className="flex items-center gap-1.5">
                        <FileImageOutlined className="text-blue-400" /> Album ảnh đính kèm:
                      </span>
                      <span className="text-[11px] text-slate-400 font-normal">
                        (Click vào ảnh để phóng to toàn màn hình)
                      </span>
                    </div>
                    <Image.PreviewGroup>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {photoUrls.map((pUrl, pIdx) => (
                          <div
                            key={`p-${pIdx}`}
                            className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-800 group shadow-md flex items-center justify-center"
                          >
                            <Image
                              src={pUrl}
                              alt={`photo-${pIdx}`}
                              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                            />
                            <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[9px] px-1.5 py-0.5 rounded font-mono font-bold pointer-events-none">
                              #{pIdx + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Image.PreviewGroup>
                  </div>
                )}
              </div>
            )}
          </div>



          {/* SECTION 2: CAPTION NỘI DUNG */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-rose-400">
                <span className="w-1 h-3.5 rounded-full bg-rose-500 inline-block"></span>
                <span>NỘI DUNG CAPTION BÀI VIẾT</span>
              </div>
              <div className="text-[11px] text-slate-400">
                {sanitizeDuplicateCaption(post.content || post.title || '').length} ký tự
              </div>
            </div>

            <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-slate-100 whitespace-pre-wrap leading-relaxed shadow-inner max-h-64 overflow-y-auto">
              {sanitizeDuplicateCaption(post.content || post.title || '') || (
                <span className="text-slate-500 italic">Không có nội dung văn bản</span>
              )}
            </div>
          </div>

          {/* SECTION 3: BÌNH LUẬN TỰ ĐỘNG & AFFILIATE */}
          {post.affiliateLink && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-rose-400">
                <span className="w-1 h-3.5 rounded-full bg-rose-500 inline-block"></span>
                <span>BÌNH LUẬN TỰ ĐỘNG (AFFILIATE / ĐIỀU HƯỚNG)</span>
              </div>
              <div className="p-3.5 bg-amber-950/20 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-2.5">
                  <MessageOutlined className="text-amber-400 text-base shrink-0" />
                  <span className="font-mono text-amber-200 break-all">{post.affiliateLink}</span>
                </div>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(post.affiliateLink || '');
                    message.success('Đã sao chép link bình luận');
                  }}
                  className="bg-amber-500/20 border-amber-500/40 text-amber-300 hover:text-amber-200"
                >
                  Copy Link
                </Button>
              </div>
            </div>
          )}

          {/* SECTION 4: THÔNG TIN KÊNH ĐÍCH & NGUỒN GỐC */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-rose-400">
              <span className="w-1 h-3.5 rounded-full bg-rose-500 inline-block"></span>
              <span>THÔNG TIN XUẤT BẢN & LIÊN KẾT GỐC</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Nhóm Facebook đích */}
              <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                <span className="text-slate-400 font-bold flex items-center gap-1.5">
                  <TeamOutlined className="text-purple-400" /> Nhóm Facebook đăng tải:
                </span>
                <div className="text-slate-200 font-medium">
                  {groupList.length > 0 ? (
                    <div className="flex gap-2 flex-wrap pt-0.5">
                      {groupList.map((rawId, gIdx) => {
                        const resolvedName = resolveGroupName(rawId);
                        return (
                          <div
                            key={gIdx}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs font-semibold shadow-sm"
                          >
                            <TeamOutlined className="text-purple-400" />
                            <span className="font-bold text-slate-100">{resolvedName}</span>
                            {resolvedName !== rawId && (
                              <span className="text-[10px] text-purple-400/80 font-mono bg-black/40 px-1.5 py-0.5 rounded">
                                ID: {rawId}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-slate-400 italic">Chỉ đăng lên Fanpage (không đăng vào nhóm)</span>
                  )}
                </div>
              </div>

              {/* Link nguồn gốc */}
              <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5 flex flex-col justify-between">
                <span className="text-slate-400 font-bold flex items-center gap-1.5">
                  <LinkOutlined className="text-blue-400" /> Liên kết bài viết gốc:
                </span>
                {post.originalUrl ? (
                  <a
                    href={post.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 font-semibold truncate underline block pt-1"
                  >
                    {post.originalUrl}
                  </a>
                ) : (
                  <span className="text-slate-500 italic">Không có link gốc</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bar cố định dưới cùng */}
        <div className="shrink-0 px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Định danh bài viết: <span className="font-mono text-slate-200 font-bold">#{post.id}</span>
          </div>
          <Button
            type="primary"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 border-slate-700 font-bold px-6 text-xs h-8"
          >
            Đóng cửa sổ
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default PostDetailModal;
