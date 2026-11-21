import { memo, useState, useEffect, useRef } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Tag,
  Progress,
  Tooltip,
  Modal,
  App,
} from 'antd';
import {
  LinkOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  RedoOutlined,
  EditOutlined,
  ClearOutlined,
  ArrowLeftOutlined,
  CloseOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  TagOutlined,
  ZoomInOutlined,
  UserOutlined,
  CopyOutlined,
  MenuFoldOutlined,
  InboxOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { PostLinkItem, ItemPreview, SocialAccount } from './types';
import { cleanMarkdownAsterisks, buildExtraGroupOptions, filterSelectByLabel } from './shared';

interface SwipeReviewModalProps {
  onRemoveMedia?: (itemId: string, mediaIndex: number) => void;
  isMediaVideo: (url: string, kind?: string) => boolean;
  setMediaViewer: React.Dispatch<React.SetStateAction<{ url: string; kind: "video" | "image"; title?: string; }>>;
  swipeReviewOpen: boolean;
  setSwipeReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  swipeReviewIndex: number;
  setSwipeReviewIndex: React.Dispatch<React.SetStateAction<number>>;
  swipeMediaIndex: number;
  setSwipeMediaIndex: React.Dispatch<React.SetStateAction<number>>;
  swipeDecisions: Record<string, "KEEP" | "REJECT">;
  swipeReviewItems: PostLinkItem[];
  activeSwipeItem: PostLinkItem;
  activeSwipePreview: ItemPreview;
  activeSwipeMediaUrls: string[];
  activeSwipeMediaKinds: ("video" | "image")[];
  activeSwipeCaption: string;
  handleSwipeDecision: (decision: "KEEP" | "REJECT") => void;
  handleSwipeCaptionChange: (newCaption: string) => void;
  handleApplySwipeReview: () => void;
  replaceOrAppendCreditText: (caption: string, creditText: string) => string;
  openCustomCreModal: (targetItemId?: string) => void;
  openHashtagModal: (targetItemId?: string) => void;
  groupAccountsWithId?: SocialAccount[];
  primaryGroupIds?: string[];
  onExtraGroupIdsChange?: (itemId: string, groupIds: string[]) => void;
}

// Duyệt nhanh từng bài (kiểu Tinder) với Drag cử chỉ thực thụ, Phím tắt siêu tốc & Preload mượt mà
function SwipeReviewModal({
  isMediaVideo,
  setMediaViewer,
  swipeReviewOpen,
  setSwipeReviewOpen,
  swipeReviewIndex,
  setSwipeReviewIndex,
  swipeMediaIndex,
  setSwipeMediaIndex,
  swipeDecisions,
  swipeReviewItems,
  activeSwipeItem,
  activeSwipePreview,
  activeSwipeMediaUrls,
  activeSwipeMediaKinds,
  activeSwipeCaption,
  handleSwipeDecision,
  handleSwipeCaptionChange,
  handleApplySwipeReview,
  replaceOrAppendCreditText,
  openCustomCreModal,
  openHashtagModal,
  groupAccountsWithId = [],
  primaryGroupIds = [],
  onExtraGroupIdsChange,
  onRemoveMedia,
}: SwipeReviewModalProps) {
  const { message } = App.useApp();

  // Local state cho caption để gõ phím cực nhạy, cách ly re-render khỏi trang cha
  const [localCaption, setLocalCaption] = useState(activeSwipeCaption || '');
  const activeItemIdRef = useRef(activeSwipeItem?.id);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đồng bộ caption khi chuyển sang bài viết khác
  useEffect(() => {
    if (activeSwipeItem?.id !== activeItemIdRef.current) {
      activeItemIdRef.current = activeSwipeItem?.id;
      setLocalCaption(activeSwipeCaption || '');
    }
  }, [activeSwipeItem?.id, activeSwipeCaption]);

  // Debounce đẩy dữ liệu lên trang cha (350ms)
  const syncCaptionToParent = (val: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      handleSwipeCaptionChange(val);
    }, 350);
  };

  const handleLocalCaptionChange = (val: string) => {
    setLocalCaption(val);
    syncCaptionToParent(val);
  };

  const flushCaptionToParent = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    handleSwipeCaptionChange(localCaption);
  };

  // Direct DOM Gesture: Thao tác thẻ bài trực tiếp qua ref & requestAnimationFrame (120fps, không gây re-render React)
  const cardRef = useRef<HTMLDivElement>(null);
  const stampKeepRef = useRef<HTMLDivElement>(null);
  const stampRejectRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number } | null>(null);
  const currentDragXRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Quyết định siêu tốc (Zero-latency) cho Phím tắt & Nút bấm — không delay, không giật lag
  const executeSwipeWithAnimation = (decision: 'KEEP' | 'REJECT') => {
    flushCaptionToParent();
    if (cardRef.current) {
      cardRef.current.style.transform = '';
      cardRef.current.classList.remove('is-dragging');
    }
    if (stampKeepRef.current) {
      stampKeepRef.current.style.opacity = '0';
      stampKeepRef.current.style.display = 'none';
    }
    if (stampRejectRef.current) {
      stampRejectRef.current.style.opacity = '0';
      stampRejectRef.current.style.display = 'none';
    }
    handleSwipeDecision(decision);
  };

  // Preload ảnh của 2 bài tiếp theo để chuyển bài với độ trễ bằng 0
  useEffect(() => {
    if (!swipeReviewOpen || !swipeReviewItems || swipeReviewItems.length === 0) return;
    const nextItem1 = swipeReviewItems[swipeReviewIndex + 1];
    const nextItem2 = swipeReviewItems[swipeReviewIndex + 2];
    [nextItem1, nextItem2].forEach((item) => {
      if (item) {
        const urls = item.manualMediaUrls || (item as any).mediaUrls || (item as any).originalMediaUrls || [];
        urls.slice(0, 3).forEach((u: string) => {
          if (u && !isMediaVideo(u)) {
            const img = new Image();
            img.src = u;
          }
        });
      }
    });
  }, [swipeReviewIndex, swipeReviewOpen, swipeReviewItems, isMediaVideo]);

  // Bộ lắng nghe phím tắt thông minh ngay trong Modal Tinder
  useEffect(() => {
    if (!swipeReviewOpen || !activeSwipeItem) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true' ||
        Boolean(activeEl.closest('.ant-select'))
      );

      // Khi người dùng đang gõ phím chỉnh sửa trong textarea:
      if (isInputFocused) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          executeSwipeWithAnimation('KEEP');
        } else if ((e.ctrlKey || e.altKey) && e.key === 'Backspace') {
          e.preventDefault();
          executeSwipeWithAnimation('REJECT');
        }
        return;
      }

      // Khi ở chế độ duyệt nhanh (không focus gõ chữ):
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd' || e.key === 'Enter') {
        e.preventDefault();
        executeSwipeWithAnimation('KEEP');
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        executeSwipeWithAnimation('REJECT');
      } else if (e.key.toLowerCase() === 'z' || e.key === 'Backspace') {
        e.preventDefault();
        if (swipeReviewIndex > 0) {
          flushCaptionToParent();
          setSwipeReviewIndex((c) => Math.max(0, c - 1));
          setSwipeMediaIndex(0);
        }
      } else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeSwipeMediaUrls.length > 1) {
          setSwipeMediaIndex((c) => (c + 1) % activeSwipeMediaUrls.length);
        }
      } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeSwipeMediaUrls.length > 1) {
          setSwipeMediaIndex((c) => (c - 1 + activeSwipeMediaUrls.length) % activeSwipeMediaUrls.length);
        }
      } else if (e.key === ' ' || e.code === 'Space') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
        const currentUrl = activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0];
        if (currentUrl) {
          const kind = isMediaVideo(currentUrl, activeSwipeMediaKinds[swipeMediaIndex]) ? 'video' : 'image';
          if (kind !== 'video') {
            e.preventDefault();
            setMediaViewer({ url: currentUrl, kind, title: `Bài ${swipeReviewIndex + 1} - Media ${swipeMediaIndex + 1}` });
          }
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < activeSwipeMediaUrls.length) {
          e.preventDefault();
          setSwipeMediaIndex(idx);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [swipeReviewOpen, activeSwipeItem?.id, swipeReviewIndex, activeSwipeMediaUrls.length, swipeMediaIndex, isMediaVideo, setMediaViewer, setSwipeMediaIndex, setSwipeReviewIndex, localCaption]);

  // Xử lý kéo vuốt siêu mượt trực tiếp trên DOM (Hardware-Accelerated 120fps Gesture)
  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, button, a, .poster-swipe-thumbnails, .swipe-media-grid, .poster-swipe-caption')) return;
    dragStartRef.current = { startX: e.clientX, startY: e.clientY };
    isDraggingRef.current = true;
    currentDragXRef.current = 0;
    if (cardRef.current) {
      cardRef.current.classList.add('is-dragging');
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaY = e.clientY - dragStartRef.current.startY;
    currentDragXRef.current = deltaX;

    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      if (!cardRef.current) return;
      const deg = Math.max(-16, Math.min(16, deltaX * 0.08));
      cardRef.current.style.transform = `translate3d(${deltaX}px, ${deltaY * 0.25}px, 0) rotate(${deg}deg)`;

      if (stampKeepRef.current) {
        const keepOp = deltaX > 20 ? Math.min(1, (deltaX - 20) / 75) : 0;
        stampKeepRef.current.style.opacity = String(keepOp);
        stampKeepRef.current.style.display = keepOp > 0.02 ? 'block' : 'none';
      }
      if (stampRejectRef.current) {
        const rejectOp = deltaX < -20 ? Math.min(1, (-deltaX - 20) / 75) : 0;
        stampRejectRef.current.style.opacity = String(rejectOp);
        stampRejectRef.current.style.display = rejectOp > 0.02 ? 'block' : 'none';
      }
    });
  };

  const handlePointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragStartRef.current = null;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    if (cardRef.current) {
      cardRef.current.classList.remove('is-dragging');
    }

    const finalX = currentDragXRef.current;
    if (finalX > 85) {
      executeSwipeWithAnimation('KEEP');
    } else if (finalX < -85) {
      executeSwipeWithAnimation('REJECT');
    } else {
      if (cardRef.current) {
        cardRef.current.style.transform = '';
      }
      if (stampKeepRef.current) {
        stampKeepRef.current.style.opacity = '0';
        stampKeepRef.current.style.display = 'none';
      }
      if (stampRejectRef.current) {
        stampRejectRef.current.style.opacity = '0';
        stampRejectRef.current.style.display = 'none';
      }
    }
  };

  // Thống kê ký tự và từ
  const charCount = (localCaption || '').length;
  const wordCount = (localCaption || '').trim() ? (localCaption || '').trim().split(/\s+/).length : 0;

  const extraGroupOptions = buildExtraGroupOptions(groupAccountsWithId, primaryGroupIds);
  const activeExtraGroupIds = activeSwipeItem?.extraGroupIds || [];
  const keptWithExtraGroupsCount = swipeReviewItems.filter(
    (item) => swipeDecisions[item.id] !== 'REJECT' && (item.extraGroupIds?.length || 0) > 0
  ).length;

  return (
    <Modal
      open={swipeReviewOpen}
      onCancel={() => setSwipeReviewOpen(false)}
      footer={null}
      centered
      width={activeSwipeItem ? 'min(1400px, calc(100vw - 24px))' : 420}
      className={`poster-swipe-review-modal${activeSwipeItem ? '' : ' is-compact'}`}
      destroyOnHidden
    >
      {activeSwipeItem ? (
        <div className="poster-swipe-review">
          <div className="poster-swipe-topbar">
            <div>
              <span>Duyệt bài</span>
              <strong>{swipeReviewIndex + 1} / {swipeReviewItems.length}</strong>
            </div>
            <Progress
              percent={Math.round(((swipeReviewIndex + 1) / Math.max(1, swipeReviewItems.length)) * 100)}
              showInfo={false}
              strokeColor="#22b8e6"
              trailColor="#223247"
              size="small"
            />
            <div className="poster-swipe-stats">
              <span className="is-kept">✓ {Object.values(swipeDecisions).filter((decision) => decision === 'KEEP').length} giữ</span>
              <span className="is-rejected">× {Object.values(swipeDecisions).filter((decision) => decision === 'REJECT').length} bỏ</span>
            </div>
          </div>

          <div
            ref={cardRef}
            className="poster-swipe-card"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Con dấu Tinder GIỮ / BỎ trực quan cập nhật trực tiếp qua GPU khi kéo chuột */}
            <div
              ref={stampKeepRef}
              className="tinder-stamp tinder-stamp-keep"
              style={{ display: 'none', opacity: 0 }}
            >
              GIỮ ✓
            </div>
            <div
              ref={stampRejectRef}
              className="tinder-stamp tinder-stamp-reject"
              style={{ display: 'none', opacity: 0 }}
            >
              BỎ ✕
            </div>

            <div className="poster-swipe-media">
              {activeSwipeMediaUrls.length > 1 ? (() => {
                const n = activeSwipeMediaUrls.length;
                const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
                const rows = Math.ceil(n / cols);
                return (
                  <div
                    className="swipe-media-grid"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
                  >
                    {activeSwipeMediaUrls.map((mediaUrl, mediaIndex) => {
                      const isVid = isMediaVideo(mediaUrl, activeSwipeMediaKinds[mediaIndex]);
                      return (
                        <div
                          key={`${mediaUrl}-${mediaIndex}`}
                          className="swipe-media-tile"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => !isVid && setMediaViewer({ url: mediaUrl, kind: 'image', title: `Bài ${swipeReviewIndex + 1} - Media ${mediaIndex + 1}` })}
                        >
                          {isVid ? (
                            <video
                              src={mediaUrl.includes('#t=') ? mediaUrl : `${mediaUrl}#t=0.001`}
                              controls
                              playsInline
                              preload="auto"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <img src={mediaUrl} alt={`Media ${mediaIndex + 1}`} loading="eager" decoding="async" />
                          )}
                          <span className="swipe-media-tile-num">{mediaIndex + 1}</span>
                          {onRemoveMedia && (
                            <button
                              type="button"
                              className="swipe-media-tile-del"
                              title="Xoá ảnh/clip này"
                              aria-label={`Xoá media ${mediaIndex + 1}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveMedia(activeSwipeItem.id, mediaIndex);
                                setSwipeMediaIndex(0);
                              }}
                            >
                              <DeleteOutlined />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
              <div
                className={`poster-swipe-media-stage relative group ${
                  isMediaVideo(activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0], activeSwipeMediaKinds[swipeMediaIndex])
                    ? ''
                    : 'cursor-pointer'
                }`}
                onClick={() => {
                  const currentUrl = activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0];
                  if (currentUrl) {
                    const kind = isMediaVideo(currentUrl, activeSwipeMediaKinds[swipeMediaIndex]) ? 'video' : 'image';
                    if (kind === 'video') return;
                    setMediaViewer({ url: currentUrl, kind, title: `Bài ${swipeReviewIndex + 1} - Media ${swipeMediaIndex + 1}` });
                  }
                }}
              >
                {activeSwipeMediaUrls.length > 0 &&
                  !isMediaVideo(activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0], activeSwipeMediaKinds[swipeMediaIndex]) && (
                  <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/85 text-slate-200 text-xs px-2 py-1 rounded-md flex items-center gap-1" title="Phóng to (Space)">
                    <ZoomInOutlined />
                  </div>
                )}
                {onRemoveMedia && activeSwipeMediaUrls.length > 0 && (
                  <button
                    type="button"
                    className="swipe-media-del"
                    title="Xoá ảnh/clip này khỏi bài"
                    aria-label="Xoá ảnh/clip này khỏi bài"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const idx = Math.min(swipeMediaIndex, activeSwipeMediaUrls.length - 1);
                      onRemoveMedia(activeSwipeItem.id, idx);
                      setSwipeMediaIndex(Math.max(0, idx - 1));
                    }}
                  >
                    <DeleteOutlined /> Xoá
                  </button>
                )}
                {activeSwipeMediaUrls.length > 0 ? (
                  isMediaVideo(activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0], activeSwipeMediaKinds[swipeMediaIndex]) ? (
                    <video
                      key={activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0]}
                      src={(() => {
                        const u = activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0];
                        return u.includes('#t=') ? u : `${u}#t=0.001`;
                      })()}
                      controls
                      playsInline
                      preload="auto"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <img
                      src={activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0]}
                      alt={`Media bài ${swipeReviewIndex + 1}`}
                      loading="eager"
                      decoding="async"
                    />
                  )
                ) : activeSwipePreview?.loading ? (
                  <div className="poster-swipe-empty"><LoadingOutlined spin /> Đang tải nội dung bài...</div>
                ) : (
                  <div className="poster-swipe-empty"><PictureOutlined /> Bài này không có ảnh hoặc video</div>
                )}
              </div>
              )}
            </div>

            <div className="poster-swipe-caption flex flex-col h-full">
              <div className="poster-swipe-caption-head flex items-center justify-between pb-2 border-b border-slate-800">
                <div>
                  <span className="font-bold text-slate-100 text-sm">Bài viết {swipeReviewIndex + 1}</span>
                  <small className="text-slate-400 text-xs block">
                    {activeSwipeMediaUrls.length} media · {wordCount} từ · {charCount} ký tự
                  </small>
                </div>
                <div className="flex items-center gap-2">
                  {swipeDecisions[activeSwipeItem.id] && (
                    <Tag color={swipeDecisions[activeSwipeItem.id] === 'KEEP' ? 'success' : 'error'}>
                      {swipeDecisions[activeSwipeItem.id] === 'KEEP' ? 'Đang giữ' : 'Đang bỏ'}
                    </Tag>
                  )}
                </div>
              </div>

              {/* Thanh công cụ sửa nhanh Cre / Hashtag / Copy / Chuẩn hoá */}
              <div className="flex items-center gap-1.5 flex-wrap py-2 border-b border-slate-800/60">
                <Tooltip title="Chèn 'Cre: Member ẩn danh' vào caption bài này">
                  <Button
                    size="small"
                    type="text"
                    icon={<UserOutlined />}
                    onClick={() => {
                      const updated = replaceOrAppendCreditText(localCaption, 'Member ẩn danh');
                      handleLocalCaptionChange(updated);
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Cre ẩn danh
                  </Button>
                </Tooltip>
                <Tooltip title={activeSwipePreview?.author ? `Chèn 'Cre: ${activeSwipePreview.author}' vào caption` : "Chèn tên Tác giả gốc"}>
                  <Button
                    size="small"
                    type="text"
                    icon={<UserOutlined />}
                    onClick={() => {
                      const authorName = activeSwipePreview?.author || 'Tác giả gốc';
                      const updated = replaceOrAppendCreditText(localCaption, authorName);
                      handleLocalCaptionChange(updated);
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Cre tác giả
                  </Button>
                </Tooltip>
                <Tooltip title="Chèn Cre tùy chỉnh">
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      flushCaptionToParent();
                      openCustomCreModal(activeSwipeItem.id);
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Cre khác
                  </Button>
                </Tooltip>
                <Tooltip title="Chèn Hashtag vào bài này">
                  <Button
                    size="small"
                    type="text"
                    icon={<TagOutlined />}
                    onClick={() => {
                      flushCaptionToParent();
                      openHashtagModal(activeSwipeItem.id);
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Hashtag
                  </Button>
                </Tooltip>
                <Tooltip title="Sao chép toàn bộ nội dung caption">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(localCaption || '');
                      message.success('Đã sao chép caption');
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Copy
                  </Button>
                </Tooltip>
                <Tooltip title="Chuẩn hoá dòng: thu gọn các khoảng trống và dòng thừa">
                  <Button
                    size="small"
                    type="text"
                    icon={<MenuFoldOutlined />}
                    onClick={() => {
                      const normalized = (localCaption || '')
                        .replace(/[ \t]+/g, ' ')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                      handleLocalCaptionChange(normalized);
                      message.success('Đã gọn dòng');
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Gọn dòng
                  </Button>
                </Tooltip>
                <Tooltip title="Tự động xóa sạch toàn bộ dấu hoa thị markdown (** hoặc *) khỏi bài viết">
                  <Button
                    size="small"
                    type="text"
                    icon={<ClearOutlined />}
                    onClick={() => {
                      const cleaned = cleanMarkdownAsterisks(localCaption);
                      handleLocalCaptionChange(cleaned);
                      message.success('Đã xoá dấu *');
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                  >
                    Xoá dấu *
                  </Button>
                </Tooltip>
                {activeSwipeItem.inputType !== 'MANUAL' && (
                  <Tooltip title="Khôi phục caption gốc từ nguồn cào">
                    <Button
                      size="small"
                      type="text"
                      icon={<RedoOutlined />}
                      onClick={() => handleLocalCaptionChange(cleanMarkdownAsterisks(activeSwipePreview?.caption || ''))}
                      className="text-xs text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/80 rounded px-2"
                    >
                      Gốc
                    </Button>
                  </Tooltip>
                )}
              </div>

              {/* Ô Nhập/Sửa Caption Trực Tiếp */}
              <div className="flex-1 my-2 flex flex-col min-h-0">
                <Input.TextArea
                  value={localCaption}
                  onChange={(e) => handleLocalCaptionChange(e.target.value)}
                  onBlur={flushCaptionToParent}
                  placeholder="Caption"
                  autoSize={false}
                  className="w-full flex-1 !h-full min-h-[260px] sm:min-h-[320px] bg-slate-900/90 border-slate-700/80 text-slate-100 text-xs sm:text-sm p-3.5 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-500 resize-none font-sans leading-relaxed shadow-inner"
                />
              </div>

              {/* Đăng thêm bài này sang các Group chỉ định khác ngoài nhóm chính */}
              {onExtraGroupIdsChange && extraGroupOptions.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400 flex items-center gap-1.5">
                      <span>Nhóm thêm</span>
                      {activeExtraGroupIds.length > 0 && (
                        <Tag color="geekblue" className="!m-0 !rounded-md !text-[11px] font-bold">
                          +{activeExtraGroupIds.length} nhóm
                        </Tag>
                      )}
                    </span>
                    {activeExtraGroupIds.length > 0 && (
                      <Button
                        size="small"
                        type="link"
                        className="!p-0 !h-auto text-xs text-slate-400 hover:text-rose-300"
                        onClick={() => onExtraGroupIdsChange(activeSwipeItem.id, [])}
                      >
                        Xóa hết
                      </Button>
                    )}
                  </div>
                  <Select
                    mode="multiple"
                    size="middle"
                    allowClear
                    showSearch
                    placeholder="Không bắt buộc"
                    value={activeExtraGroupIds}
                    onChange={(vals: string[]) => onExtraGroupIdsChange(activeSwipeItem.id, vals)}
                    options={extraGroupOptions}
                    optionLabelProp="name"
                    filterOption={filterSelectByLabel}
                    maxTagCount="responsive"
                    className="w-full"
                    getPopupContainer={(trigger) => trigger.parentElement || document.body}
                  />
                </div>
              )}

              {activeSwipeItem.url && (
                <a href={activeSwipeItem.url} target="_blank" rel="noreferrer" className="poster-swipe-source mt-1.5">
                  <LinkOutlined /> Xem bài gốc
                </a>
              )}
            </div>
          </div>

          <div className="poster-swipe-actions">
            <Button
              size="large"
              icon={<ArrowLeftOutlined />}
              disabled={swipeReviewIndex === 0}
              onClick={() => {
                flushCaptionToParent();
                setSwipeReviewIndex((current) => Math.max(0, current - 1));
                setSwipeMediaIndex(0);
              }}
              className="poster-swipe-back"
            >
              Bài trước <span className="opacity-50 text-xs ml-1">Z</span>
            </Button>
            <Button
              size="large"
              danger
              icon={<CloseOutlined />}
              onClick={() => executeSwipeWithAnimation('REJECT')}
              className="poster-swipe-reject"
            >
              Bỏ <span className="opacity-60 text-xs ml-1">A</span>
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<CheckCircleOutlined />}
              onClick={() => executeSwipeWithAnimation('KEEP')}
              className="poster-swipe-keep"
            >
              Giữ <span className="opacity-70 text-xs ml-1">D</span>
            </Button>
          </div>
        </div>
      ) : swipeReviewItems.length === 0 && Object.keys(swipeDecisions).length === 0 ? (
        <div className="poster-swipe-complete py-10 text-center">
          <div className="mb-3 flex justify-center">
            <InboxOutlined className="text-4xl text-slate-400" />
          </div>
          <h2 className="text-base font-bold text-slate-100">Chưa có bài viết nào trong danh sách duyệt</h2>
          <p className="text-xs text-slate-400 mb-4">Dán link hoặc quét bài trước khi duyệt.</p>
          <Button type="primary" onClick={() => setSwipeReviewOpen(false)}>Đóng</Button>
        </div>
      ) : (
        <div className="poster-swipe-complete">
          <div className="poster-swipe-complete-icon"><CheckCircleOutlined /></div>
          <h2>Đã duyệt xong</h2>
          <p>
            Giữ <b>{Object.values(swipeDecisions).filter((decision) => decision === 'KEEP').length}</b> bài ·
            Bỏ <strong>{Object.values(swipeDecisions).filter((decision) => decision === 'REJECT').length}</strong> bài
            {keptWithExtraGroupsCount > 0 && (
              <> · <span className="text-indigo-300 font-bold">{keptWithExtraGroupsCount} bài đăng thêm nhóm khác</span></>
            )}
          </p>
          <div>
            <Button onClick={() => { setSwipeReviewIndex(0); setSwipeMediaIndex(0); }}>Duyệt lại</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleApplySwipeReview}>
              Xong
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(SwipeReviewModal, (prev, next) => !prev.swipeReviewOpen && !next.swipeReviewOpen);
