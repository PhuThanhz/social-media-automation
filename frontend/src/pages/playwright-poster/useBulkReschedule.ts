import type React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import api from '../../config/axios';
import { POSTING_WINDOW_QUERY_KEY } from '../../components/common/PostingWindowPanel';
import { normalizeTargetKey, computeViralSchedule, isGoldenHour } from '../../utils/viralSchedule';
import type { RescheduleMode } from './BulkRescheduleModal';
import type { PostQueue, SocialAccount } from './types';

interface BulkRescheduleParams {
  desiredMinInterval: number;
  posts: PostQueue[];
  selectedRowKeys: React.Key[];
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  setIsBulkProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  queryClient: QueryClient;
}

// Phân bổ lại giờ hàng đợi: thuật toán chia khung giờ / giờ vàng / giãn cố định, xem trước và áp dụng — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useBulkReschedule({ desiredMinInterval, posts, selectedRowKeys, postingIdentities, accountTargetValue, setIsBulkProcessing, setSelectedRowKeys, queryClient }: BulkRescheduleParams) {
  const { message } = App.useApp();
  const [bulkRescheduleModalVisible, setBulkRescheduleModalVisible] = useState(false);
  const [bulkRescheduleTargetScope, setBulkRescheduleTargetScope] = useState<'ALL' | 'SELECTED'>('ALL');
  const [bulkRescheduleMode, setBulkRescheduleMode] = useState<RescheduleMode>('WINDOW');
  const [bulkRescheduleDate, setBulkRescheduleDate] = useState<Dayjs>(dayjs());
  const [bulkRescheduleStartTime, setBulkRescheduleStartTime] = useState<Dayjs>(dayjs().hour(9).minute(0).second(0));
  const [bulkRescheduleEndTime, setBulkRescheduleEndTime] = useState<Dayjs>(dayjs().hour(18).minute(0).second(0));
  const [bulkRescheduleInterval, setBulkRescheduleInterval] = useState<number>(60);
  const [bulkRescheduleInterleave, setBulkRescheduleInterleave] = useState<boolean>(true);
  const [bulkRescheduleMaxPerDay, setBulkRescheduleMaxPerDay] = useState<number>(-1);
  const [bulkRescheduleSameDayGap, setBulkRescheduleSameDayGap] = useState<number>(30);
  const [bulkRescheduleDistributeNicks, setBulkRescheduleDistributeNicks] = useState<boolean>(false);
  const [bulkRescheduleSelectedNicks, setBulkRescheduleSelectedNicks] = useState<string[]>([]);
  // Chế độ "Giờ vàng Viral"
  const [viralMaxPerTargetPerDay, setViralMaxPerTargetPerDay] = useState<number>(10);
  const [viralMinGapPerTarget, setViralMinGapPerTarget] = useState<number>(45);
  const [viralMinGapGlobal, setViralMinGapGlobal] = useState<number>(8);
  const [viralJitter, setViralJitter] = useState<boolean>(true);
  const [viralSeed, setViralSeed] = useState<number>(() => Date.now());

  // Thuật toán chia đều khung giờ trong ngày & rải nhiều ngày (Smart Window, Past-time Protection & Auto Overflow)
  const computeTimeWindowSchedule = useCallback((
    targetDate: any,
    start: any,
    end: any,
    count: number,
    maxPerDay?: number, // -1 = Tự động chống dồn (Khuyên dùng), 0 = 1 ngày (có bảo vệ tối thiểu), >0 = max bài/ngày
    minIntervalMinutes?: number, // Khoảng cách tối thiểu giữa 2 bài
    sameDayMinGap: number = 10 // Chế độ "Đăng trong ngày": khoảng cách tối thiểu, tự kéo giờ kết thúc tới 23:30 nếu cần
  ): Dayjs[] => {
    if (count <= 0) return [];

    const now = dayjs();
    const baseDate = dayjs.isDayjs(targetDate) && targetDate.isValid() ? targetDate : dayjs(targetDate || new Date());
    const startObj = dayjs.isDayjs(start) && start.isValid() ? start : dayjs(start || new Date());
    const endObj = dayjs.isDayjs(end) && end.isValid() ? end : dayjs(end || new Date());

    const startH = startObj.isValid() ? startObj.hour() : 9;
    const startM = startObj.isValid() ? startObj.minute() : 0;
    const endH = endObj.isValid() ? endObj.hour() : 18;
    const endM = endObj.isValid() ? endObj.minute() : 0;

    const result: Dayjs[] = [];
    let remainingCount = count;
    let dayOffset = 0;

    // Khoảng cách an toàn tối thiểu giữa 2 bài (phút) — mặc định 30 phút, tối thiểu 10 phút
    const effectiveMinInterval = Math.max(10, minIntervalMinutes || desiredMinInterval || 30);

    while (remainingCount > 0 && dayOffset < 365) {
      const currentDay = baseDate.clone().add(dayOffset, 'day');
      let startDt = currentDay.clone().hour(startH).minute(startM).second(0);
      let endDt = currentDay.clone().hour(endH).minute(endM).second(0);

      if (endDt.isBefore(startDt)) {
        endDt = endDt.add(1, 'day');
      }

      // Xử lý bảo vệ thời gian quá khứ nếu là ngày HÔM NAY
      if (currentDay.isSame(now, 'day')) {
        // Nếu giờ bắt đầu đã lùi vào quá khứ so với hiện tại, tự động đẩy lên giờ hiện tại (+ 2-5 phút)
        if (startDt.isBefore(now)) {
          const next5 = Math.ceil((now.minute() + 2) / 5) * 5;
          startDt = now.clone().minute(next5).second(0);
          if (startDt.minute() >= 60) {
            startDt = startDt.add(1, 'hour').minute(0);
          }
        }
        // Nếu giờ bắt đầu đã quá sát hoặc vượt giờ kết thúc (< 15 phút còn lại), chuyển hẳn sang ngày mai để không dồn bài
        // (Chế độ "Đăng trong ngày" có thể kéo giờ kết thúc tới 23:30 nên xét theo mốc đó)
        const latestToday = currentDay.clone().hour(23).minute(30).second(0);
        const usableEnd = maxPerDay === 0 && endDt.isBefore(latestToday) ? latestToday : endDt;
        if (usableEnd.diff(startDt, 'minute') < 15) {
          dayOffset++;
          continue;
        }
      }

      const effectiveMaxPerDay = maxPerDay !== undefined ? maxPerDay : -1;

      // Chế độ "Đăng trong ngày": nếu khung giờ quá chật thì tự kéo giờ kết thúc (tối đa 23:30)
      // để các bài có tối đa không gian hoạt động trong ngày
      const dayGap = Math.max(1, sameDayMinGap);
      if (effectiveMaxPerDay === 0 && remainingCount > 1) {
        const latest = currentDay.clone().hour(23).minute(30).second(0);
        if (endDt.isBefore(latest)) {
          const needMinutes = (remainingCount - 1) * dayGap;
          if (endDt.diff(startDt, 'minute') < needMinutes) {
            const wanted = startDt.add(needMinutes, 'minute');
            endDt = wanted.isBefore(latest) ? wanted : latest;
          }
        }
      }

      const availableMinutes = Math.max(0, endDt.diff(startDt, 'minute'));

      // Số bài tối đa có thể xếp vừa vặn trong ngày này với khoảng cách tối thiểu an toàn
      const maxFit = Math.max(1, Math.floor(availableMinutes / effectiveMinInterval) + 1);

      // Tính số bài sẽ xếp vào ngày này
      let batchSize = remainingCount;

      if (effectiveMaxPerDay === -1) {
        // Chế độ Tự Động Rải Giãn Cách Chống Dồn:
        // Phân bổ tối đa số bài vừa vặn cho ngày này với khoảng cách tối thiểu effectiveMinInterval
        batchSize = Math.min(remainingCount, maxFit);
      } else if (effectiveMaxPerDay > 0) {
        // Giới hạn thủ công số bài / ngày nhưng vẫn bảo vệ không dồn ép vượt quá maxFit
        batchSize = Math.min(remainingCount, Math.min(effectiveMaxPerDay, maxFit));
      } else {
        // effectiveMaxPerDay === 0: ĐĂNG TRONG NGÀY.
        // Khi người dùng chọn "Đăng trong ngày" (đặc biệt khi đăng nhiều nhóm cùng lúc),
        // xếp TOÀN BỘ các bài vào ngày hôm nay để đăng hết trong ngày.
        // Chỉ khi giãn cách vật lý < 1 phút mới tràn.
        const maxCanFitToday = Math.max(1, Math.floor(availableMinutes / 1) + 1);
        batchSize = Math.min(remainingCount, maxCanFitToday);
      }

      if (batchSize === 1) {
        result.push(startDt);
      } else if (batchSize > 1) {
        const stepMinutes = availableMinutes / (batchSize - 1);
        for (let i = 0; i < batchSize; i++) {
          result.push(startDt.add(Math.round(i * stepMinutes), 'minute'));
        }
      }

      remainingCount -= batchSize;
      dayOffset++;
    }

    return result;
  }, [desiredMinInterval]);

  // Thuật toán đan xen (Round-Robin) các bài viết theo Điểm đăng (Group / Fanpage) để chống dính chùm bài
  const interleavePostsByTarget = useCallback((postList: PostQueue[]): PostQueue[] => {
    if (postList.length <= 1) return postList;

    const buckets = new Map<string, PostQueue[]>();
    postList.forEach((p) => {
      const key = p.targetGroupNames || p.targetFanpageId || 'PAGE_FEED';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(p);
    });

    if (buckets.size <= 1) return postList;

    const bucketArrays = Array.from(buckets.values());
    const maxLen = Math.max(...bucketArrays.map((arr) => arr.length));

    const result: PostQueue[] = [];
    for (let i = 0; i < maxLen; i++) {
      for (const arr of bucketArrays) {
        if (i < arr.length) {
          result.push(arr[i]);
        }
      }
    }

    return result;
  }, []);

  // Danh sách bài viết được nhắm đến để phân bổ lại giờ
  const rescheduleTargetPosts = useMemo(() => {
    const allPending = (posts || []).filter((p) => p.status === 'PENDING');
    let list: PostQueue[] = [];
    if (bulkRescheduleTargetScope === 'SELECTED') {
      const selectedSet = new Set(selectedRowKeys.map((k) => String(k)));
      list = allPending.filter((p) => selectedSet.has(String(p.id)));
    } else {
      list = allPending;
    }
    const sorted = [...list].sort((a, b) => {
      const tA = a.scheduledAt ? dayjs(a.scheduledAt).valueOf() : 0;
      const tB = b.scheduledAt ? dayjs(b.scheduledAt).valueOf() : 0;
      return tA - tB;
    });

    // Chế độ Viral tự đan xen theo điểm đăng nên không cần round-robin ở đây
    return bulkRescheduleInterleave && bulkRescheduleMode !== 'VIRAL' ? interleavePostsByTarget(sorted) : sorted;
  }, [posts, bulkRescheduleTargetScope, selectedRowKeys, bulkRescheduleInterleave, bulkRescheduleMode, interleavePostsByTarget]);

  // Seed mới mỗi lần mở modal: preview ổn định khi chỉnh tham số, khớp với lúc bấm Áp dụng
  useEffect(() => {
    if (bulkRescheduleModalVisible) setViralSeed(Date.now());
  }, [bulkRescheduleModalVisible]);

  // Preview danh sách phân bổ trước khi áp dụng
  const reschedulePreviewList = useMemo(() => {
    if (rescheduleTargetPosts.length === 0) return [];
    if (bulkRescheduleMode === 'VIRAL') {
      const targetIds = new Set(rescheduleTargetPosts.map((p) => p.id));
      const occupied = (posts || [])
        .filter((p) => (p.status === 'PENDING' || p.status === 'PROCESSING') && !targetIds.has(p.id) && p.scheduledAt)
        .map((p) => ({ key: normalizeTargetKey(p.targetGroupNames, p.targetFanpageId), time: dayjs(p.scheduledAt) }));
      const byId = new Map(rescheduleTargetPosts.map((p) => [p.id, p]));
      const schedule = computeViralSchedule(
        rescheduleTargetPosts.map((p) => ({ id: p.id, key: normalizeTargetKey(p.targetGroupNames, p.targetFanpageId) })),
        occupied,
        {
          startDate: dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs(),
          startTime: bulkRescheduleStartTime,
          endTime: bulkRescheduleEndTime,
          maxPerTargetPerDay: viralMaxPerTargetPerDay,
          minGapPerTarget: viralMinGapPerTarget,
          minGapGlobal: viralMinGapGlobal,
          jitter: viralJitter,
          seed: viralSeed,
        }
      );
      return schedule.map((r, idx) => {
        let assignedNickValue: string | undefined = undefined;
        let assignedNickName: string | undefined = undefined;
        if (bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0) {
          assignedNickValue = bulkRescheduleSelectedNicks[idx % bulkRescheduleSelectedNicks.length];
          const matched = postingIdentities.find((a) => accountTargetValue(a) === assignedNickValue);
          assignedNickName = matched?.pageName || assignedNickValue;
        }
        return { post: byId.get(r.id)!, newTime: r.time, assignedNickValue, assignedNickName };
      });
    }
    let scheduledTimes: Dayjs[] = [];
    if (bulkRescheduleMode === 'WINDOW') {
      scheduledTimes = computeTimeWindowSchedule(
        bulkRescheduleDate,
        bulkRescheduleStartTime,
        bulkRescheduleEndTime,
        rescheduleTargetPosts.length,
        bulkRescheduleMaxPerDay,
        desiredMinInterval,
        bulkRescheduleSameDayGap
      );
    } else {
      const baseDate = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs(bulkRescheduleDate || new Date());
      const startTime = dayjs.isDayjs(bulkRescheduleStartTime) ? bulkRescheduleStartTime : dayjs(bulkRescheduleStartTime || new Date());
      const base = baseDate.clone().hour(startTime.hour()).minute(startTime.minute()).second(0);
      scheduledTimes = rescheduleTargetPosts.map((_, i) => base.add(i * (bulkRescheduleInterval || 15), 'minute'));
    }
    const defaultFallback = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs();
    return rescheduleTargetPosts.map((p, idx) => {
      let assignedNickValue: string | undefined = undefined;
      let assignedNickName: string | undefined = undefined;
      if (bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0) {
        assignedNickValue = bulkRescheduleSelectedNicks[idx % bulkRescheduleSelectedNicks.length];
        const matched = postingIdentities.find((a) => accountTargetValue(a) === assignedNickValue);
        assignedNickName = matched?.pageName || assignedNickValue;
      }
      return {
        post: p,
        newTime: scheduledTimes[idx] || defaultFallback.add(idx * 15, 'minute'),
        assignedNickValue,
        assignedNickName,
      };
    });
  }, [rescheduleTargetPosts, bulkRescheduleMode, bulkRescheduleDate, bulkRescheduleStartTime, bulkRescheduleEndTime, bulkRescheduleInterval, bulkRescheduleMaxPerDay, bulkRescheduleSameDayGap, desiredMinInterval, computeTimeWindowSchedule, posts, viralMaxPerTargetPerDay, viralMinGapPerTarget, viralMinGapGlobal, viralJitter, viralSeed, bulkRescheduleDistributeNicks, bulkRescheduleSelectedNicks, postingIdentities]);

  // Thống kê nhanh cho preview: số ngày, số bài giờ vàng, khoảng cách thực tế
  const reschedulePreviewStats = useMemo(() => {
    const list = reschedulePreviewList;
    const days = new Set(list.map((i) => i.newTime.format('YYYY-MM-DD')));
    const sorted = [...list].sort((a, b) => a.newTime.valueOf() - b.newTime.valueOf());
    const sameDayGaps: number[] = [];
    const lastByKey = new Map<string, Dayjs>();
    let minTargetGap = Infinity;
    sorted.forEach((item, i) => {
      if (i > 0 && item.newTime.isSame(sorted[i - 1].newTime, 'day')) {
        sameDayGaps.push(item.newTime.diff(sorted[i - 1].newTime, 'minute'));
      }
      const key = normalizeTargetKey(item.post.targetGroupNames, item.post.targetFanpageId);
      const last = lastByKey.get(key);
      if (last) minTargetGap = Math.min(minTargetGap, item.newTime.diff(last, 'minute'));
      lastByKey.set(key, item.newTime);
    });
    const hours = new Array(24).fill(0);
    list.forEach((i) => { hours[i.newTime.hour()]++; });
    const startDay = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs();
    const onStartDay = sorted.filter((i) => i.newTime.isSame(startDay, 'day'));
    return {
      spilled: list.length - onStartDay.length,
      lastOnStartDay: onStartDay.length ? onStartDay[onStartDay.length - 1].newTime : null,
      days: days.size,
      golden: list.filter((i) => isGoldenHour(i.newTime)).length,
      avgGap: sameDayGaps.length ? Math.round(sameDayGaps.reduce((a, b) => a + b, 0) / sameDayGaps.length) : 0,
      minTargetGap: Number.isFinite(minTargetGap) ? minTargetGap : null,
      hours,
      targets: lastByKey.size,
    };
  }, [reschedulePreviewList, bulkRescheduleDate]);

  // Xử lý Phân bổ lại giờ hàng loạt cho hàng đợi bài viết (Atomic Batch API)
  const handleApplyBulkReschedule = async () => {
    if (rescheduleTargetPosts.length === 0) {
      message.warning('Không có bài viết nào ở trạng thái "Chờ đăng" (Pending) để chia lại giờ!');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const updates = reschedulePreviewList.map((item) => ({
        id: Number(item.post.id),
        scheduledAt: (item.newTime || dayjs()).format('YYYY-MM-DDTHH:mm:ss'),
        ...(item.assignedNickValue ? { targetFanpageId: item.assignedNickValue } : {}),
      }));

      const res = await api.post('/queue/reschedule-batch', { updates });
      if (res.data?.success) {
        message.success(`🗓️ Đã phân bổ lại lịch đăng cho ${res.data.updatedCount || updates.length} bài viết thành công!${bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0 ? ` (Đã chia đều qua ${bulkRescheduleSelectedNicks.length} Nick)` : ''}`);
        setBulkRescheduleModalVisible(false);
        setSelectedRowKeys([]);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
        queryClient.invalidateQueries({ queryKey: ['postQueue'] });
        queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      } else {
        message.error(res.data?.message || 'Có lỗi khi cập nhật lịch đăng');
      }
    } catch (e: any) {
      console.error(e);
      message.error('Lỗi khi chia lại giờ: ' + (e?.response?.data?.message || e.message || 'Lỗi mạng'));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  return {
    computeTimeWindowSchedule,
    bulkRescheduleModalVisible,
    setBulkRescheduleModalVisible,
    bulkRescheduleTargetScope,
    setBulkRescheduleTargetScope,
    bulkRescheduleMode,
    setBulkRescheduleMode,
    setBulkRescheduleDate,
    bulkRescheduleDate,
    setBulkRescheduleStartTime,
    bulkRescheduleStartTime,
    setBulkRescheduleEndTime,
    bulkRescheduleEndTime,
    bulkRescheduleInterval,
    setBulkRescheduleInterval,
    bulkRescheduleInterleave,
    setBulkRescheduleInterleave,
    bulkRescheduleMaxPerDay,
    setBulkRescheduleMaxPerDay,
    bulkRescheduleSameDayGap,
    setBulkRescheduleSameDayGap,
    setBulkRescheduleDistributeNicks,
    bulkRescheduleDistributeNicks,
    setBulkRescheduleSelectedNicks,
    bulkRescheduleSelectedNicks,
    viralMaxPerTargetPerDay,
    setViralMaxPerTargetPerDay,
    viralMinGapPerTarget,
    setViralMinGapPerTarget,
    viralMinGapGlobal,
    setViralMinGapGlobal,
    viralJitter,
    setViralJitter,
    setViralSeed,
    rescheduleTargetPosts,
    reschedulePreviewList,
    reschedulePreviewStats,
    handleApplyBulkReschedule,
  };
}
