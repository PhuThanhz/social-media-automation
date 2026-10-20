// Tách nền logo ngay trên trình duyệt: loang (flood fill) từ mép ảnh, xoá các điểm gần màu nền (thường là nền
// trắng/1 màu), làm mềm viền rồi cắt sát phần còn lại. Hợp với logo phẳng; ảnh chụp phức tạp thì giữ nguyên.

const MAX_SIDE = 1200;

const loadFileImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh logo')); };
    img.src = url;
  });

export interface RemovedBackground {
  blob: Blob;
  aspect: number; // cao/rộng sau khi cắt sát
}

/** Trả về null nếu logo đã có nền trong suốt hoặc nền không đồng màu (không tách được an toàn). */
export async function removeLogoBackground(file: File, tolerance = 42): Promise<RemovedBackground | null> {
  const img = await loadFileImage(file);
  const ratio = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Màu nền = trung bình các điểm trên viền ảnh; viền đã trong suốt thì coi như logo sẵn nền trong
  let r = 0, g = 0, b = 0, n = 0, transparentEdge = 0;
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
  for (const i of edge) {
    const o = i * 4;
    if (px[o + 3] < 20) { transparentEdge++; continue; }
    r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
  }
  if (transparentEdge > edge.length * 0.6 || n === 0) return null;
  r /= n; g /= n; b /= n;

  const dist = (o: number) => Math.sqrt((px[o] - r) ** 2 + (px[o + 1] - g) ** 2 + (px[o + 2] - b) ** 2);
  // Viền không đồng màu (ảnh chụp) → không tách
  const edgeFar = edge.filter((i) => px[i * 4 + 3] >= 20 && dist(i * 4) > tolerance * 1.5).length;
  if (edgeFar > edge.length * 0.25) return null;

  // Loang từ mép
  const removed = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const i of edge) {
    if (!removed[i] && (px[i * 4 + 3] < 20 || dist(i * 4) <= tolerance)) { removed[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of neighbors) {
      if (j < 0 || removed[j]) continue;
      const o = j * 4;
      if (px[o + 3] < 20 || dist(o) <= tolerance) { removed[j] = 1; stack.push(j); }
    }
  }

  // Xoá nền + làm mềm viền: điểm sát vùng đã xoá mà gần màu nền thì giảm độ đục theo khoảng cách màu
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (removed[i]) { px[o + 3] = 0; continue; }
    // Lỗ bên trong chữ (a, o, R...) không nối với mép nhưng cũng là nền → xoá điểm rất gần màu nền
    if (dist(o) <= tolerance * 0.6) { px[o + 3] = 0; continue; }
    const x = i % w;
    const nearRemoved = (x > 0 && removed[i - 1]) || (x < w - 1 && removed[i + 1]) || (i >= w && removed[i - w]) || (i < w * (h - 1) && removed[i + w]);
    if (nearRemoved) {
      const d = dist(o);
      if (d < tolerance * 2.2) px[o + 3] = Math.round(px[o + 3] * Math.min(1, (d - tolerance * 0.5) / (tolerance * 1.7)));
    }
  }
  ctx.putImageData(data, 0, 0);

  // Cắt sát phần còn lại
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // xoá hết → nền và logo cùng màu
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/png'));
  return blob ? { blob, aspect: ch / cw } : null;
}
