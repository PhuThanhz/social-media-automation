import React from 'react';
import {
  Drawer,
  Tag,
  Button,
  Image,
  message, Flex,
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
          bg: 'pdm-badge-published',
        };
      case 'PROCESSING':
        return {
          label: 'ĐANG XỬ LÝ',
          color: 'purple',
          icon: <LoadingOutlined spin />,
          bg: 'pdm-badge-processing',
        };
      case 'FAILED':
        return {
          label: 'THẤT BẠI',
          color: 'rose',
          icon: <CloseCircleOutlined />,
          bg: 'pdm-badge-failed',
        };
      case 'PENDING':
      default:
        return {
          label: 'CHỜ ĐĂNG',
          color: 'sky',
          icon: <ClockCircleOutlined />,
          bg: 'pdm-badge-pending',
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
      <div className="pdm-shell">
        {/* Top Header Bar */}
        <div className="pdm-header">
          <Flex align="center" justify="space-between" gap={16} wrap>
            {/* Left: Pink Close Button + Titles */}
            <Flex align="center" gap={14} className="pdm-head-main">
              <button
                onClick={onClose}
                type="button"
                title="Đóng (Esc)"
                className="pdm-close-btn"
              >
                <CloseOutlined className="pdm-close-x" />
              </button>

              <div className="pdm-head-text">
                <Flex align="center" gap={8} wrap>
                  <span className="pdm-live-label">
                    <span className="pdm-live-dot"></span>
                    BÀI VIẾT #{post.id}
                  </span>
                  <span
                    className={`pdm-badge ${statusBadge.bg}`}
                  >
                    {statusBadge.icon}
                    {statusBadge.label}
                  </span>
                </Flex>

                <h1 className="pdm-title">
                  {post.title || `Bài viết #${post.id}`}
                </h1>

                <div className="pdm-meta">
                  {resolvePosterIdentity() && (
                    <>
                      <span className="pdm-meta-muted">Đăng bởi nick:</span>
                      <span className="pdm-meta-channel">
                        <FacebookOutlined /> {resolvePosterIdentity()}
                      </span>
                      <span className="pdm-meta-sep">•</span>
                    </>
                  )}
                  {groupList.length > 0 && (
                    <>
                      <span className="pdm-meta-muted">Đăng vào:</span>
                      <span className="pdm-meta-campaign">
                        {groupList.map(resolveGroupName).join(', ')}
                      </span>
                      <span className="pdm-meta-sep">•</span>
                    </>
                  )}
                  <span className="pdm-meta-muted">Hẹn giờ:</span>
                  <span className="pdm-meta-time">
                    {post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm DD/MM/YYYY') : 'Đăng ngay'}
                  </span>
                  {post.publishedAt && (
                    <>
                      <span className="pdm-meta-sep">•</span>
                      <span className="pdm-meta-muted">Đã đăng:</span>
                      <span className="pdm-meta-ok">
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
                              <span className="pdm-meta-sep">•</span>
                              <span className="pdm-meta-muted">Thời lượng đăng:</span>
                              <span className="pdm-meta-id">
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
            </Flex>

            {/* Right: Actions */}
            <Flex align="center" gap={8} wrap>
              {onDiagnose && (
                <Button
                  size="middle"
                  icon={<HistoryOutlined />}
                  onClick={() => {
                    onDiagnose(post);
                    onClose();
                  }}
                  className="pdm-btn-default"
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
                  className="pdm-btn-blue"
                >
                  Mở bài Facebook
                </Button>
              )}
              <Button
                size="middle"
                icon={<CopyOutlined />}
                onClick={handleCopyCaption}
                className="pdm-btn-default"
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
                  className="pdm-btn-repost"
                >
                  Đăng lại bài
                </Button>
              )}
            </Flex>
          </Flex>
        </div>

        {/* Scrollable Body */}
        <div className="custom-modal-scrollbar pdm-body">
          {/* Lỗi nếu có */}
          {post.errorMessage && (
            <div className="pdm-error">
              <WarningOutlined className="pdm-error-ic" />
              <div className="pdm-stack-1">
                <div className="pdm-error-title">
                  Thông báo lỗi hệ thống:
                </div>
                <div className="pdm-error-text">
                  {post.errorMessage}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 1: MEDIA (VIDEO & ALBUM ẢNH) */}
          <div className="pdm-section">
            <Flex align="center" justify="space-between">
              <div className="pdm-section-title">
                <span className="pdm-section-bar"></span>
                <span>VIDEO & HÌNH ẢNH ĐÍNH KÈM</span>
              </div>
              <div className="pdm-section-meta">
                {videoUrls.length > 0 && (
                  <Tag color="purple" className="pdm-tag-bold">
                    🎥 {videoUrls.length} Video
                  </Tag>
                )}
                {photoUrls.length > 0 && (
                  <Tag color="blue" className="pdm-tag-bold">
                    🖼️ {photoUrls.length} Ảnh
                  </Tag>
                )}
              </div>
            </Flex>

            {videoUrls.length === 0 && photoUrls.length === 0 ? (
              <div className="pdm-media-empty">
                Bài viết này không có video hoặc hình ảnh đính kèm
              </div>
            ) : (
              <div className="pdm-stack-4">
                {/* Video Player */}
                {videoUrls.map((vUrl, vIdx) => (
                  <div
                    key={`v-${vIdx}`}
                    className="pdm-video-card"
                  >
                    <div className="pdm-video-frame">
                      <video
                        src={vUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="pdm-video"
                      />
                    </div>
                  </div>
                ))}

                {/* Album ảnh */}
                {photoUrls.length > 0 && (
                  <div className="pdm-images-card">
                    <div className="pdm-images-head">
                      <span className="pdm-images-head-label">
                        <FileImageOutlined className="pdm-ic-blue" /> Album ảnh đính kèm:
                      </span>
                      <span className="pdm-images-count">
                        (Click vào ảnh để phóng to toàn màn hình)
                      </span>
                    </div>
                    <Image.PreviewGroup>
                      <div className="pdm-images-grid">
                        {photoUrls.map((pUrl, pIdx) => (
                          <div
                            key={`p-${pIdx}`}
                            className="pdm-image-tile"
                          >
                            <Image
                              src={pUrl}
                              alt={`photo-${pIdx}`}
                              className="group-hover:scale-105 pdm-image"
                            />
                            <span className="pdm-image-index">
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
          <div className="pdm-section">
            <Flex align="center" justify="space-between">
              <div className="pdm-section-title">
                <span className="pdm-section-bar"></span>
                <span>NỘI DUNG CAPTION BÀI VIẾT</span>
              </div>
              <div className="pdm-text-11-muted">
                {sanitizeDuplicateCaption(post.content || post.title || '').length} ký tự
              </div>
            </Flex>

            <div className="pdm-content">
              {sanitizeDuplicateCaption(post.content || post.title || '') || (
                <span className="pdm-content-empty">Không có nội dung văn bản</span>
              )}
            </div>
          </div>

          {/* SECTION 3: BÌNH LUẬN TỰ ĐỘNG & AFFILIATE */}
          {post.affiliateLink && (
            <div className="pdm-section">
              <div className="pdm-section-title">
                <span className="pdm-section-bar"></span>
                <span>BÌNH LUẬN TỰ ĐỘNG (AFFILIATE / ĐIỀU HƯỚNG)</span>
              </div>
              <div className="pdm-comment">
                <Flex align="center" gap={10}>
                  <MessageOutlined className="pdm-comment-ic" />
                  <span className="pdm-comment-text">{post.affiliateLink}</span>
                </Flex>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(post.affiliateLink || '');
                    message.success('Đã sao chép link bình luận');
                  }}
                  className="pdm-comment-btn"
                >
                  Copy Link
                </Button>
              </div>
            </div>
          )}

          {/* SECTION 4: THÔNG TIN KÊNH ĐÍCH & NGUỒN GỐC */}
          <div className="pdm-section">
            <div className="pdm-section-title">
              <span className="pdm-section-bar"></span>
              <span>THÔNG TIN XUẤT BẢN & LIÊN KẾT GỐC</span>
            </div>

            <div className="pdm-info-grid">
              {/* Nhóm Facebook đích */}
              <div className="pdm-info-card">
                <span className="pdm-info-label">
                  <TeamOutlined className="pdm-ic-purple" /> Nhóm Facebook đăng tải:
                </span>
                <div className="pdm-info-value">
                  {groupList.length > 0 ? (
                    <Flex gap={8} wrap className="pdm-chips">
                      {groupList.map((rawId, gIdx) => {
                        const resolvedName = resolveGroupName(rawId);
                        return (
                          <div
                            key={gIdx}
                            className="pdm-chip"
                          >
                            <TeamOutlined className="pdm-ic-purple" />
                            <span className="pdm-chip-name">{resolvedName}</span>
                            {resolvedName !== rawId && (
                              <span className="pdm-chip-id">
                                ID: {rawId}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </Flex>
                  ) : (
                    <span className="pdm-empty-italic">Chỉ đăng lên Fanpage (không đăng vào nhóm)</span>
                  )}
                </div>
              </div>

              {/* Link nguồn gốc */}
              <div className="pdm-info-card-col">
                <span className="pdm-info-label">
                  <LinkOutlined className="pdm-ic-blue" /> Liên kết bài viết gốc:
                </span>
                {post.originalUrl ? (
                  <a
                    href={post.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pdm-link"
                  >
                    {post.originalUrl}
                  </a>
                ) : (
                  <span className="pdm-content-empty">Không có link gốc</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bar cố định dưới cùng */}
        <div className="pdm-footer">
          <div>
            Định danh bài viết: <span className="pdm-footer-strong">#{post.id}</span>
          </div>
          <Button
            type="primary"
            onClick={onClose}
            className="pdm-footer-btn"
          >
            Đóng cửa sổ
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default PostDetailModal;
