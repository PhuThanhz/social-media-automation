import { useRef } from 'react';

// true kể từ lần đầu `open` bật lên (giữ nguyên sau khi đóng) — dùng để chỉ tải/mount modal lazy khi đã mở ít nhất 1 lần,
// sau đó giữ mount để state, animation đóng và nội dung giữ y như trước.
export function useOpenedOnce(open: boolean): boolean {
  const openedRef = useRef(open);
  if (open) openedRef.current = true;
  return openedRef.current;
}
