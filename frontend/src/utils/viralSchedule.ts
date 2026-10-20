import dayjs, { Dayjs } from 'dayjs';

// Trọng số mức độ online/tương tác Facebook Việt Nam theo giờ (0h → 23h).
// Cao điểm: trưa 11h-13h và tối 19h-22h; gần như không đăng 0h-5h.
export const VN_ENGAGEMENT_WEIGHTS: number[] = [
  0.05, 0.05, 0.05, 0.05, 0.05, 0.05, // 0-5h
  0.5, 0.9, 0.9, 0.6, 0.6, 1.0,       // 6-11h
  1.3, 0.9, 0.6, 0.6, 0.6, 0.8,       // 12-17h
  0.9, 1.2, 1.5, 1.5, 1.1, 0.5,       // 18-23h
];

// Khung được coi là "giờ vàng" khi thống kê (11:00-13:59 và 19:00-22:59)
export const isGoldenHour = (t: Dayjs) => {
  const h = t.hour();
  return (h >= 11 && h <= 13) || (h >= 19 && h <= 22);
};

const hourWeight = (t: Dayjs) => {
  const h = t.hour();
  const day = t.day();
  const weekend = day === 0 || day === 6;
  return VN_ENGAGEMENT_WEIGHTS[h] * (weekend && h >= 9 && h <= 16 ? 1.1 : 1);
};

// PRNG có seed để preview ổn định giữa các lần render và khớp lúc bấm Áp dụng
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const normalizeTargetKey = (targetGroupNames?: string, targetFanpageId?: string) =>
  (targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '').trim() || targetFanpageId || 'PAGE_FEED';

export interface ViralItem {
  id: number;
  key: string; // điểm đăng (group / page)
}

export interface ViralOccupied {
  key: string;
  time: Dayjs;
}

export interface ViralOptions {
  startDate: Dayjs;
  startTime: Dayjs; // chỉ dùng giờ:phút — khung hoạt động mỗi ngày
  endTime: Dayjs;
  maxPerTargetPerDay: number;
  minGapPerTarget: number; // phút giữa 2 bài cùng điểm đăng
  minGapGlobal: number; // phút giữa 2 bài bất kỳ
  jitter: boolean;
  seed: number;
  now?: Dayjs;
}

export interface ViralResult {
  id: number;
  key: string;
  time: Dayjs;
}

// Sinh n mốc trong [from, to] theo phân phối trọng số giờ (inverse-CDF), giãn tối thiểu `gap` phút
const weightedSlots = (from: Dayjs, to: Dayjs, n: number, gap: number): Dayjs[] => {
  const total = to.diff(from, 'minute');
  if (n <= 0 || total < 0) return [];
  if (n === 1) {
    // 1 bài: đặt vào phút có trọng số cao nhất trong khung
    let best = 0;
    let bestW = -1;
    for (let m = 0; m <= total; m++) {
      const w = hourWeight(from.add(m, 'minute'));
      if (w > bestW) { bestW = w; best = m; }
    }
    return [from.add(best, 'minute')];
  }

  const cum: number[] = new Array(total + 1);
  let acc = 0;
  for (let m = 0; m <= total; m++) {
    acc += hourWeight(from.add(m, 'minute'));
    cum[m] = acc;
  }

  const mins: number[] = [];
  let idx = 0;
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * acc;
    while (idx < total && cum[idx] < target) idx++;
    mins.push(idx);
  }

  // Ép giãn cách: đẩy tới, nếu tràn quá cuối khung thì ép lùi từ cuối
  for (let i = 1; i < n; i++) mins[i] = Math.max(mins[i], mins[i - 1] + gap);
  if (mins[n - 1] > total) {
    mins[n - 1] = total;
    for (let i = n - 2; i >= 0; i--) mins[i] = Math.min(mins[i], mins[i + 1] - gap);
    for (let i = 0; i < n; i++) mins[i] = Math.max(0, mins[i]);
  }
  return mins.map((m) => from.add(m, 'minute'));
};

/**
 * Lịch "Giờ vàng Viral": dồn bài vào khung đông người online, mỗi điểm đăng được giãn cách
 * tối thiểu & giới hạn bài/ngày, chọn điểm đăng chờ lâu nhất cho mỗi slot (không dồn đuôi như round-robin).
 */
export const computeViralSchedule = (
  items: ViralItem[],
  occupied: ViralOccupied[],
  opts: ViralOptions,
): ViralResult[] => {
  if (items.length === 0) return [];

  const now = opts.now || dayjs();
  const rand = mulberry32(opts.seed);
  const gapT = Math.max(1, opts.minGapPerTarget);
  const gapG = Math.max(1, opts.minGapGlobal);
  const maxPerDay = Math.max(1, opts.maxPerTargetPerDay);

  // Hàng đợi riêng từng điểm đăng, giữ nguyên thứ tự cũ
  const queues = new Map<string, number[]>();
  items.forEach((it) => {
    if (!queues.has(it.key)) queues.set(it.key, []);
    queues.get(it.key)!.push(it.id);
  });

  const lastByKey = new Map<string, Dayjs>();
  const countByKeyDay = new Map<string, number>();
  const dayKey = (k: string, t: Dayjs) => `${k}|${t.format('YYYY-MM-DD')}`;
  const allTimes: Dayjs[] = [];

  occupied.forEach((o) => {
    const prev = lastByKey.get(o.key);
    if (!prev || o.time.isAfter(prev)) lastByKey.set(o.key, o.time);
    countByKeyDay.set(dayKey(o.key, o.time), (countByKeyDay.get(dayKey(o.key, o.time)) || 0) + 1);
    allTimes.push(o.time);
  });

  const tooCloseGlobal = (t: Dayjs): Dayjs | null => {
    for (const o of allTimes) {
      if (Math.abs(t.diff(o, 'second')) < gapG * 60) return o;
    }
    return null;
  };

  const result: ViralResult[] = [];
  let remaining = items.length;
  const sH = opts.startTime.hour();
  const sM = opts.startTime.minute();
  const eH = opts.endTime.hour();
  const eM = opts.endTime.minute();

  for (let d = 0; d < 365 && remaining > 0; d++) {
    const day = opts.startDate.startOf('day').add(d, 'day');
    let from = day.hour(sH).minute(sM).second(0);
    let to = day.hour(eH).minute(eM).second(0);
    if (!to.isAfter(from)) to = to.add(1, 'day');
    const earliest = now.add(5, 'minute').second(0);
    if (from.isBefore(earliest)) from = earliest;
    if (to.diff(from, 'minute') < 15) continue;
    const avail = to.diff(from, 'minute');

    // Số slot trong ngày = tổng sức chứa từng điểm đăng, chặn bởi giãn cách toàn cục
    const activeKeys = Array.from(queues.entries()).filter(([, q]) => q.length > 0).map(([k]) => k);
    let capacity = 0;
    activeKeys.forEach((k) => {
      const used = countByKeyDay.get(dayKey(k, from)) || 0;
      capacity += Math.min(queues.get(k)!.length, Math.max(0, maxPerDay - used), Math.floor(avail / gapT) + 1);
    });
    const slotGap = Math.max(gapG, Math.ceil(gapT / Math.max(1, activeKeys.length)));
    const nSlots = Math.min(remaining, capacity, Math.floor(avail / slotGap) + 1);
    if (nSlots <= 0) continue;

    let slots = weightedSlots(from, to, nSlots, slotGap);
    if (opts.jitter) {
      slots = slots.map((s) => {
        let t = s.add(Math.round((rand() * 2 - 1) * 4), 'minute');
        if (t.minute() % 5 === 0) t = t.add(rand() < 0.5 ? -1 : 1, 'minute');
        return t.second(Math.floor(rand() * 60));
      });
    }

    let prevAssigned: Dayjs | null = null;
    for (const slot of slots) {
      if (remaining <= 0) break;
      let t = slot.isBefore(from) ? from : slot;
      if (prevAssigned && t.diff(prevAssigned, 'second') < gapG * 60) t = prevAssigned.add(gapG, 'minute');

      let picked: string | null = null;
      for (let guard = 0; guard < 50 && !picked; guard++) {
        const clash = tooCloseGlobal(t);
        if (clash) { t = clash.add(gapG, 'minute'); continue; }
        if (t.isAfter(to)) break;

        const eligible = activeKeys.filter((k) => {
          if (queues.get(k)!.length === 0) return false;
          if ((countByKeyDay.get(dayKey(k, t)) || 0) >= maxPerDay) return false;
          const last = lastByKey.get(k);
          return !last || t.diff(last, 'second') >= gapT * 60;
        });

        if (eligible.length === 0) {
          // Chờ tới lúc sớm nhất có điểm đăng hết thời gian giãn cách
          const nextTimes = activeKeys
            .filter((k) => queues.get(k)!.length > 0 && (countByKeyDay.get(dayKey(k, t)) || 0) < maxPerDay)
            .map((k) => lastByKey.get(k)!.add(gapT, 'minute'));
          if (nextTimes.length === 0) break;
          t = nextTimes.reduce((a, b) => (b.isBefore(a) ? b : a));
          continue;
        }

        // Điểm đăng chờ lâu nhất; hòa thì ưu tiên điểm còn nhiều bài
        eligible.sort((a, b) => {
          const la = lastByKey.get(a)?.valueOf() ?? -Infinity;
          const lb = lastByKey.get(b)?.valueOf() ?? -Infinity;
          if (la !== lb) return la - lb;
          return queues.get(b)!.length - queues.get(a)!.length;
        });
        picked = eligible[0];
      }

      if (!picked || t.isAfter(to)) break;
      // Lùi tới (không lùi lại) để tránh phút tròn — vẫn giữ nguyên các ràng buộc giãn cách
      if (opts.jitter && t.minute() % 5 === 0) t = t.add(1 + Math.floor(rand() * 3), 'minute');
      const id = queues.get(picked)!.shift()!;
      result.push({ id, key: picked, time: t });
      lastByKey.set(picked, t);
      countByKeyDay.set(dayKey(picked, t), (countByKeyDay.get(dayKey(picked, t)) || 0) + 1);
      allTimes.push(t);
      prevAssigned = t;
      remaining--;
    }
  }

  return result.sort((a, b) => a.time.valueOf() - b.time.valueOf());
};
