package com.autopost.saas.controller;

import com.autopost.saas.entity.ViralInboxItem;
import com.autopost.saas.entity.ViralSource;
import com.autopost.saas.repository.ViralInboxItemRepository;
import com.autopost.saas.repository.ViralSourceRepository;
import com.autopost.saas.service.RedditService;
import com.autopost.saas.service.ViralSourceScanService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/** Kho Nguồn Mục Tiêu + hộp bài mới do bộ quét tự động tìm được (trang Săn bài Viral). */
@RestController
@RequestMapping("/api/viral-sources")
@CrossOrigin(originPatterns = "*")
@RequiredArgsConstructor
@Slf4j
public class ViralSourceController {

    private final ViralSourceRepository sourceRepository;
    private final ViralInboxItemRepository inboxRepository;
    private final ViralSourceScanService scanService;
    private final RedditService redditService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @GetMapping
    public List<ViralSource> list() {
        return sourceRepository.findAllByOrderByCreatedAtDesc();
    }

    /** Thêm hoặc cập nhật nguồn (khớp theo url). */
    @PostMapping
    public ResponseEntity<?> upsert(@RequestBody Map<String, Object> body) {
        String url = str(body.get("url"));
        if (url == null) return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu link nguồn"));
        if ("REDDIT".equals(str(body.get("type"))) || RedditService.isRedditSource(url)) {
            url = RedditService.normalizeSourceUrl(url);
            if (url == null) return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Nguồn Reddit không hợp lệ (VD: r/cats, hoặc từ khóa tìm kiếm). Link 1 bài thì dùng ô dán link bài."));
            body = new HashMap<>(body);
            body.put("type", "REDDIT");
        }
        return ResponseEntity.ok(upsertOne(body, url));
    }

    /** Quét ngay 1 nguồn vào hộp duyệt (dùng cho nguồn Reddit — không qua worker Playwright). */
    @PostMapping("/{id}/scan")
    public ResponseEntity<?> scanOne(@PathVariable Long id) {
        Optional<ViralSource> source = sourceRepository.findById(id);
        if (source.isEmpty()) return ResponseEntity.notFound().build();
        int added = scanService.scanSourceNow(source.get());
        if (added < 0) {
            return ResponseEntity.status(409).body(Map.of("success", false, "error", "Đang có lượt quét khác chạy, thử lại sau ít phút."));
        }
        ViralSource fresh = sourceRepository.findById(id).orElse(source.get());
        if ("ERROR".equals(fresh.getLastScanStatus())) {
            return ResponseEntity.ok(Map.of("success", false, "error", String.valueOf(fresh.getLastScanError()), "source", fresh));
        }
        return ResponseEntity.ok(Map.of("success", true, "added", added, "source", fresh, "newCount", inboxRepository.countByStatus("NEW")));
    }

    /** Dán link 1 bài Reddit → lấy bài đó đưa thẳng vào hộp chờ duyệt (không lưu thành nguồn). */
    @PostMapping("/reddit-post")
    public ResponseEntity<?> addRedditPost(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> item = redditService.fetchSinglePost(str(body.get("url")));
            String url = item.get("url").toString();
            ViralInboxItem existing = inboxRepository.findByPostUrl(url).orElse(null);
            if (existing != null) {
                existing.setStatus("NEW");
                inboxRepository.save(existing);
            } else {
                Map<String, Object> payload = new HashMap<>(item);
                payload.put("sourceGroup", item.get("subreddit"));
                inboxRepository.save(ViralInboxItem.builder()
                        .sourceName(String.valueOf(item.get("subreddit")))
                        .postUrl(url)
                        .payload(objectMapper.writeValueAsString(payload))
                        .viralScore(item.get("viralScore") instanceof Number n ? n.intValue() : 0)
                        .status("NEW")
                        .build());
            }
            return ResponseEntity.ok(Map.of("success", true, "newCount", inboxRepository.countByStatus("NEW")));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        }
    }

    // ── Kết nối Reddit (cookie hoặc app OAuth của người dùng) ──
    @GetMapping("/reddit-config")
    public Map<String, Object> redditConfig() {
        return redditService.getConfig();
    }

    @PutMapping("/reddit-config")
    public Map<String, Object> saveRedditConfig(@RequestBody Map<String, Object> body) {
        redditService.saveConfig(
                body.get("clientId") != null ? body.get("clientId").toString() : null,
                body.get("clientSecret") != null ? body.get("clientSecret").toString() : null,
                body.get("username") != null ? body.get("username").toString() : null);
        if (body.get("cookie") != null && !body.get("cookie").toString().isBlank()) redditService.saveCookie(body.get("cookie").toString());
        if (Boolean.TRUE.equals(body.get("clearCookie"))) redditService.saveCookie("");
        if (body.get("includeVideo") != null) redditService.setIncludeVideo(Boolean.parseBoolean(body.get("includeVideo").toString()));
        return redditService.getConfig();
    }

    @PostMapping("/reddit-config/test")
    public Map<String, Object> testReddit(@RequestBody(required = false) Map<String, Object> body) {
        return redditService.testConnection(body != null ? str(body.get("subreddit")) : null);
    }

    /** Chuyển danh sách nguồn cũ đang lưu trong trình duyệt (localStorage) lên CSDL — bỏ qua link đã có. */
    @PostMapping("/import")
    public ResponseEntity<?> importAll(@RequestBody List<Map<String, Object>> list) {
        int added = 0;
        for (Map<String, Object> body : list) {
            String url = str(body.get("url"));
            if (url == null || sourceRepository.findByUrl(url).isPresent()) continue;
            upsertOne(body, url);
            added++;
        }
        return ResponseEntity.ok(Map.of("success", true, "added", added, "sources", list()));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<?> patch(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return sourceRepository.findById(id).map(s -> {
            if (body.get("autoScan") != null) s.setAutoScan(Boolean.parseBoolean(body.get("autoScan").toString()));
            if (str(body.get("name")) != null) s.setName(str(body.get("name")));
            return ResponseEntity.ok((Object) sourceRepository.save(s));
        }).orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        sourceRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("success", true));
    }

    // ── Quét tự động ──
    @GetMapping("/auto-scan")
    public Map<String, Object> autoScanStatus() {
        return scanService.getStatus();
    }

    @PutMapping("/auto-scan")
    public Map<String, Object> updateAutoScan(@RequestBody Map<String, Object> body) {
        Boolean enabled = body.get("enabled") != null ? Boolean.parseBoolean(body.get("enabled").toString()) : null;
        Integer hours = null;
        try {
            if (body.get("intervalHours") != null) hours = Integer.parseInt(body.get("intervalHours").toString());
        } catch (NumberFormatException ignored) {}
        scanService.updateSettings(enabled, hours);
        return scanService.getStatus();
    }

    @PostMapping("/scan-now")
    public ResponseEntity<?> scanNow() {
        boolean started = scanService.startScanAll("bấm tay");
        Map<String, Object> status = new LinkedHashMap<>(scanService.getStatus());
        status.put("started", started);
        return ResponseEntity.ok(status);
    }

    // ── Hộp bài mới chờ duyệt ──
    @GetMapping("/inbox")
    public List<Map<String, Object>> inbox() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (ViralInboxItem it : inboxRepository.findByStatusOrderByFoundAtDesc("NEW")) {
            Map<String, Object> m;
            try {
                m = objectMapper.readValue(it.getPayload() == null ? "{}" : it.getPayload(), new TypeReference<Map<String, Object>>() {});
            } catch (Exception e) {
                m = new HashMap<>();
                m.put("url", it.getPostUrl());
            }
            m.put("inboxId", it.getId());
            m.put("sourceGroup", it.getSourceName());
            m.put("foundAt", it.getFoundAt() != null ? it.getFoundAt().toString() : null);
            out.add(m);
        }
        return out;
    }

    /** Đánh dấu bài trong hộp: QUEUED (đã đưa vào Hàng đợi / Đăng tự động) hoặc DISMISSED (bỏ qua). */
    @PostMapping("/inbox/mark")
    public ResponseEntity<?> mark(@RequestBody Map<String, Object> body) {
        String status = str(body.get("status"));
        if (!"QUEUED".equals(status) && !"DISMISSED".equals(status)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "status phải là QUEUED hoặc DISMISSED"));
        }
        List<Long> ids = new ArrayList<>();
        if (body.get("ids") instanceof List<?> l) {
            for (Object o : l) {
                try { ids.add(Long.parseLong(o.toString())); } catch (NumberFormatException ignored) {}
            }
        }
        List<ViralInboxItem> items = inboxRepository.findAllById(ids);
        items.forEach(i -> i.setStatus(status));
        inboxRepository.saveAll(items);
        return ResponseEntity.ok(Map.of("success", true, "updated", items.size(), "newCount", inboxRepository.countByStatus("NEW")));
    }

    private ViralSource upsertOne(Map<String, Object> body, String url) {
        ViralSource s = sourceRepository.findByUrl(url).orElseGet(() -> ViralSource.builder().url(url).build());
        String type = str(body.get("type"));
        s.setType(type != null ? type : (url.contains("/groups/") ? "GROUP" : "PAGE"));
        String name = str(body.get("name"));
        String defaultName = "REDDIT".equals(s.getType())
                ? RedditService.defaultSourceName(url)
                : ("GROUP".equals(s.getType()) ? "Group mục tiêu" : "Fanpage mục tiêu");
        s.setName(name != null ? name : defaultName);
        if (body.containsKey("description")) s.setDescription(str(body.get("description")));
        if (body.containsKey("category")) s.setCategory(str(body.get("category")));
        if (s.getAutoScan() == null) s.setAutoScan(true);
        return sourceRepository.save(s);
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = o.toString().trim();
        return s.isEmpty() ? null : s;
    }
}
