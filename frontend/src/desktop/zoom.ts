import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'desktop_interface_zoom';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export function zoomForKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>, current: number): number | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  if (event.key === '0' || event.code === 'Numpad0') return 1;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd')
    return Math.min(MAX_ZOOM, Math.round((current + 0.1) * 10) / 10);
  if (event.key === '-' || event.code === 'NumpadSubtract')
    return Math.max(MIN_ZOOM, Math.round((current - 0.1) * 10) / 10);
  return null;
}

/** Native webview zoom includes dialogs, fixed panels and text without CSS scaling. */
export function installDesktopZoom(): () => void {
  let zoom = 1;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_ZOOM && saved <= MAX_ZOOM) zoom = saved;
  } catch { /* Zoom remains usable when storage is unavailable. */ }

  // Serialize native calls so quick repeated key presses cannot restore an older level.
  let pending = Promise.resolve();
  const apply = (factor: number) => {
    pending = pending.then(async () => {
      await invoke('set_interface_zoom', { factor });
      try { localStorage.setItem(STORAGE_KEY, String(factor)); } catch { /* optional persistence */ }
    }).catch((error) => console.error('Không thể thay đổi độ phóng giao diện:', error));
  };
  apply(zoom);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const next = zoomForKey(event, zoom);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    zoom = next;
    apply(zoom);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
