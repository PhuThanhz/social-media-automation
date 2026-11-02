package com.autopost.saas.service;

import com.autopost.saas.repository.PostQueueRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Dịch vụ dọn dẹp tự động các file video/ảnh tạm sinh ra trong quá trình cào, render video studio,
 * newscard, reddit và tiktok không còn bài viết nào tham chiếu.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StorageCleanupService {

    private final PostQueueRepository postQueueRepository;

    /**
     * Tự động dọn dẹp file tạm vào 03:00 sáng mỗi ngày.
     */
    @Scheduled(cron = "0 0 3 * * ?")
    public void scheduledDailyCleanup() {
        log.info("🧹 [StorageCleanup] Bắt đầu dọn dẹp dung lượng định kỳ...");
        Map<String, Object> res = cleanStorage(false);
        log.info("🧹 [StorageCleanup] Kết quả: Đã giải phóng {} MB ({} file).", res.get("freedMb"), res.get("totalDeletedCount"));
    }

    public Map<String, Object> cleanStorage(boolean dryRun) {
        Map<String, Object> result = new LinkedHashMap<>();
        long totalDeletedBytes = 0;
        int totalDeletedCount = 0;
        List<String> deletedFiles = new ArrayList<>();

        try {
            // 1. Quét các mediaUrls còn đang được tham chiếu (bài PENDING, PROCESSING hoặc trong 7 ngày gần nhất)
            List<String> rawMediaUrls = postQueueRepository.findReferencedMediaUrls(LocalDateTime.now().minusDays(7));
            Set<String> referencedFiles = new HashSet<>();
            for (String urls : rawMediaUrls) {
                if (urls == null || urls.isBlank()) continue;
                for (String u : urls.split(",")) {
                    String clean = u.trim();
                    if (clean.isBlank()) continue;
                    int qIdx = clean.indexOf('?');
                    if (qIdx != -1) clean = clean.substring(0, qIdx);
                    int sIdx = clean.lastIndexOf('/');
                    String base = sIdx != -1 ? clean.substring(sIdx + 1) : clean;
                    if (!base.isBlank()) referencedFiles.add(base);
                }
            }
            log.info("🧹 [StorageCleanup] Tìm thấy {} file đang được bài viết tham chiếu trong DB.", referencedFiles.size());

            // 2. Dọn thư mục uploads/
            Path uploadsDir = Paths.get("uploads").toAbsolutePath().normalize();
            if (Files.isDirectory(uploadsDir)) {
                try (var stream = Files.list(uploadsDir)) {
                    for (Path p : stream.toList()) {
                        if (Files.isDirectory(p)) continue;
                        String fileName = p.getFileName().toString();
                        if (referencedFiles.contains(fileName)) continue;

                        long size = Files.size(p);
                        long ageMs = System.currentTimeMillis() - Files.getLastModifiedTime(p).toMillis();
                        boolean isOldEnough = ageMs > 24L * 60 * 60 * 1000; // > 24h

                        boolean isTemp = fileName.startsWith("vs-src-")
                                || fileName.startsWith("vs-video-")
                                || fileName.startsWith("reddit_")
                                || fileName.startsWith("newscard-video-")
                                || (fileName.startsWith("newscard-") && ageMs > 3L * 24 * 60 * 60 * 1000)
                                || (size > 5L * 1024 * 1024 && isOldEnough); // file lớn > 5MB cũ hơn 24h không dùng

                        if (isTemp && isOldEnough) {
                            totalDeletedBytes += size;
                            totalDeletedCount++;
                            deletedFiles.add("[Uploads] " + fileName + " (" + formatMb(size) + " MB)");
                            if (!dryRun) {
                                Files.deleteIfExists(p);
                            }
                        }
                    }
                }
            }

            // 3. Dọn thư mục worker/downloads/clip_meo/
            Path projectRoot = resolveProjectRoot();
            Path clipMeoDir = projectRoot.resolve("worker/downloads/clip_meo");
            if (Files.isDirectory(clipMeoDir)) {
                try (var stream = Files.list(clipMeoDir)) {
                    for (Path p : stream.toList()) {
                        if (Files.isDirectory(p)) continue;
                        String fileName = p.getFileName().toString();
                        if (referencedFiles.contains(fileName)) continue;

                        long size = Files.size(p);
                        long ageMs = System.currentTimeMillis() - Files.getLastModifiedTime(p).toMillis();
                        if (ageMs > 48L * 60 * 60 * 1000) { // > 48h
                            totalDeletedBytes += size;
                            totalDeletedCount++;
                            deletedFiles.add("[ClipMeo] " + fileName + " (" + formatMb(size) + " MB)");
                            if (!dryRun) {
                                Files.deleteIfExists(p);
                            }
                        }
                    }
                }
            }

            // 4. Dọn thư mục worker/debug_output/ (ảnh debug, screenshot lỗi cũ hơn 48h)
            Path debugOutputDir = projectRoot.resolve("worker/debug_output");
            if (Files.isDirectory(debugOutputDir)) {
                try (var stream = Files.list(debugOutputDir)) {
                    for (Path p : stream.toList()) {
                        if (Files.isDirectory(p)) continue;
                        String fileName = p.getFileName().toString();
                        long size = Files.size(p);
                        long ageMs = System.currentTimeMillis() - Files.getLastModifiedTime(p).toMillis();
                        if (ageMs > 48L * 60 * 60 * 1000) { // > 48h
                            totalDeletedBytes += size;
                            totalDeletedCount++;
                            deletedFiles.add("[DebugOutput] " + fileName + " (" + formatMb(size) + " MB)");
                            if (!dryRun) {
                                Files.deleteIfExists(p);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.error("❌ Lỗi khi dọn dẹp bộ nhớ tạm: {}", e.getMessage(), e);
            result.put("error", e.getMessage());
        }

        result.put("success", true);
        result.put("dryRun", dryRun);
        result.put("totalDeletedBytes", totalDeletedBytes);
        result.put("totalDeletedCount", totalDeletedCount);
        result.put("freedMb", formatMb(totalDeletedBytes));
        result.put("files", deletedFiles);
        return result;
    }

    private static String formatMb(long bytes) {
        return String.format(Locale.US, "%.2f", bytes / (1024.0 * 1024.0));
    }

    private static Path resolveProjectRoot() {
        Path cwd = Paths.get(System.getProperty("user.dir")).toAbsolutePath().normalize();
        if (cwd.getFileName() != null && "backend".equals(cwd.getFileName().toString())) return cwd.getParent();
        if (Files.isDirectory(cwd.resolve("worker")) && Files.isDirectory(cwd.resolve("frontend"))) return cwd;
        Path nested = cwd.resolve("auto-post-saas");
        if (Files.isDirectory(nested.resolve("worker"))) return nested.normalize();
        return cwd;
    }
}
