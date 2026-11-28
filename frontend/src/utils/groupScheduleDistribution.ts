import dayjs, { Dayjs } from 'dayjs';

export interface GroupScheduleTask {
  itemUrl: string;
  itemCaption: string;
  itemMedia: string;
  finalAffLink: string;
  targetGroupId: string;
  targetFanpageId: string;
  commentDisabled: boolean;
  groupCommentEnabled: boolean;
  includeCredit: boolean;
  colorBackground: boolean | string;
  colorBackgroundPreset?: string;
}

export interface GroupScheduleOptions {
  timingMode: 'SPREAD_DAY' | 'STAGGER';
  staggerIntervalMinutes: number; // e.g. 2
  spreadStart: Dayjs;
  spreadEnd: Dayjs;
  baseTime?: Dayjs;
}

export interface ScheduledGroupTask extends GroupScheduleTask {
  scheduledAt: Dayjs;
  scheduledIso: string;
}

/**
 * Thuật toán phân bổ đều toàn bộ các nhóm (Group-Interleaved Day Distribution):
 * - Gom các bài viết theo từng Group đích.
 * - Trải đều các bài của cùng 1 Group từ giờ bắt đầu đến giờ kết thúc (khoảng cách đều đặn, an toàn chống spam).
 * - Xen kẽ (interleaved) thông minh giữa các nhóm khác nhau.
 * - Bảo vệ an toàn tuyệt đối: 
 *   + Cùng 1 Nhóm: cách nhau tối thiểu 20 phút (trừ khi người dùng chủ động giảm interval).
 *   + Cùng 1 Nick/Page: cách nhau tối thiểu 2 phút để Chromium và Nick nghỉ ngơi.
 */
export function distributeGroupTasks(
  tasks: GroupScheduleTask[],
  options: GroupScheduleOptions
): ScheduledGroupTask[] {
  if (tasks.length === 0) return [];

  const baseTime = options.baseTime || dayjs();
  const staggerMins = Math.max(1, options.staggerIntervalMinutes || 20);

  // Nhóm các bài viết theo Group đích
  const byGroup = new Map<string, GroupScheduleTask[]>();
  for (const t of tasks) {
    const gKey = t.targetGroupId || '__DEFAULT__';
    if (!byGroup.has(gKey)) byGroup.set(gKey, []);
    byGroup.get(gKey)!.push(t);
  }

  const groupKeys = Array.from(byGroup.keys());
  const numGroups = groupKeys.length;

  if (options.timingMode === 'STAGGER') {
    // 1. Chế độ CUỐN CHIẾU (STAGGER):
    if (numGroups === 1) {
      // Đúng 1 nhóm (VD: chỉ đăng vào nhóm "Đảo Mèo"): cứ mỗi bài cách nhau đúng staggerMins (mặc định 20p)
      return tasks.map((task, idx) => {
        const scheduledAt = baseTime.add(idx * staggerMins, 'minute');
        return {
          ...task,
          scheduledAt,
          scheduledIso: scheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
        };
      });
    }

    // Nhiều nhóm: Xoay vòng xen kẽ (Round-Robin Interleaved)
    // - Giữa 2 bài của CÙNG 1 NHÓM: cách nhau tối thiểu staggerMins phút (VD 20p).
    // - Giữa các nhóm khác nhau: so le an toàn 2-3 phút để Nick nghỉ ngơi và không trùng giờ.
    const maxPostsPerGroup = Math.max(...groupKeys.map((k) => byGroup.get(k)!.length));
    const interGroupOffset = Math.min(5, Math.max(1, Math.floor(staggerMins / Math.max(1, groupKeys.length))));
    const lastNickScheduledTime = new Map<string, Dayjs>();
    const lastGroupScheduledTime = new Map<string, Dayjs>();
    const scheduledTasks: ScheduledGroupTask[] = [];

    for (let r = 0; r < maxPostsPerGroup; r++) {
      const roundBase = baseTime.add(r * staggerMins, 'minute');
      for (let g = 0; g < groupKeys.length; g++) {
        const gKey = groupKeys[g];
        const groupPosts = byGroup.get(gKey)!;
        if (r < groupPosts.length) {
          const task = groupPosts[r];
          let slot = roundBase.add(g * interGroupOffset, 'minute');

          // Đảm bảo khoảng cách với bài trước của cùng nhóm (tối thiểu staggerMins)
          const lastGroupTime = lastGroupScheduledTime.get(gKey);
          if (lastGroupTime && !slot.isAfter(lastGroupTime.add(staggerMins - 1, 'minute'))) {
            slot = lastGroupTime.add(staggerMins, 'minute');
          }

          // Đảm bảo cùng 1 Nick/Page có tối thiểu 2 phút nghỉ
          const nickKey = task.targetFanpageId || '__DEFAULT_NICK__';
          const lastNickTime = lastNickScheduledTime.get(nickKey);
          if (lastNickTime && !slot.isAfter(lastNickTime.add(2, 'minute'))) {
            slot = lastNickTime.add(2, 'minute');
          }

          lastNickScheduledTime.set(nickKey, slot);
          lastGroupScheduledTime.set(gKey, slot);
          scheduledTasks.push({
            ...task,
            scheduledAt: slot,
            scheduledIso: slot.format('YYYY-MM-DDTHH:mm:ss'),
          });
        }
      }
    }
    return scheduledTasks;
  }

  // 2. Chế độ SPREAD_DAY: Rải đều các nhóm cả ngày
  // Xác định khoảng thời gian
  let start = options.spreadStart.clone();
  const now = dayjs();
  if (start.isBefore(now)) {
    // Nếu giờ bắt đầu đã trôi qua, bắt đầu từ ngay sau 2 phút
    start = now.add(2, 'minute');
  }

  let end = options.spreadEnd.clone();
  if (!end.isAfter(start)) {
    end = start.add(14, 'hour');
  }

  const totalMinutes = Math.max(30, end.diff(start, 'minute'));

  // Nếu chỉ có 1 nhóm duy nhất: rải đều các bài của nhóm đó suốt ngày
  if (numGroups === 1) {
    const gPosts = byGroup.get(groupKeys[0])!;
    const count = gPosts.length;
    const step = count > 1 ? Math.floor(totalMinutes / count) : 0;
    return gPosts.map((task, idx) => {
      const scheduledAt = start.add(idx * Math.max(staggerMins, step), 'minute');
      return {
        ...task,
        scheduledAt,
        scheduledIso: scheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
      };
    });
  }

  // Nếu nhiều nhóm:
  // Rải đều từng nhóm dọc theo ngày một cách hài hòa
  const lastNickScheduledTime = new Map<string, Dayjs>();
  const lastGroupScheduledTime = new Map<string, Dayjs>();
  const scheduledTasks: ScheduledGroupTask[] = [];

  // Tạo candidate slots theo tỷ lệ tiến độ
  type Candidate = { task: GroupScheduleTask; groupKey: string; desiredTime: Dayjs };
  const candidates: Candidate[] = [];

  groupKeys.forEach((gKey, gIdx) => {
    const gPosts = byGroup.get(gKey)!;
    const count = gPosts.length;
    for (let pIdx = 0; pIdx < count; pIdx++) {
      let frac: number;
      if (count <= 1) {
        // Nhóm chỉ có 1 bài: rải đều dọc theo khung ngày
        frac = (numGroups <= 1) ? 0.0 : ((gIdx + 0.5) / numGroups);
      } else {
        // Nhóm có nhiều bài: chia đều các mốc và so le nhẹ với các nhóm khác
        const groupOffset = (numGroups > 1) ? (gIdx / numGroups) : 0.0;
        const stepFrac = 1.0 / count;
        frac = (pIdx * stepFrac) + (groupOffset * stepFrac * 0.7);
      }
      const offsetMins = Math.floor(Math.min(0.98, Math.max(0.0, frac)) * totalMinutes);
      candidates.push({
        task: gPosts[pIdx],
        groupKey: gKey,
        desiredTime: start.add(offsetMins, 'minute'),
      });
    }
  });

  // Sắp xếp candidates theo giờ mong muốn
  candidates.sort((a, b) => a.desiredTime.valueOf() - b.desiredTime.valueOf());

  for (const c of candidates) {
    let slot = c.desiredTime;
    if (slot.isBefore(start)) slot = start;

    // Cùng 1 nhóm: tối thiểu staggerMins phút (linh hoạt theo cấu hình của người dùng, ví dụ 5 phút/bài)
    const minGroupMins = Math.max(1, staggerMins);
    const lastGroupTime = lastGroupScheduledTime.get(c.groupKey);
    if (lastGroupTime && !slot.isAfter(lastGroupTime.add(minGroupMins - 1, 'minute'))) {
      slot = lastGroupTime.add(minGroupMins, 'minute');
    }

    // Cùng 1 Nick: tối thiểu 2 phút nghỉ
    const nickKey = c.task.targetFanpageId || '__DEFAULT_NICK__';
    const lastNickTime = lastNickScheduledTime.get(nickKey);
    if (lastNickTime && !slot.isAfter(lastNickTime.add(2, 'minute'))) {
      slot = lastNickTime.add(2, 'minute');
    }

    lastGroupScheduledTime.set(c.groupKey, slot);
    lastNickScheduledTime.set(nickKey, slot);
    scheduledTasks.push({
      ...c.task,
      scheduledAt: slot,
      scheduledIso: slot.format('YYYY-MM-DDTHH:mm:ss'),
    });
  }

  return scheduledTasks;
}
