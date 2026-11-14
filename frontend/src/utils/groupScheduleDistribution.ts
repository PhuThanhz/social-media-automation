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
 * - Trải đều các bài của cùng 1 Group từ giờ bắt đầu đến giờ kết thúc (khoảng cách đều đặn, không dồn cục).
 * - Xen kẽ (interleaved) vòng tròn: Vòng 1 xếp bài đầu tiên của Group 1, Group 2, Group 3... sau đó mới đến vòng 2.
 * - Bảo vệ an toàn: 2 bài của cùng 1 Nick/Page không bao giờ bị xếp sát nhau hơn 2 phút.
 */
export function distributeGroupTasks(
  tasks: GroupScheduleTask[],
  options: GroupScheduleOptions
): ScheduledGroupTask[] {
  if (tasks.length === 0) return [];

  const baseTime = options.baseTime || dayjs();

  if (options.timingMode === 'STAGGER') {
    return tasks.map((task, idx) => {
      const scheduledAt = baseTime.add(idx * options.staggerIntervalMinutes, 'minute');
      return {
        ...task,
        scheduledAt,
        scheduledIso: scheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
      };
    });
  }

  // Chế độ SPREAD_DAY: Rải đều các nhóm cả ngày
  const byGroup = new Map<string, GroupScheduleTask[]>();
  for (const t of tasks) {
    const gKey = t.targetGroupId || '__DEFAULT__';
    if (!byGroup.has(gKey)) byGroup.set(gKey, []);
    byGroup.get(gKey)!.push(t);
  }

  const groupKeys = Array.from(byGroup.keys());
  const numGroups = groupKeys.length;
  const maxPostsPerGroup = Math.max(...groupKeys.map((k) => byGroup.get(k)!.length));

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

  // Khoảng cách giữa 2 bài liên tiếp của CÙNG 1 NHÓM
  const groupStepMinutes = maxPostsPerGroup > 1
    ? Math.max(15, Math.floor(totalMinutes / maxPostsPerGroup))
    : Math.max(15, totalMinutes);

  // Khoảng cách so le giữa các nhóm khác nhau trong cùng 1 vòng
  const interGroupGapMinutes = Math.min(
    15,
    Math.max(2, Math.floor(groupStepMinutes / Math.max(1, numGroups)))
  );

  const lastNickScheduledTime = new Map<string, Dayjs>();
  const scheduledTasks: ScheduledGroupTask[] = [];

  for (let r = 0; r < maxPostsPerGroup; r++) {
    const roundStart = start.add(r * groupStepMinutes, 'minute');
    for (let g = 0; g < groupKeys.length; g++) {
      const gKey = groupKeys[g];
      const groupPosts = byGroup.get(gKey)!;
      if (r < groupPosts.length) {
        const task = groupPosts[r];
        let slot = roundStart.add(g * interGroupGapMinutes, 'minute');

        // Chống đụng độ trùng giờ cho cùng 1 Nick/Page (tối thiểu 2 phút nghỉ)
        const nickKey = task.targetFanpageId || '__DEFAULT_NICK__';
        const lastNickTime = lastNickScheduledTime.get(nickKey);
        if (lastNickTime && !slot.isAfter(lastNickTime.add(2, 'minute'))) {
          slot = lastNickTime.add(2, 'minute');
        }

        lastNickScheduledTime.set(nickKey, slot);
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
