package com.autopost.saas.service;

import com.autopost.saas.repository.PostQueueRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;

/** One-shot power action, available only inside the local Windows desktop app. */
@Service
@RequiredArgsConstructor
public class QueuePowerService {
    private final PostQueueRepository queue;
    private String action = "OFF";
    private Long executeAt;
    private String error = "";

    public boolean supported() {
        return System.getProperty("os.name", "").startsWith("Windows")
                && System.getenv("DESKTOP_SESSION_TOKEN") != null
                && !System.getenv("DESKTOP_SESSION_TOKEN").isBlank();
    }

    public synchronized Map<String, Object> status() {
        return Map.of("supported", supported(), "action", action,
                "executeAt", executeAt == null ? 0L : executeAt, "error", error);
    }

    public synchronized Map<String, Object> configure(String next) {
        if (!List.of("OFF", "SHUTDOWN", "SLEEP").contains(next))
            throw new IllegalArgumentException("Tùy chọn không hợp lệ.");
        if (!next.equals("OFF")) {
            if (!supported()) throw new IllegalArgumentException("Chỉ hỗ trợ ứng dụng Windows trên máy này.");
            if (!queue.existsByStatusIn(List.of("PENDING", "PROCESSING")))
                throw new IllegalArgumentException("Hãy thêm bài vào lịch trước khi bật tùy chọn này.");
        }
        action = next;
        executeAt = null;
        error = "";
        return status();
    }

    @Scheduled(fixedDelay = 5000)
    public synchronized void tick() {
        if (action.equals("OFF") || !supported()) return;
        try {
            // Includes future schedules: never sleep between two scheduled posts.
            if (queue.existsByStatusIn(List.of("PENDING", "PROCESSING"))) {
                executeAt = null;
                return;
            }
            long now = System.currentTimeMillis();
            if (executeAt == null) { executeAt = now + 60_000; return; }
            if (now < executeAt) return;
            String selected = action;
            action = "OFF";
            executeAt = null;
            Process process;
            if (selected.equals("SHUTDOWN")) {
                process = new ProcessBuilder("shutdown.exe", "/s", "/t", "0")
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                        .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            } else {
                String script = "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class QueuePower { [DllImport(\"powrprof.dll\", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake); }'; if (-not [QueuePower]::SetSuspendState($false,$false,$false)) { exit 1 }";
                process = new ProcessBuilder("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                        .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            }
            process.onExit().thenAccept(p -> {
                if (p.exitValue() != 0) synchronized (this) {
                    error = "Windows không thực hiện được thao tác nguồn (mã " + p.exitValue() + ").";
                }
            });
        } catch (Exception ex) {
            // Fail closed; never execute after a failed queue read without another countdown.
            executeAt = null;
            error = "Không thể kiểm tra hàng đợi hoặc thực hiện thao tác nguồn.";
            action = "OFF";
        }
    }
}
