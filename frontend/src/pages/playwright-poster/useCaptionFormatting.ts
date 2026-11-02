import { useState } from 'react';
import { App } from 'antd';
import type { PostLinkItem } from './types';

interface CaptionFormattingParams {
  linkItems: PostLinkItem[];
  updateLinkManualContent: (id: string, manualContent: string) => void;
}

// Định dạng chữ Unicode (in đậm, nghiêng, tiêu đề...) và chèn mẫu vào caption — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useCaptionFormatting({ linkItems, updateLinkManualContent }: CaptionFormattingParams) {
  const { message } = App.useApp();
  // Chuyển đổi chữ thường sang chữ in đậm Unicode kiểu Facebook (Sans Bold: 𝗔𝗕𝗖)
  const toUnicodeBold = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠',
      N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
      a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷', k: '𝗸', l: '𝗹', m: '𝗺',
      n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁', u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
      '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In đậm có chân (Serif Bold: 𝐀𝐁𝐂)
  const toUnicodeSerifBold = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝐀', B: '𝐁', C: '𝐂', D: '𝐃', E: '𝐄', F: '𝐅', G: '𝐆', H: '𝐇', I: '𝐈', J: '𝐉', K: '𝐊', L: '𝐋', M: '𝐌',
      N: '𝐍', O: '𝐎', P: '𝐏', Q: '𝐐', R: '𝐑', S: '𝐒', T: '𝐓', U: '𝐔', V: '𝐕', W: '𝐖', X: '𝐗', Y: '𝐘', Z: '𝐙',
      a: '𝐚', b: '𝐛', c: '𝐜', d: '𝐝', e: '𝐞', f: '𝐟', g: '𝐠', h: '𝐡', i: '𝐢', j: '𝐣', k: '𝐤', l: '𝐥', m: '𝐦',
      n: '𝐧', o: '𝐨', p: '𝐩', q: '𝐪', r: '𝐫', s: '𝐬', t: '𝐭', u: '𝐮', v: '𝐯', w: '𝐰', x: '𝐱', y: '𝐲', z: '𝐳',
      '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In nghiêng (Italic Sans: 𝘈𝘉𝘊)
  const toUnicodeItalic = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝘈', B: '𝘉', C: '𝘊', D: '𝘋', E: '𝘌', F: '𝘍', G: '𝘎', H: '𝘏', I: '𝘐', J: '𝘑', K: '𝘒', L: '𝘓', M: '𝘔',
      N: '𝘕', O: '𝘖', P: '𝘗', Q: '𝘘', R: '𝘙', S: '𝘚', T: '𝘛', U: '𝘜', V: '𝘝', W: '𝘞', X: '𝘟', Y: '𝘠', Z: '𝘡',
      a: '𝘢', b: '𝘣', c: '𝘤', d: '𝘥', e: '𝘦', f: '𝘧', g: '𝘨', h: '𝘩', i: '𝘪', j: '𝘫', k: '𝘬', l: '𝘭', m: '𝘮',
      n: '𝘯', o: '𝘰', p: '𝘱', q: '𝘲', r: '𝘳', s: '𝘴', t: '𝘵', u: '𝘶', v: '𝘷', w: '𝘸', x: '𝘹', y: '𝘺', z: '𝘻'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In đậm nghiêng (Bold Italic Sans: 𝘼𝘽𝘾)
  const toUnicodeBoldItalic = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝘼', B: '𝘽', C: '𝘾', D: '𝘿', E: '𝙀', F: '𝙁', G: '𝙂', H: '𝙃', I: '𝙄', J: '𝙅', K: '𝙆', L: '𝙇', M: '𝙈',
      N: '𝙉', O: '𝙊', P: '𝙋', Q: '𝙌', R: '𝙍', S: '𝙎', T: '𝙏', U: '𝙐', V: '𝙑', W: '𝙒', X: '𝙓', Y: '𝙔', Z: '𝙕',
      a: '𝙖', b: '𝙗', c: '𝙘', d: '𝙙', e: '𝙚', f: '𝙛', g: '𝙜', h: '𝙝', i: '𝙞', j: '𝙟', k: '𝙠', l: '𝙡', m: '𝙢',
      n: '𝙣', o: '𝙤', p: '𝙥', q: '𝙦', r: '𝙧', s: '𝙨', t: '𝙩', u: '𝙪', v: '𝙫', w: '𝙬', x: '𝙭', y: '𝙮', z: '𝙯'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // Gạch ngang (Strikethrough: ̶g̶i̶á̶ ̶c̶ũ̶)
  const toUnicodeStrikethrough = (text: string) => {
    return text.split('').map(c => (c === '\n' || c === '\r' ? c : c + '\u0336')).join('');
  };

  // Gạch chân (Underline: u̲n̲d̲e̲r̲l̲i̲n̲e̲)
  const toUnicodeUnderline = (text: string) => {
    return text.split('').map(c => (c === '\n' || c === '\r' ? c : c + '\u0332')).join('');
  };

  // Đóng khung vuông / tag nổi bật (【 TEXT 】)
  const toUnicodeBoxedTag = (text: string) => {
    const bolded = toUnicodeBold(text.trim());
    return `【 ${bolded} 】`;
  };

  // Định dạng Tiêu đề Lớn H1 (Heading 1)
  const toUnicodeHeading1 = (text: string) => {
    const clean = text.trim();
    const bolded = toUnicodeBold(clean.toUpperCase());
    return `📌 ━━━━━━━━ ${bolded} ━━━━━━━━\n`;
  };

  // Định dạng Tiêu đề Vừa H2 (Heading 2)
  const toUnicodeHeading2 = (text: string) => {
    const clean = text.trim();
    const bolded = toUnicodeBold(clean);
    return `👉 ${bolded}:\n`;
  };

  // Áp dụng định dạng thông minh cho đoạn văn bản đang bôi đen hoặc toàn bộ ô soạn bài
  const applyTransformToSelection = (id: string, transformFn: (text: string) => string, successMsg?: string) => {
    const el = document.getElementById(`manual-content-textarea-${id}`) as HTMLTextAreaElement | null;
    const item = linkItems.find((i) => i.id === id);
    const currentVal = item?.manualContent || '';
    if (!el) {
      updateLinkManualContent(id, transformFn(currentVal));
      if (successMsg) message.success(successMsg);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== undefined && end !== undefined && start !== end) {
      const selected = currentVal.substring(start, end);
      const transformed = transformFn(selected);
      const nextVal = currentVal.substring(0, start) + transformed + currentVal.substring(end);
      updateLinkManualContent(id, nextVal);
      if (successMsg) message.success(successMsg);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + transformed.length);
      }, 50);
    } else {
      if (currentVal.trim()) {
        updateLinkManualContent(id, transformFn(currentVal));
        if (successMsg) message.success(successMsg);
      } else {
        const sample = transformFn('Tiêu đề bài viết');
        updateLinkManualContent(id, sample);
        if (successMsg) message.success(successMsg);
      }
    }
  };

  // Chèn mẫu nội dung (CTA, Đường kẻ, Bullet point...) ngay tại vị trí con trỏ
  const insertSnippetAtCursor = (id: string, snippet: string) => {
    const el = document.getElementById(`manual-content-textarea-${id}`) as HTMLTextAreaElement | null;
    const item = linkItems.find((i) => i.id === id);
    const currentVal = item?.manualContent || '';
    if (!el) {
      const spacer = currentVal && !currentVal.endsWith('\n') ? '\n' : '';
      updateLinkManualContent(id, currentVal + spacer + snippet);
      return;
    }
    const start = el.selectionStart ?? currentVal.length;
    const end = el.selectionEnd ?? currentVal.length;
    const nextVal = currentVal.substring(0, start) + snippet + currentVal.substring(end);
    updateLinkManualContent(id, nextVal);
    setTimeout(() => {
      el.focus();
      const nextPos = start + snippet.length;
      el.setSelectionRange(nextPos, nextPos);
    }, 50);
  };

  const [dragOverDropzone, setDragOverDropzone] = useState<string | null>(null);

  return {
    toUnicodeBold,
    toUnicodeSerifBold,
    toUnicodeItalic,
    toUnicodeBoldItalic,
    toUnicodeStrikethrough,
    toUnicodeUnderline,
    toUnicodeBoxedTag,
    toUnicodeHeading1,
    toUnicodeHeading2,
    applyTransformToSelection,
    insertSnippetAtCursor,
    setDragOverDropzone,
    dragOverDropzone,
  };
}
