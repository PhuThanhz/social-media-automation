import type React from 'react';
import { useState } from 'react';
import { App } from 'antd';
import type { PostLinkItem, ItemPreview } from './types';

interface CreditHashtagParams {
  setLinkItems: React.Dispatch<React.SetStateAction<PostLinkItem[]>>;
  bulkDrawerPreviews: Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>;
  previews: Record<string, ItemPreview>;
  linkItems: PostLinkItem[];
}

// Ghi nguồn (Cre) và hashtag hàng loạt / từng bài — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useCreditHashtag({ setLinkItems, bulkDrawerPreviews, previews, linkItems }: CreditHashtagParams) {
  const { message } = App.useApp();
  // State quản lý Cre Custom (Gán dòng Cre tùy chỉnh hàng loạt hoặc đơn lẻ)
  const [isCustomCreModalOpen, setIsCustomCreModalOpen] = useState(false);
  const [customCreInput, setCustomCreInput] = useState('');
  const [customCreTargetItemId, setCustomCreTargetItemId] = useState<string | null>(null);

  // State quản lý Hashtag Hàng Loạt (Gán Hashtag hàng loạt hoặc đơn lẻ)
  const [isHashtagModalOpen, setIsHashtagModalOpen] = useState(false);
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtagTargetItemId, setHashtagTargetItemId] = useState<string | null>(null);

  // Bật đính kèm link nguồn tác giả cho TOÀN BỘ bài viết
  const applyEnableAllCredit = () => {
    setLinkItems((prev) =>
      prev.map((item) => ({ ...item, includeCredit: true }))
    );
    message.success('🔗 Đã BẬT đính kèm link nguồn bài viết cho TOÀN BỘ bài viết!');
  };

  // Tắt đính kèm link nguồn tác giả cho TOÀN BỘ bài viết
  const applyDisableAllCredit = () => {
    setLinkItems((prev) =>
      prev.map((item) => ({ ...item, includeCredit: false }))
    );
    message.success('🚫 Đã TẮT đính kèm link nguồn cho TOÀN BỘ bài viết!');
  };

  // Helper thay thế hoặc thêm dòng Cre: ... vào cuối caption
  const replaceOrAppendCreditText = (caption: string, creditText: string) => {
    const cleanCap = (caption || '').trim();
    let nameOnly = (creditText || '').trim();
    if (!nameOnly) return cleanCap;

    // Loại bỏ tiền tố Cre: hoặc cre: nếu có trong creditText để tránh lặp (Cre: Cre: ...)
    nameOnly = nameOnly.replace(/^(cre:\s*)+/i, '').trim();
    if (!nameOnly) return cleanCap;

    // Nếu caption đã có dòng "Cre: ..." hoặc "Cre: Cre: ..." ở cuối, thay thế sạch bằng "Cre: [nameOnly]"
    if (/(\n+|^)(Cre:\s*)+.*$/i.test(cleanCap)) {
      return cleanCap.replace(/(\n+|^)(Cre:\s*)+.*$/i, `$1Cre: ${nameOnly}`);
    }

    return cleanCap ? `${cleanCap}\n\nCre: ${nameOnly}` : `Cre: ${nameOnly}`;
  };

  // Thêm Cre: Member ẩn danh cho TOÀN BỘ bài viết trong danh sách (cập nhật trực tiếp ô Caption trên UI)
  const applyAnonymousCreditToAll = () => {
    setLinkItems((prev) =>
      prev.map((item) => {
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = replaceOrAppendCreditText(curCap, 'Member ẩn danh');
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );
    message.success('👤 Đã cập nhật "Cre: Member ẩn danh" vào ô Caption cho TOÀN BỘ bài viết!');
  };

  // Lấy tên người đăng gốc (Tác giả gốc) cho TOÀN BỘ bài viết trong danh sách (cập nhật trực tiếp ô Caption trên UI)
  const applyOriginalAuthorCreditToAll = () => {
    setLinkItems((prev) =>
      prev.map((item) => {
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const rawAuthor = previews[item.id]?.author || bulkDrawerPreviews[item.url]?.author || '';
        const isAnon = !rawAuthor || /ẩn danh|anonymous|thành viên nhóm|thành viên ẩn danh|member/i.test(rawAuthor);
        const authorName = isAnon ? 'Member ẩn danh' : rawAuthor;
        const updatedCaption = replaceOrAppendCreditText(curCap, authorName);
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );
    message.success('👤 Đã cập nhật "Cre: Tác giả gốc" vào ô Caption cho TOÀN BỘ bài viết!');
  };

  // Mở Modal nhập Cre tùy chỉnh (targetItemId = null là áp dụng hàng loạt cho tất cả bài viết)
  const openCustomCreModal = (targetItemId: string | null = null) => {
    setCustomCreTargetItemId(targetItemId);
    setCustomCreInput('');
    setIsCustomCreModalOpen(true);
  };

  // Áp dụng Cre tùy chỉnh cho bài viết
  const applyCustomCreditToPosts = (textToApply: string) => {
    const cleanText = (textToApply || '').trim();
    if (!cleanText) {
      message.warning('Vui lòng nhập nội dung Cre!');
      return;
    }

    setLinkItems((prev) =>
      prev.map((item) => {
        if (customCreTargetItemId && item.id !== customCreTargetItemId) {
          return item;
        }
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = replaceOrAppendCreditText(curCap, cleanText);
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );

    if (customCreTargetItemId) {
      message.success(`✏️ Đã cập nhật "Cre: ${cleanText}" cho bài viết!`);
    } else {
      message.success(`✏️ Đã cập nhật "Cre: ${cleanText}" vào ô Caption cho TOÀN BỘ ${linkItems.length} bài viết!`);
    }
    setIsCustomCreModalOpen(false);
  };

  // Helper chèn hoặc nối Hashtag vào caption
  const appendHashtagTextToCaption = (caption: string, hashtagText: string) => {
    const cleanCap = (caption || '').trim();
    let rawTags = (hashtagText || '').trim();
    if (!rawTags) return cleanCap;

    // Chuẩn hóa danh sách hashtag: tách theo dấu phẩy hoặc khoảng trắng
    const formattedTags = rawTags
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(' ');

    if (!formattedTags) return cleanCap;

    // Kiểm tra nếu caption đã có dòng Cre ở cuối, chèn Hashtag phía TRƯỚC dòng Cre để giữ cấu trúc đẹp
    if (/(\n+|^)(Cre:\s*)+.*$/i.test(cleanCap)) {
      return cleanCap.replace(/(\n+|^)((?:Cre:\s*)+.*$)/i, (match, p1, p2) => {
        return `\n\n${formattedTags}\n\n${p2}`;
      });
    }

    return cleanCap ? `${cleanCap}\n\n${formattedTags}` : formattedTags;
  };

  // Mở Modal Hashtag (targetItemId = null là áp dụng hàng loạt cho tất cả bài viết)
  const openHashtagModal = (targetItemId: string | null = null) => {
    setHashtagTargetItemId(targetItemId);
    setHashtagInput('');
    setIsHashtagModalOpen(true);
  };

  // Áp dụng Hashtag cho bài viết
  const applyHashtagsToPosts = (tagsText: string) => {
    const cleanText = (tagsText || '').trim();
    if (!cleanText) {
      message.warning('Vui lòng nhập hoặc chọn ít nhất 1 hashtag!');
      return;
    }

    setLinkItems((prev) =>
      prev.map((item) => {
        if (hashtagTargetItemId && item.id !== hashtagTargetItemId) {
          return item;
        }
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = appendHashtagTextToCaption(curCap, cleanText);
        return {
          ...item,
          customCaption: updatedCaption,
        };
      })
    );

    if (hashtagTargetItemId) {
      message.success('🏷️ Đã thêm Hashtag cho bài viết!');
    } else {
      message.success(`🏷️ Đã chèn Hashtag cho TOÀN BỘ ${linkItems.length} bài viết!`);
    }
    setIsHashtagModalOpen(false);
  };

  return {
    isCustomCreModalOpen,
    isHashtagModalOpen,
    replaceOrAppendCreditText,
    applyAnonymousCreditToAll,
    applyEnableAllCredit,
    applyDisableAllCredit,
    applyOriginalAuthorCreditToAll,
    openCustomCreModal,
    openHashtagModal,
    setIsCustomCreModalOpen,
    customCreInput,
    setCustomCreInput,
    customCreTargetItemId,
    applyCustomCreditToPosts,
    setIsHashtagModalOpen,
    hashtagInput,
    setHashtagInput,
    hashtagTargetItemId,
    applyHashtagsToPosts,
  };
}
