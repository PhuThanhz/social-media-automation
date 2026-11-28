import { memo, useState, useRef, useMemo } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Tag,
  Checkbox,
  Progress,
  DatePicker,
  TimePicker,
  Segmented,
  Drawer,
  Image,
  App,
  Tooltip,
  Badge,
  Popconfirm,
} from 'antd';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  LoadingOutlined,
  DeleteOutlined,
  CopyOutlined,
  EyeOutlined,
  ReloadOutlined,
  EditOutlined,
  PictureOutlined,
  CloudUploadOutlined,
  FileExcelOutlined,
  ClearOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  DownloadOutlined,
  LinkOutlined,
  FileTextOutlined,
  InboxOutlined,
  FolderOpenOutlined,
  SnippetsOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import api from '../../config/axios';
import { stripEmojiPrefix } from './shared';
import ScheduleChoice from '../../components/common/ScheduleChoice';
import type { ScheduleValue } from '../../components/common/postingSchedule';
import type { SocialAccount, PostQueue } from './types';

const { TextArea } = Input;

export interface BulkManualPostItem {
  id: string;
  content: string;
  mediaUrls: string[];
  mediaKinds: ('image' | 'video')[];
}

interface BulkPasteDrawerProps {
  bulkDrawerPreviews: Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>;
  setBulkDrawerPreviews: React.Dispatch<React.SetStateAction<Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>>>;
  isMediaVideo: (url: string, kind?: string) => boolean;
  bulkModalVisible: boolean;
  setBulkModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  bulkAutoDistributeTwoVias: boolean;
  setBulkAutoDistributeTwoVias: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkText: React.Dispatch<React.SetStateAction<string>>;
  bulkText: string;
  groupAccountsWithId: SocialAccount[];
  twoMainViasDisplayNames: string;
  posts: PostQueue[];
  filterHistoryDuplicates: boolean;
  setFilterHistoryDuplicates: React.Dispatch<React.SetStateAction<boolean>>;
  bulkPasteSummary: { detectedUrls: string[]; uniqueUrls: string[]; finalUrls: string[]; historyMatchedUrls: string[]; invalidLineCount: number; duplicateInInputCount: number; duplicateInHistoryCount: number; };
  currentKpiTarget: { socialAccountId: number; name: any; targetCount: number; actualCount: number; pendingCount: number; totalPending: number; totalPlanned: number; isFullyPublished: boolean; isFullyScheduled: boolean; remainingToSchedule: number; };
  bulkScrapeStats: { total: number; completed: number; loading: number; error: number; isDone: boolean; percent: number; };
  bulkFailedLinks: Array<{ url: string; error: string }>;
  retryFailedLink: (url: string) => void;
  fetchOneDrawerPreview: (url: string) => Promise<void>;
  updateDrawerPreviewCaption: (url: string, caption: string) => void;
  moveDrawerMedia: (url: string, fromIndex: number, toIndex: number) => void;
  removeDrawerMedia: (url: string, index: number) => void;
  resetDrawerMedia: (url: string) => void;
  updateDrawerComment: (url: string, comment: string) => void;
  toggleDrawerSkipComment: (url: string) => void;
  toggleDrawerCredit: (url: string) => void;
  removeUrlFromBulkText: (urlToRemove: string) => void;
  fetchAllDrawerPreviews: () => void;
  handleApplyBulkPaste: () => void;
  handleApplyAndOpenSwipeReview: () => void;
  scheduleChoice: ScheduleValue;
  setScheduleChoice: (v: ScheduleValue) => void;
  handleApplyBulkManualPosts?: (
    manualPosts: Array<{
      content: string;
      mediaUrls: string[];
      mediaKinds?: ('image' | 'video')[];
    }>,
    andOpenSwipe?: boolean
  ) => void;
}

// Nén ảnh trên trình duyệt trước khi upload
const compressImageIfNeeded = async (file: File, maxMb = 2): Promise<File> => {
  if (file.type.startsWith('video/')) return file;
  if (file.size <= maxMb * 1024 * 1024) return file;

  return new Promise((resolve) => {
    const img = document.createElement('img');
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      const maxDim = 2560;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          const compressedFile = new File([blob], (file.name || 'image').replace(/\.[^/.]+$/, '') + '.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        'image/jpeg',
        0.85
      );
    };

    img.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

// Trích xuất số bài viết từ tên file hoặc thư mục (VD: 1_1.jpg, 2.jpg, 1/img.jpg...)
const extractPostIndexFromPathOrName = (filePath: string, fileName: string): number | null => {
  if (filePath && filePath.includes('/')) {
    const parts = filePath.split('/');
    if (parts.length > 1) {
      const parentFolder = parts[parts.length - 2];
      const folderMatch = parentFolder.match(/(?:^|[^\d])0*(\d{1,3})(?:[^\d]|$)/);
      if (folderMatch) {
        const num = parseInt(folderMatch[1], 10);
        if (num >= 1 && num <= 500) return num;
      }
    }
  }

  const baseName = fileName.replace(/\.[^/.]+$/, '');
  const multiMatch = baseName.match(/(?:^|bai|post|item)?[-_\s]*0*(\d{1,3})[-_\s.a-zA-Z]/i);
  if (multiMatch) {
    const num = parseInt(multiMatch[1], 10);
    if (num >= 1 && num <= 500) return num;
  }

  const singleMatch = baseName.match(/(?:^|[^\d])0*(\d{1,3})(?:[^\d]|$)/);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);
    if (num >= 1 && num <= 500) return num;
  }

  return null;
};

function BulkPasteDrawer({
  bulkDrawerPreviews,
  setBulkDrawerPreviews,
  isMediaVideo,
  bulkModalVisible,
  setBulkModalVisible,
  bulkAutoDistributeTwoVias,
  setBulkAutoDistributeTwoVias,
  setBulkText,
  bulkText,
  groupAccountsWithId,
  twoMainViasDisplayNames,
  posts,
  filterHistoryDuplicates,
  setFilterHistoryDuplicates,
  bulkPasteSummary,
  currentKpiTarget,
  bulkScrapeStats,
  bulkFailedLinks,
  retryFailedLink,
  fetchOneDrawerPreview,
  updateDrawerPreviewCaption,
  moveDrawerMedia,
  removeDrawerMedia,
  resetDrawerMedia,
  updateDrawerComment,
  toggleDrawerSkipComment,
  toggleDrawerCredit,
  removeUrlFromBulkText,
  fetchAllDrawerPreviews,
  handleApplyBulkPaste,
  handleApplyAndOpenSwipeReview,
  scheduleChoice,
  setScheduleChoice,
  handleApplyBulkManualPosts,
}: BulkPasteDrawerProps) {
  const { message } = App.useApp();

  // Tách link từ đoạn text bất kỳ (mỗi link 1 dòng)
  const extractUrls = (text: string) => (text.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.trim());

  // Dán link từ Clipboard: nối vào cuối, mỗi link 1 dòng
  const appendUrls = (urls: string[]) => {
    setBulkText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${urls.join('\n')}\n` : `${urls.join('\n')}\n`));
  };

  // Ctrl+V vào ô link: tự tách link ra từng dòng + xuống dòng sẵn cho lần dán tiếp theo
  const handleLinksTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const urls = extractUrls(e.clipboardData.getData('text') || '');
    if (urls.length === 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? bulkText.length;
    const end = el.selectionEnd ?? bulkText.length;
    const before = bulkText.slice(0, start);
    const after = bulkText.slice(end);
    const head = before && !before.endsWith('\n') ? `${before}\n` : before;
    const inserted = `${urls.join('\n')}\n`;
    const tail = after.replace(/^[ \t]*\n?/, '');
    const next = head + inserted + tail;
    setBulkText(next);
    const caret = head.length + inserted.length;
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = caret;
    });
  };

  const [showFailedLinks, setShowFailedLinks] = useState(false);
  const failedTotal = bulkScrapeStats.error + bulkFailedLinks.length;

  // Tab chuyển đổi: Dán link cào bài | Tự soạn bài & ảnh
  const [drawerTab, setDrawerTab] = useState<'LINKS' | 'MANUAL'>('LINKS');

  // Khởi tạo sẵn 1 bài đầu tiên để người dùng có thể gõ hoặc dán ảnh ngay lập tức
  const [manualPosts, setManualPosts] = useState<BulkManualPostItem[]>([
    { id: '1', content: '', mediaUrls: [], mediaKinds: [] },
  ]);

  // Bài viết đang được chọn chỉnh sửa trong giao diện Studio
  const [activeManualPostId, setActiveManualPostId] = useState<string>('1');

  const activePostIndex = useMemo(() => {
    const idx = manualPosts.findIndex((p) => p.id === activeManualPostId);
    return idx !== -1 ? idx : 0;
  }, [manualPosts, activeManualPostId]);

  const activePost = manualPosts[activePostIndex] || manualPosts[0];

  const goToPrevPost = () => {
    if (activePostIndex > 0) {
      setActiveManualPostId(manualPosts[activePostIndex - 1].id);
    }
  };

  const goToNextPost = () => {
    if (activePostIndex < manualPosts.length - 1) {
      setActiveManualPostId(manualPosts[activePostIndex + 1].id);
    }
  };

  // Hộp dán nhanh nhiều bài dạng text (ẩn/hiện)
  const [showBatchTextInput, setShowBatchTextInput] = useState(false);
  const [batchRawText, setBatchRawText] = useState('');

  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; percent: number } | null>(null);

  const excelInputRef = useRef<HTMLInputElement>(null);
  const bulkMediaInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const lastPasteTimeRef = useRef<number>(0);

  // Thêm 1 bài viết mới
  const addEmptyManualPost = () => {
    const newId = Math.random().toString(36).substring(2, 9);
    setManualPosts((prev) => [
      ...prev,
      { id: newId, content: '', mediaUrls: [], mediaKinds: [] },
    ]);
    setActiveManualPostId(newId);
  };

  // Nhân bản bài viết
  const cloneManualPost = (postId: string) => {
    setManualPosts((prev) => {
      const idx = prev.findIndex((p) => p.id === postId);
      if (idx === -1) return prev;
      const original = prev[idx];
      const newId = Math.random().toString(36).substring(2, 9);
      const clone: BulkManualPostItem = {
        id: newId,
        content: original.content,
        mediaUrls: [...original.mediaUrls],
        mediaKinds: [...original.mediaKinds],
      };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      setActiveManualPostId(newId);
      return next;
    });
  };

  // Xóa bài viết
  const deleteManualPost = (postId: string) => {
    setManualPosts((prev) => {
      const filtered = prev.filter((p) => p.id !== postId);
      if (filtered.length === 0) {
        const resetId = '1';
        setActiveManualPostId(resetId);
        return [{ id: resetId, content: '', mediaUrls: [], mediaKinds: [] }];
      }
      if (activeManualPostId === postId) {
        const nextIdx = Math.min(activePostIndex, filtered.length - 1);
        setActiveManualPostId(filtered[nextIdx].id);
      }
      return filtered;
    });
  };

  // Bóc tách text khi dán nhiều bài (hỗ trợ bài viết dài nhiều đoạn, phân cách bằng --- hoặc === hoặc Bài 1:...)
  const handleApplyBatchRawText = () => {
    if (!batchRawText.trim()) {
      message.warning('Vui lòng nhập nội dung các bài viết!');
      return;
    }

    // 1. Phân cách bằng dòng gạch ngang (--- hoặc === hoặc ___)
    let parts = batchRawText
      .split(/^\s*(?:-{3,}|={3,}|_{3,})\s*$/m)
      .map((p) => p.trim())
      .filter(Boolean);

    // 2. Nếu người dùng đánh số dạng [Bài 1], Bài 1:, Post 1: ...
    if (parts.length <= 1 && /(?:^|\n)\s*(?:\[?(?:Bài|Post|bài|post)\s*\d+\]?[:\.\-])/i.test(batchRawText)) {
      parts = batchRawText
        .split(/(?:^|\n)\s*(?:\[?(?:Bài|Post|bài|post)\s*\d+\]?[:\.\-])/i)
        .map((p) => p.trim())
        .filter(Boolean);
    }

    // 3. Nếu phân cách bằng 2 dòng trống liên tiếp (3 lần Enter)
    if (parts.length <= 1 && /\n\s*\n\s*\n+/.test(batchRawText)) {
      parts = batchRawText
        .split(/\n\s*\n\s*\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
    }

    if (parts.length === 0) {
      message.warning('Không tìm thấy bài viết hợp lệ!');
      return;
    }

    const newItems = parts.map((content) => ({
      id: Math.random().toString(36).substring(2, 9),
      content,
      mediaUrls: [],
      mediaKinds: [],
    }));
    setManualPosts(newItems);
    if (newItems.length > 0) {
      setActiveManualPostId(newItems[0].id);
    }
    setShowBatchTextInput(false);
    setBatchRawText('');
    message.success(`⚡ Đã tạo ${parts.length} bài viết! Toàn bộ các đoạn văn và xuống dòng đều được giữ nguyên.`);
  };

  // Tải nhiều ảnh riêng cho 1 bài viết
  const handleUploadSinglePostMedia = async (postId: string, files: FileList | File[]) => {
    const rawFiles = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (rawFiles.length === 0) return;

    // Loại bỏ file trùng lặp (ví dụ do clipboard sinh 2 định dạng cùng lúc)
    const uniqueFiles: File[] = [];
    const seen = new Set<string>();
    for (const f of rawFiles) {
      const key = `${f.name}_${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFiles.push(f);
      }
    }
    if (uniqueFiles.length === 0) return;

    const hide = message.loading(`Đang tải lên ${uniqueFiles.length} ảnh...`, 0);
    try {
      for (const rawFile of uniqueFiles) {
        const file = await compressImageIfNeeded(rawFile);
        const formData = new FormData();
        formData.append('file', file);
        const res = await api.post('/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (res.data?.success && res.data?.url) {
          const url = res.data.url;
          const kind: 'image' | 'video' = res.data.mediaType === 'video' ? 'video' : 'image';
          setManualPosts((prev) =>
            prev.map((p) => {
              if (p.id !== postId) return p;
              // Ngăn chặn thêm trùng URL ảnh
              if (p.mediaUrls.includes(url)) return p;
              return {
                ...p,
                mediaUrls: [...p.mediaUrls, url],
                mediaKinds: [...p.mediaKinds, kind],
              };
            })
          );
        }
      }
      message.success(`Đã thêm ${uniqueFiles.length} ảnh vào bài viết!`);
    } catch (err: any) {
      message.error('Lỗi khi tải ảnh: ' + (err?.message || 'Lỗi'));
    } finally {
      hide();
    }
  };

  // Nút bấm "Dán ảnh (Ctrl+V)" đọc ảnh từ Clipboard
  const handlePasteFromClipboardButton = async (postId: string) => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        message.info('💡 Bạn hãy bấm tổ hợp phím Ctrl+V (hoặc Cmd+V trên Mac) để dán ảnh trực tiếp nhé!');
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      const mediaFiles: File[] = [];
      for (const item of clipboardItems) {
        // Mỗi clipboard item chỉ lấy đúng 1 định dạng tốt nhất (ưu tiên PNG > JPEG > bất kỳ), tránh sinh 2 ảnh
        const targetType =
          item.types.find((t) => t === 'image/png') ||
          item.types.find((t) => t === 'image/jpeg') ||
          item.types.find((t) => t.startsWith('image/')) ||
          item.types.find((t) => t.startsWith('video/'));

        if (targetType) {
          const blob = await item.getType(targetType);
          const ext = targetType.split('/')[1] || 'png';
          const file = new File([blob], `paste-${Date.now()}.${ext}`, { type: targetType });
          mediaFiles.push(file);
        }
      }
      if (mediaFiles.length > 0) {
        await handleUploadSinglePostMedia(postId, mediaFiles);
        return;
      }

      // Kiểm tra nếu bộ nhớ tạm chứa text là đường dẫn ảnh trực tiếp
      if (navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText()).trim();
        if (/^https?:\/\/.+\.(jpe?g|png|webp|gif|bmp)(\?.*)?$/i.test(text)) {
          setManualPosts((prev) =>
            prev.map((p) => {
              if (p.id !== postId) return p;
              if (p.mediaUrls.includes(text)) return p;
              return {
                ...p,
                mediaUrls: [...p.mediaUrls, text],
                mediaKinds: [...p.mediaKinds, 'image'],
              };
            })
          );
          message.success('📋 Đã nhận diện link ảnh và thêm vào bài!');
          return;
        }
      }

      message.warning('Bộ nhớ tạm chưa có ảnh. Hãy bấm Copy ảnh (Web, File, Zalo...) rồi bấm Dán nhé!');
    } catch {
      message.info('💡 Bạn hãy bấm tổ hợp phím Ctrl+V (hoặc Cmd+V trên Mac) trực tiếp vào bài viết để dán ảnh!');
    }
  };

  // Bắt sự kiện phím Ctrl+V / Cmd+V trực tiếp trên ô bài viết
  const handlePasteEventOnPost = async (postId: string, e: React.ClipboardEvent) => {
    const files: File[] = [];

    // 1. Kiểm tra files (copy file trực tiếp từ Finder / File Explorer)
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const f = e.clipboardData.files[i];
        if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
          files.push(f);
        }
      }
    }

    // 2. Kiểm tra items (copy ảnh trên Web, Zalo, Telegram, chụp màn hình Cmd+Shift+4)
    if (files.length === 0 && e.clipboardData.items) {
      const items = Array.from(e.clipboardData.items);
      // Trên macOS/Chrome, 1 ảnh copy có thể sinh ra cả image/png và image/tiff. Chỉ lấy đúng 1 ảnh duy nhất!
      const imageItem =
        items.find((it) => it.type === 'image/png') ||
        items.find((it) => it.type === 'image/jpeg') ||
        items.find((it) => it.type.startsWith('image/')) ||
        items.find((it) => it.type.startsWith('video/'));

      if (imageItem) {
        const blob = imageItem.getAsFile();
        if (blob) {
          const ext = imageItem.type.split('/')[1] || 'png';
          files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageItem.type }));
        }
      }
    }

    // Nếu không có file media nào, để sự kiện tiếp tục bình thường (paste văn bản)
    if (files.length === 0) return;

    // QUAN TRỌNG: Ngăn chặn cả default browser text paste và event bubbling lên thẻ cha!
    e.preventDefault();
    e.stopPropagation();

    // Khóa debounce trong 600ms chống double paste trên macOS / Chrome
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 600) {
      return;
    }
    lastPasteTimeRef.current = now;

    await handleUploadSinglePostMedia(postId, files);
  };

  const removeSinglePostMedia = (postId: string, mediaIdx: number) => {
    setManualPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const urls = [...p.mediaUrls];
        const kinds = [...p.mediaKinds];
        urls.splice(mediaIdx, 1);
        kinds.splice(mediaIdx, 1);
        return { ...p, mediaUrls: urls, mediaKinds: kinds };
      })
    );
  };

  const moveSinglePostMedia = (postId: string, fromIdx: number, toIdx: number) => {
    setManualPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const urls = [...p.mediaUrls];
        const kinds = [...p.mediaKinds];
        const [movedUrl] = urls.splice(fromIdx, 1);
        const [movedKind] = kinds.splice(fromIdx, 1);
        urls.splice(toIdx, 0, movedUrl);
        kinds.splice(toIdx, 0, movedKind);
        return { ...p, mediaUrls: urls, mediaKinds: kinds };
      })
    );
  };

  // Nạp ảnh hàng loạt vào các bài
  const handleBulkUploadImages = async (files: FileList | File[]) => {
    const rawFiles = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (rawFiles.length === 0) {
      message.warning('Vui lòng chọn các tệp hình ảnh!');
      return;
    }

    setIsUploadingMedia(true);
    setUploadProgress({ done: 0, total: rawFiles.length, percent: 0 });

    const uploadedFiles: Array<{ file: File; url: string; kind: 'image' | 'video' }> = [];

    for (let i = 0; i < rawFiles.length; i++) {
      const rawFile = rawFiles[i];
      try {
        const file = await compressImageIfNeeded(rawFile);
        const formData = new FormData();
        formData.append('file', file);
        const res = await api.post('/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (res.data?.success && res.data?.url) {
          uploadedFiles.push({
            file: rawFile,
            url: res.data.url,
            kind: res.data.mediaType === 'video' ? 'video' : 'image',
          });
        }
      } catch (err) {
        console.error('Lỗi tải file:', rawFile.name, err);
      }
      const done = i + 1;
      setUploadProgress({
        done,
        total: rawFiles.length,
        percent: Math.round((done / rawFiles.length) * 100),
      });
    }

    setIsUploadingMedia(false);
    setUploadProgress(null);

    if (uploadedFiles.length === 0) {
      message.error('Không tải được ảnh nào lên!');
      return;
    }

    setManualPosts((prev) => {
      const updated = prev.map((p) => ({ ...p, mediaUrls: [...p.mediaUrls], mediaKinds: [...p.mediaKinds] }));
      let matchedCount = 0;

      uploadedFiles.forEach((item, idx) => {
        const relPath = (item.file as any).webkitRelativePath || '';
        const num = extractPostIndexFromPathOrName(relPath, item.file.name);
        let targetPost: BulkManualPostItem | undefined;

        if (num !== null && num >= 1 && num <= updated.length) {
          targetPost = updated[num - 1];
        } else {
          targetPost = updated[idx % updated.length];
        }

        if (targetPost && !targetPost.mediaUrls.includes(item.url)) {
          targetPost.mediaUrls.push(item.url);
          targetPost.mediaKinds.push(item.kind);
          matchedCount++;
        }
      });

      message.success(`🎉 Đã tải lên và gán ${uploadedFiles.length} ảnh vào các bài viết!`);
      return updated;
    });
  };

  // Đọc file Excel
  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (rows.length === 0) {
            message.warning('File Excel rỗng!');
            return;
          }

          let startIdx = 0;
          const firstRowStr = (rows[0] || []).join(' ').toLowerCase();
          if (
            firstRowStr.includes('nội dung') ||
            firstRowStr.includes('caption') ||
            firstRowStr.includes('content') ||
            firstRowStr.includes('stt')
          ) {
            startIdx = 1;
          }

          const parsed: BulkManualPostItem[] = [];
          for (let i = startIdx; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const content = String(row[0] || '').trim();
            if (!content) continue;

            const mediaCol = row[1] ? String(row[1]).trim() : '';
            const mediaUrls: string[] = [];
            if (mediaCol) {
              const items = mediaCol.split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean);
              items.forEach((u) => {
                if (u.startsWith('http://') || u.startsWith('https://')) {
                  mediaUrls.push(u);
                }
              });
            }

            parsed.push({
              id: Math.random().toString(36).substring(2, 9),
              content,
              mediaUrls,
              mediaKinds: mediaUrls.map(() => 'image'),
            });
          }

          if (parsed.length > 0) {
            setManualPosts(parsed);
            setActiveManualPostId(parsed[0].id);
            message.success(`📊 Đã nhập ${parsed.length} bài viết từ Excel!`);
          }
        } catch (err: any) {
          message.error('Lỗi đọc Excel: ' + (err?.message || 'File lỗi'));
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      message.error('Không thể đọc file: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  const validManualPosts = useMemo(
    () => manualPosts.filter((p) => p.content.trim().length > 0 || p.mediaUrls.length > 0),
    [manualPosts]
  );
  const totalManualImages = useMemo(
    () => manualPosts.reduce((acc, p) => acc + p.mediaUrls.length, 0),
    [manualPosts]
  );
  const postsWithImagesCount = useMemo(
    () => manualPosts.filter((p) => p.mediaUrls.length > 0).length,
    [manualPosts]
  );

  const handleApplyManual = (andOpenSwipe: boolean) => {
    if (validManualPosts.length === 0) {
      message.warning('Chưa có bài viết hợp lệ nào để tạo!');
      return;
    }
    if (handleApplyBulkManualPosts) {
      handleApplyBulkManualPosts(validManualPosts, andOpenSwipe);
    }
  };

  return (
    <Drawer
      rootClassName="bulk-paste-drawer-root"
      title={
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 grid place-items-center text-lg shrink-0">
            {drawerTab === 'LINKS' ? <LinkOutlined /> : <EditOutlined />}
          </span>
          <div>
            <div className="text-base font-bold text-slate-100">
              {drawerTab === 'LINKS' ? 'Dán link cào bài' : 'Tự soạn bài & Lập lịch'}
            </div>
            <div className="text-xs text-slate-400">
              {drawerTab === 'LINKS'
                ? 'Hệ thống tự động tải media và caption từ link'
                : 'Soạn nội dung và dán ảnh trực tiếp (Ctrl+V) vào bài viết'}
            </div>
          </div>
        </div>
      }
      placement="right"
      size="large"
      open={bulkModalVisible}
      onClose={() => setBulkModalVisible(false)}
      className="bulk-paste-drawer"
      styles={{
        wrapper: { width: 'min(1440px, 100vw)', maxWidth: '100vw' },
        header: { background: '#0b141f', borderBottom: '1px solid #223247', padding: '12px 20px' },
        body: { background: '#07101a', padding: '16px 20px' },
        footer: { background: '#0b141f', borderTop: '1px solid #223247', padding: '11px 20px' },
      }}
      footer={
        <div className="bulk-paste-footer flex-wrap gap-2.5">
          <Button size="large" onClick={() => setBulkModalVisible(false)} className="bulk-paste-cancel">
            Hủy
          </Button>

          {drawerTab === 'LINKS' ? (
            <div className="bulk-paste-footer-primary flex-wrap gap-2">
              <span><b>{bulkPasteSummary.finalUrls.length}</b> bài hợp lệ</span>
              <div className="flex items-center gap-3 flex-wrap">
                <Checkbox
                  checked={bulkAutoDistributeTwoVias}
                  onChange={(e) => setBulkAutoDistributeTwoVias(e.target.checked)}
                  className="text-xs text-slate-300"
                >
                  Chia đều 2 Via
                </Checkbox>
                <Button
                  type="primary"
                  size="large"
                  icon={<CheckCircleOutlined />}
                  disabled={bulkPasteSummary.finalUrls.length === 0}
                  onClick={handleApplyAndOpenSwipeReview}
                  className="bulk-paste-apply"
                >
                  {bulkPasteSummary.finalUrls.length > 0
                    ? `Duyệt ${bulkPasteSummary.finalUrls.length} bài`
                    : 'Dán link để tạo bài'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="bulk-paste-footer-primary flex-wrap gap-2">
              <span className="text-xs text-slate-300">
                <b className="text-emerald-400 text-sm">{validManualPosts.length}</b> bài
                {' · '}
                <b className="text-sky-400 text-sm">{totalManualImages}</b> ảnh
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <Checkbox
                  checked={bulkAutoDistributeTwoVias}
                  onChange={(e) => setBulkAutoDistributeTwoVias(e.target.checked)}
                  className="text-xs text-slate-300"
                >
                  Chia đều 2 Via
                </Checkbox>
                <Button
                  type="primary"
                  size="large"
                  icon={<CheckCircleOutlined />}
                  disabled={validManualPosts.length === 0 || isUploadingMedia}
                  onClick={() => handleApplyManual(false)}
                  className="!bg-emerald-600 hover:!bg-emerald-500 !border-0 font-bold"
                >
                  Áp dụng tạo {validManualPosts.length} bài
                </Button>
                <Button
                  size="large"
                  icon={<RocketOutlined />}
                  disabled={validManualPosts.length === 0 || isUploadingMedia}
                  onClick={() => handleApplyManual(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold border-0 rounded-xl"
                >
                  Tạo & Duyệt nhanh
                </Button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <input type="file" ref={excelInputRef} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelFileUpload} />
      <input type="file" ref={bulkMediaInputRef} multiple accept="image/*,video/mp4" style={{ display: 'none' }} onChange={(e) => { if (e.target.files) { handleBulkUploadImages(e.target.files); e.target.value = ''; } }} />
      <input type="file" ref={folderInputRef} // @ts-ignore
        webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files) { handleBulkUploadImages(e.target.files); e.target.value = ''; } }} />

      {/* THANH ĐIỀU HƯỚNG ĐẦU MODAL (TAB CHUYỂN ĐỔI + LỊCH ĐĂNG GỌN GÀNG) */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800">
          <button
            type="button"
            onClick={() => setDrawerTab('LINKS')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border-0 ${
              drawerTab === 'LINKS'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LinkOutlined />
            <span>Dán link cào bài</span>
            {bulkPasteSummary.finalUrls.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-blue-900 text-white text-[10px]">
                {bulkPasteSummary.finalUrls.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setDrawerTab('MANUAL')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border-0 ${
              drawerTab === 'MANUAL'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <EditOutlined />
            <span>Tự soạn bài & ảnh</span>
            {manualPosts.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-900 text-white text-[10px]">
                {manualPosts.length}
              </span>
            )}
          </button>
        </div>

        {/* THỜI GIAN ĐĂNG GỌN GÀNG CÙNG HÀNG */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 flex-wrap">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <ClockCircleOutlined className="text-blue-400" /> Thời gian:
          </span>
          <ScheduleChoice value={scheduleChoice} onChange={setScheduleChoice} size="small" compact />
        </div>
      </div>

      {drawerTab === 'LINKS' ? (
        /* ================= TAB 1: WORKSPACE DÁN LINK ================= */
        <div className="bulk-paste-workspace space-y-5">
          <div className="bulk-paste-control-grid grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div className="bulk-paste-links-panel xl:col-span-7 space-y-3 bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-100">Danh sách link bài viết</span>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        const urls = extractUrls(text);
                        if (urls.length > 0) {
                          appendUrls(urls);
                          message.success(`Đã dán ${urls.length} link!`);
                        }
                      }
                    } catch {}
                  }}
                  className="bg-blue-600 hover:bg-blue-500 border-0 text-white font-bold text-xs rounded-lg px-3"
                >
                  Dán link từ Clipboard
                </Button>
              </div>

              <TextArea
                rows={5}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                onPaste={handleLinksTextareaPaste}
                placeholder="Dán mỗi dòng một link (Facebook, Threads, TikTok, Reels...)"
                className="font-mono text-xs rounded-xl p-3 bg-slate-950 border-slate-700/80 text-slate-100 placeholder:text-slate-600"
              />

              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2">
                  <b className="text-blue-400 text-base">{bulkPasteSummary.finalUrls.length}</b>
                  <div className="text-slate-400 text-[11px]">Bài sẽ tạo</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-2">
                  <b className="text-slate-200 text-base">{bulkPasteSummary.uniqueUrls.length}</b>
                  <div className="text-slate-400 text-[11px]">Link unique</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-2">
                  <b className="text-slate-200 text-base">{bulkPasteSummary.duplicateInHistoryCount}</b>
                  <div className="text-slate-400 text-[11px]">Đã có LS</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-2">
                  <b className="text-slate-200 text-base">{bulkPasteSummary.invalidLineCount}</b>
                  <div className="text-slate-400 text-[11px]">Dòng lỗi</div>
                </div>
              </div>

              {(bulkScrapeStats.total > 0 || bulkFailedLinks.length > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-400">
                      {bulkScrapeStats.loading > 0 ? 'Đang cào' : 'Đã cào xong'}
                    </span>
                    {bulkScrapeStats.loading > 0 && (
                      <span className="text-blue-300">Còn {bulkScrapeStats.loading}</span>
                    )}
                    <span className="text-emerald-400">Thành công {bulkScrapeStats.completed}</span>
                    <button
                      type="button"
                      disabled={failedTotal === 0}
                      onClick={() => setShowFailedLinks((v) => !v)}
                      className={`bg-transparent border-0 p-0 text-xs ${failedTotal > 0 ? 'text-red-400 underline cursor-pointer' : 'text-slate-500 cursor-default'}`}
                    >
                      Thất bại {failedTotal}
                    </button>
                    <span className="ml-auto text-slate-500">
                      {bulkScrapeStats.completed}/{bulkScrapeStats.total}
                    </span>
                  </div>
                  <div className="h-1 rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${bulkScrapeStats.total ? bulkScrapeStats.percent : 0}%` }}
                    />
                  </div>
                  {showFailedLinks && bulkFailedLinks.length > 0 && (
                    <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-48 overflow-y-auto">
                      {bulkFailedLinks.map((f) => (
                        <div key={f.url} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-slate-300 truncate" title={f.url}>{f.url}</div>
                            <div className="text-red-400/90 truncate">{f.error}</div>
                          </div>
                          <Button size="small" onClick={() => retryFailedLink(f.url)}>
                            Thử lại
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bulk-paste-schedule-panel xl:col-span-5 bg-slate-900/80 rounded-2xl border border-slate-800/90 p-4 space-y-2">
              <div className="text-xs font-bold text-slate-300">Lập lịch đăng</div>
              <ScheduleChoice value={scheduleChoice} onChange={setScheduleChoice} />
            </div>
          </div>
        </div>
      ) : (
        /* ================= TAB 2: STUDIO SOẠN BÀI & DÁN ẢNH 2 CỘT (GỌN GÀNG, CHUYÊN NGHIỆP) ================= */
        <div className="space-y-3">
          {/* KHUNG DÁN NHANH NHIỀU BÀI (MỞ KHI BẤM NÚT) */}
          {showBatchTextInput && (
            <div className="p-4 rounded-2xl bg-[#0b1424] border border-blue-500/40 space-y-3 shadow-xl">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-bold flex items-center gap-1.5 text-blue-300">
                  <SnippetsOutlined /> Dán nhanh nhiều bài cùng lúc:
                </span>
                <span className="text-slate-400">
                  Mỗi bài viết thoải mái nhiều đoạn văn. Phân cách giữa các bài bằng dòng <code>---</code>
                </span>
              </div>
              <TextArea
                rows={6}
                value={batchRawText}
                onChange={(e) => setBatchRawText(e.target.value)}
                placeholder="Dán toàn bộ bài viết vào đây (hỗ trợ 50 bài). Phân cách giữa các bài bằng ký hiệu ---&#10;&#10;Ví dụ:&#10;Nội dung bài viết 1...&#10;---&#10;Nội dung bài viết 2..."
                className="font-sans text-xs rounded-xl bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-600 p-3"
              />
              <div className="flex items-center justify-end gap-2">
                <Button size="small" onClick={() => setShowBatchTextInput(false)} className="rounded-lg">
                  Đóng
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={handleApplyBatchRawText}
                  className="bg-blue-600 font-bold rounded-lg"
                >
                  Tạo danh sách bài
                </Button>
              </div>
            </div>
          )}

          {/* TIẾN TRÌNH UPLOAD ẢNH NẾU ĐANG CHẠY */}
          {isUploadingMedia && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-3 text-xs text-emerald-200">
              <LoadingOutlined spin className="text-emerald-400" />
              <span>Đang tải lên {uploadProgress?.done}/{uploadProgress?.total} ảnh ({uploadProgress?.percent}%)...</span>
              <Progress percent={uploadProgress?.percent || 0} strokeColor="#10b981" trailColor="#1e293b" size="small" className="!m-0 flex-1" />
            </div>
          )}

          {/* MASTER-DETAIL 2 CỘT: BÊN TRÁI DANH SÁCH 50 BÀI, BÊN PHẢI SOẠN BÀI ĐANG CHỌN */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch h-[calc(100vh-220px)] min-h-[520px]">
            {/* CỘT TRÁI: DANH SÁCH BÀI VIẾT (WIDTH: 320px - 360px) */}
            <div className="w-full md:w-80 lg:w-96 shrink-0 bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex flex-col h-full shadow-lg">
              {/* Header của danh sách */}
              <div className="space-y-2 pb-2.5 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    Danh sách bài
                    <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-emerald-400 font-mono text-[11px] font-bold">
                      {manualPosts.length}
                    </span>
                  </span>
                  {manualPosts.length > 1 && (
                    <Popconfirm
                      title="Xóa danh sách bài?"
                      onConfirm={() => {
                        setManualPosts([{ id: '1', content: '', mediaUrls: [], mediaKinds: [] }]);
                        setActiveManualPostId('1');
                      }}
                      okText="Xóa"
                      cancelText="Hủy"
                    >
                      <Button size="small" type="text" danger className="text-[11px] p-0 h-auto">
                        Làm mới
                      </Button>
                    </Popconfirm>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={addEmptyManualPost}
                    className="!bg-emerald-600 hover:!bg-emerald-500 !border-0 font-bold text-xs rounded-lg flex-1"
                  >
                    Thêm bài
                  </Button>
                  <Button
                    size="small"
                    icon={<SnippetsOutlined />}
                    onClick={() => setShowBatchTextInput(!showBatchTextInput)}
                    className={`text-xs rounded-lg ${showBatchTextInput ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                    title="Dán nhanh 50 bài viết phân cách bằng ---"
                  >
                    ⚡ Dán 50 bài
                  </Button>
                </div>

                <div className="flex items-center gap-1 pt-0.5">
                  <Button
                    size="small"
                    icon={<CloudUploadOutlined />}
                    onClick={() => bulkMediaInputRef.current?.click()}
                    className="text-[10px] rounded-lg bg-slate-800 text-slate-300 border-slate-700 flex-1 px-1 h-6"
                    title="Nạp nhiều ảnh từ máy tính"
                  >
                    Nạp ảnh
                  </Button>
                  <Button
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => folderInputRef.current?.click()}
                    className="text-[10px] rounded-lg bg-slate-800 text-slate-300 border-slate-700 flex-1 px-1 h-6"
                    title="Chọn thư mục ảnh"
                  >
                    Thư mục
                  </Button>
                  <Button
                    size="small"
                    icon={<FileExcelOutlined />}
                    onClick={() => excelInputRef.current?.click()}
                    className="text-[10px] rounded-lg bg-slate-800 text-slate-300 border-slate-700 flex-1 px-1 h-6"
                    title="Nhập file Excel"
                  >
                    Excel
                  </Button>
                </div>
              </div>

              {/* Danh sách cuộn từng bài */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 mt-2">
                {manualPosts.map((post, idx) => {
                  const isActive = post.id === (activePost?.id || manualPosts[0]?.id);
                  const lines = post.content.trim().split('\n').filter(Boolean);
                  const firstLine = lines[0] || `Bài viết #${idx + 1}`;
                  const snippet = lines.slice(1).join(' ').trim();
                  const wordCount = post.content.trim() ? post.content.trim().split(/\s+/).length : 0;
                  const hasMedia = post.mediaUrls.length > 0;

                  return (
                    <div
                      key={post.id}
                      onClick={() => setActiveManualPostId(post.id)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2.5 group relative ${
                        isActive
                          ? 'bg-emerald-950/40 border-emerald-500 shadow-md ring-1 ring-emerald-500/40'
                          : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 text-slate-400'
                      }`}
                    >
                      {/* Ảnh thumbnail hoặc số thứ tự */}
                      {hasMedia ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-700 bg-slate-950 relative">
                          <img src={post.mediaUrls[0]} alt="" className="w-full h-full object-cover" />
                          {post.mediaUrls.length > 1 && (
                            <span className="absolute bottom-0 right-0 bg-black/80 text-[8px] font-bold text-white px-1 rounded-tl">
                              +{post.mediaUrls.length - 1}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className={`w-10 h-10 rounded-lg shrink-0 border grid place-items-center font-black text-xs ${
                          isActive ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'
                        }`}>
                          #{idx + 1}
                        </div>
                      )}

                      {/* Tiêu đề & nội dung tóm tắt */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
                            #{idx + 1}. {firstLine}
                          </span>
                          {manualPosts.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteManualPost(post.id);
                              }}
                              className="text-slate-500 hover:text-rose-400 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer text-xs"
                              title="Xóa bài này"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {snippet || (post.content.trim() ? post.content.trim() : 'Chưa có nội dung...')}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px]">
                          <span className="text-slate-400">{wordCount} từ</span>
                          <span className="text-slate-600">·</span>
                          {hasMedia ? (
                            <span className="text-emerald-400 font-semibold">{post.mediaUrls.length} ảnh</span>
                          ) : (
                            <span className="text-slate-500">Chưa có ảnh</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CỘT PHẢI: KHUNG SOẠN BÀI ĐANG CHỌN (GỌN GÀNG, THOÁNG ĐÃNG) */}
            <div
              tabIndex={0}
              onPaste={(e) => handlePasteEventOnPost(activePost.id, e)}
              className="flex-1 min-w-0 max-w-5xl bg-[#0d1627] border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col h-full shadow-lg outline-none focus:border-emerald-500/80 transition-all"
            >
              {/* Tiêu đề thanh công cụ của bài đang chọn */}
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-black text-xs grid place-items-center">
                    #{activePostIndex + 1}
                  </span>
                  <span className="text-sm font-bold text-slate-100">
                    Bài viết {activePostIndex + 1} / {manualPosts.length}
                  </span>
                  <span className="text-xs text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full">
                    {activePost.content.trim() ? `${activePost.content.trim().split(/\s+/).length} từ · ${activePost.content.length} ký tự` : 'Chưa nhập nội dung'}
                  </span>
                  {activePost.mediaUrls.length > 0 ? (
                    <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                      {activePost.mediaUrls.length} ảnh đính kèm
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 bg-slate-800/60 px-2.5 py-0.5 rounded-full">
                      Chưa có ảnh
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<PictureOutlined className="text-emerald-400" />}
                    onClick={() => handlePasteFromClipboardButton(activePost.id)}
                    className="bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 font-bold text-xs rounded-lg h-7 px-3"
                    title="Dán ảnh bạn vừa Copy ở ngoài vào bài này"
                  >
                    📋 Dán ảnh (Ctrl+V)
                  </Button>

                  <Button
                    size="small"
                    icon={<CloudUploadOutlined className="text-sky-400" />}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.accept = 'image/*,video/mp4';
                      input.onchange = (e: any) => {
                        if (e.target.files) handleUploadSinglePostMedia(activePost.id, e.target.files);
                      };
                      input.click();
                    }}
                    className="bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 text-xs rounded-lg h-7 px-3 hidden sm:inline-flex"
                  >
                    Chọn ảnh
                  </Button>

                  <Tooltip title="Nhân bản bài này">
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined className="text-slate-400 text-xs" />}
                      onClick={() => cloneManualPost(activePost.id)}
                      className="h-7 w-7 rounded-lg hover:bg-slate-800"
                    />
                  </Tooltip>

                  {manualPosts.length > 1 && (
                    <Tooltip title="Xóa bài này">
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined className="text-rose-400 text-xs" />}
                        onClick={() => deleteManualPost(activePost.id)}
                        className="h-7 w-7 rounded-lg hover:bg-rose-500/20"
                      />
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Khung nhập nội dung bài viết (vừa vặn, tự do co giãn, không bị kéo bè) */}
              <div className="flex-1 min-h-[180px] py-3 flex flex-col">
                <TextArea
                  value={activePost.content}
                  onChange={(e) => {
                    const val = e.target.value;
                    setManualPosts((prev) =>
                      prev.map((p) => (p.id === activePost.id ? { ...p, content: val } : p))
                    );
                  }}
                  onPaste={(e) => handlePasteEventOnPost(activePost.id, e)}
                  placeholder="Gõ hoặc dán nội dung bài viết vào đây (thoải mái viết bài dài nhiều đoạn, xuống dòng, chèn emoji...)"
                  className="w-full text-sm leading-relaxed rounded-xl bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 p-3.5 font-sans flex-1 resize-none"
                />
              </div>

              {/* Album ảnh đính kèm của bài đang chọn */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleUploadSinglePostMedia(activePost.id, e.dataTransfer.files);
                  }
                }}
                className="pt-2.5 border-t border-slate-800/80"
              >
                {activePost.mediaUrls.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">
                        Album ảnh đính kèm ({activePost.mediaUrls.length} ảnh):
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Bấm Ctrl+V bất cứ lúc nào để dán thêm ảnh vào bài này
                      </span>
                    </div>
                    <Image.PreviewGroup>
                      <div className="flex items-center gap-3 flex-wrap max-h-36 overflow-y-auto py-1">
                        {activePost.mediaUrls.map((imgSrc, imgIdx) => (
                          <div
                            key={imgIdx}
                            className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 w-20 h-20 shrink-0 group shadow-md"
                          >
                            <Image
                              src={imgSrc}
                              alt={`Ảnh ${imgIdx + 1}`}
                              className="!w-full !h-full !object-cover cursor-pointer"
                            />
                            {imgIdx === 0 && (
                              <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow pointer-events-none">
                                #1 Bìa
                              </span>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-black/80 p-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="flex items-center gap-0.5">
                                {imgIdx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => moveSinglePostMedia(activePost.id, imgIdx, imgIdx - 1)}
                                    className="w-4 h-4 rounded bg-slate-800 text-white text-[9px] grid place-items-center cursor-pointer border-0"
                                    title="Đưa lên trước"
                                  >
                                    ←
                                  </button>
                                )}
                                {imgIdx < activePost.mediaUrls.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={() => moveSinglePostMedia(activePost.id, imgIdx, imgIdx + 1)}
                                    className="w-4 h-4 rounded bg-slate-800 text-white text-[9px] grid place-items-center cursor-pointer border-0"
                                    title="Đưa về sau"
                                  >
                                    →
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeSinglePostMedia(activePost.id, imgIdx)}
                                className="w-4 h-4 rounded bg-red-600 text-white text-[9px] grid place-items-center cursor-pointer border-0"
                                title="Xóa ảnh này"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Ô THÊM ẢNH NHANH */}
                        <label
                          className="rounded-xl border border-dashed border-slate-700 hover:border-emerald-500 bg-slate-950/40 hover:bg-slate-950 w-20 h-20 shrink-0 flex flex-col items-center justify-center cursor-pointer transition-colors text-slate-400 hover:text-emerald-400"
                          title="Thêm hoặc dán thêm ảnh vào bài này"
                        >
                          <PlusOutlined className="text-base mb-0.5" />
                          <span className="text-[10px] font-bold">Thêm ảnh</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*,video/mp4"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              if (e.target.files) {
                                handleUploadSinglePostMedia(activePost.id, e.target.files);
                                e.target.value = '';
                              }
                            }}
                          />
                        </label>
                      </div>
                    </Image.PreviewGroup>
                  </div>
                ) : (
                  /* Khung dán ảnh khi chưa có ảnh */
                  <div
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.accept = 'image/*,video/mp4';
                      input.onchange = (e: any) => {
                        if (e.target.files) handleUploadSinglePostMedia(activePost.id, e.target.files);
                      };
                      input.click();
                    }}
                    className="border border-dashed border-slate-700/80 hover:border-emerald-500 rounded-xl py-3 px-4 flex items-center justify-between cursor-pointer bg-slate-950/40 hover:bg-slate-950 transition-colors flex-wrap gap-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <PictureOutlined className="text-lg text-emerald-400" />
                      <span className="text-xs text-slate-300">
                        Đính kèm ảnh: Bấm <span className="text-emerald-400 font-bold">Ctrl+V</span> (hoặc <span className="text-emerald-400 font-bold">Cmd+V</span>) để dán ảnh đã copy
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      hoặc click để chọn ảnh từ máy
                    </span>
                  </div>
                )}
              </div>

              {/* Thanh điều hướng bài trước / bài sau ở chân khung soạn */}
              <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    disabled={activePostIndex === 0}
                    onClick={goToPrevPost}
                    className="rounded-lg text-xs"
                  >
                    ← Bài trước
                  </Button>
                  <span className="text-slate-400 font-medium px-2">
                    Bài {activePostIndex + 1} / {manualPosts.length}
                  </span>
                  <Button
                    size="small"
                    disabled={activePostIndex === manualPosts.length - 1}
                    onClick={goToNextPost}
                    className="rounded-lg text-xs"
                  >
                    Bài tiếp theo →
                  </Button>
                </div>

                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={addEmptyManualPost}
                  className="bg-emerald-950/60 text-emerald-400 border-emerald-500/40 hover:bg-emerald-900/60 text-xs rounded-lg font-bold"
                >
                  Thêm bài mới
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default memo(BulkPasteDrawer, (prev, next) => !prev.bulkModalVisible && !next.bulkModalVisible);
