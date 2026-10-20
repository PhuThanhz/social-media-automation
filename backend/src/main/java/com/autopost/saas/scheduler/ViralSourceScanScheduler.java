package com.autopost.saas.scheduler;

import com.autopost.saas.service.ViralSourceScanService;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Mỗi 5 phút kiểm tra đã tới hẹn quét Kho Nguồn Săn bài Viral chưa (lượt quét chạy ở luồng riêng). */
@Component
@RequiredArgsConstructor
public class ViralSourceScanScheduler {

    private final ViralSourceScanService scanService;

    @Scheduled(fixedRate = 300_000, initialDelay = 120_000)
    public void tick() {
        scanService.runIfDue();
    }
}
