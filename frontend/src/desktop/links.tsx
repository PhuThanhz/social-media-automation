/**
 * Bản Desktop: webview không mở cửa sổ mới (target=_blank, window.open) và không tự tải file.
 * Cài một lần lúc khởi động để mọi trang dùng được mà không phải sửa từng chỗ:
 * - link ngoài → trình duyệt mặc định
 * - link tải từ backend/worker local → Downloads; link xem file local → trình duyệt
 * - <a download> / blob: → lưu thẳng vào Downloads
 */
import { Button, message, notification } from 'antd';
import { runtime } from '../config/runtime';

async function invoke<T>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args as Record<string, unknown>, options);
}

// Giữ Blob theo object URL: nhiều trang revokeObjectURL ngay sau click(), trước khi kịp đọc lại
const blobs = new Map<string, Blob>();

const isLocalService = (url: string) =>
  url.startsWith(runtime.backendBase) || url.startsWith(runtime.workerBase);

function notifySaved(path: string) {
  const name = path.split(/[\\/]/).pop();
  const key = `dl-${path}`;
  notification.success({
    key,
    message: 'Đã tải xong',
    description: `Đã lưu vào Downloads: ${name}`,
    duration: 8,
    btn: (
      <Button size="small" type="primary" onClick={() => { invoke('reveal_download', { path }); notification.destroy(key); }}>
        Mở thư mục
      </Button>
    ),
  });
}

async function withProgress(task: () => Promise<string>) {
  const hide = message.loading('Đang tải file...', 0);
  try {
    notifySaved(await task());
  } catch (e) {
    message.error(String(e));
  } finally {
    hide();
  }
}

async function saveBlob(blob: Blob, filename: string) {
  await withProgress(async () => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return invoke<string>('save_download', bytes, { headers: { 'x-filename': encodeURIComponent(filename) } });
  });
}

function filenameFromUrl(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'tai-xuong';
  } catch {
    return 'tai-xuong';
  }
}

/** true = đã xử lý, không để webview tự làm */
function handleLink(href: string, opts: { download?: string | null }): boolean {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;

  if (href.startsWith('blob:') || href.startsWith('data:')) {
    if (opts.download === undefined || opts.download === null) return false;
    const name = opts.download || 'tai-xuong';
    const blob = blobs.get(href);
    if (blob) saveBlob(blob, name);
    else fetch(href).then((r) => r.blob()).then((b) => saveBlob(b, name)).catch((e) => message.error(String(e)));
    return true;
  }

  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }

  // Không bao giờ để webview điều hướng ra khỏi app (mất giao diện, không có nút quay lại)
  if (isLocalService(url.href)) {
    const isDownload = opts.download != null || /\/download/i.test(url.pathname);
    if (isDownload) {
      withProgress(() => invoke<string>('download_url', { url: url.href, filename: opts.download || null }));
    } else {
      invoke('open_external', { url: url.href }).catch((e) => message.error(String(e)));
    }
    return true;
  }

  const external = url.origin !== window.location.origin && /^(https?|mailto|tel):$/.test(url.protocol);
  if (external) {
    invoke('open_external', { url: url.href }).catch((e) => message.error(String(e)));
    return true;
  }
  return false;
}

export function installDesktopLinks() {
  const nativeCreate = URL.createObjectURL.bind(URL);
  const nativeRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const href = nativeCreate(obj);
    if (obj instanceof Blob) blobs.set(href, obj);
    return href;
  };
  URL.revokeObjectURL = (href: string) => {
    nativeRevoke(href);
    setTimeout(() => blobs.delete(href), 60_000);
  };

  const anchorInfo = (a: HTMLAnchorElement) => ({
    download: a.hasAttribute('download') ? a.getAttribute('download') || filenameFromUrl(a.href) : null,
  });

  // Link trong trang (kể cả <Button href target=_blank> của antd)
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && handleLink(a.getAttribute('href') || '', anchorInfo(a))) e.preventDefault();
    },
    true,
  );

  // Thẻ <a> tạo bằng code rồi gọi .click() mà không gắn vào trang → event không tới document
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.isConnected && handleLink(this.getAttribute('href') || '', anchorInfo(this))) return;
    nativeClick.call(this);
  };

  window.open = ((target?: string | URL) => {
    const href = target ? String(target) : '';
    handleLink(href, { download: null });
    return null;
  }) as typeof window.open;
}
