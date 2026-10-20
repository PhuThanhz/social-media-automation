package com.autopost.saas.controller;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/system-logs")
public class SystemLogController {

    private static final int DEFAULT_LINES = 500;
    private static final int MAX_LINES = 5_000;
    private final Map<String, LogFile> logFiles;

    public SystemLogController() {
        Path projectRoot = resolveProjectRoot();
        Map<String, LogFile> sources = new LinkedHashMap<>();
        sources.put("worker", new LogFile("worker", "Worker", "Playwright & tiến trình đăng bài", projectRoot.resolve("worker/worker.log")));
        sources.put("backend", new LogFile("backend", "Backend", "Spring Boot API", projectRoot.resolve("backend/backend_stable.log")));
        sources.put("frontend", new LogFile("frontend", "Frontend", "Vite development server", projectRoot.resolve("frontend/vite.log")));
        this.logFiles = Collections.unmodifiableMap(sources);
    }

    @GetMapping("/sources")
    public List<LogSourceResponse> sources() {
        return logFiles.values().stream().map(this::toSourceResponse).toList();
    }

    @GetMapping
    public LogResponse read(
            @RequestParam(defaultValue = "worker") String source,
            @RequestParam(defaultValue = "500") int lines
    ) throws IOException {
        LogFile logFile = requireSource(source);
        int safeLineCount = Math.max(1, Math.min(lines > 0 ? lines : DEFAULT_LINES, MAX_LINES));
        if (!Files.isRegularFile(logFile.path())) {
            return new LogResponse(logFile.id(), List.of(), 0, 0, null);
        }

        List<String> tail = tail(logFile.path(), safeLineCount);
        return new LogResponse(
                logFile.id(),
                tail,
                tail.size(),
                Files.size(logFile.path()),
                Files.getLastModifiedTime(logFile.path()).toInstant()
        );
    }

    @GetMapping("/download")
    public ResponseEntity<Resource> download(@RequestParam(defaultValue = "worker") String source) throws IOException {
        LogFile logFile = requireSource(source);
        if (!Files.isRegularFile(logFile.path())) {
            return ResponseEntity.notFound().build();
        }

        Resource resource = new FileSystemResource(logFile.path());
        String filename = logFile.id() + "-" + Instant.now().toString().replace(':', '-') + ".log";
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(Files.size(logFile.path()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename).build().toString())
                .body(resource);
    }

    private LogFile requireSource(String source) {
        LogFile logFile = logFiles.get(source);
        if (logFile == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nguồn log không hợp lệ: " + source);
        }
        return logFile;
    }

    private LogSourceResponse toSourceResponse(LogFile logFile) {
        boolean exists = Files.isRegularFile(logFile.path());
        try {
            long size = exists ? Files.size(logFile.path()) : 0;
            FileTime modified = exists ? Files.getLastModifiedTime(logFile.path()) : null;
            return new LogSourceResponse(logFile.id(), logFile.name(), logFile.description(), exists, size, modified == null ? null : modified.toInstant());
        } catch (IOException ignored) {
            return new LogSourceResponse(logFile.id(), logFile.name(), logFile.description(), false, 0, null);
        }
    }

    private static List<String> tail(Path file, int lineCount) throws IOException {
        if (Files.size(file) == 0) return List.of();

        List<String> reversedLines = new ArrayList<>(lineCount);
        try (RandomAccessFile reader = new RandomAccessFile(file.toFile(), "r")) {
            long pointer = reader.length() - 1;
            while (pointer >= 0) {
                reader.seek(pointer);
                byte current = reader.readByte();
                if (current != '\n' && current != '\r') break;
                pointer--;
            }

            List<Byte> reversedBytes = new ArrayList<>();
            while (pointer >= 0 && reversedLines.size() < lineCount) {
                reader.seek(pointer--);
                byte current = reader.readByte();
                if (current == '\n') {
                    reversedLines.add(decodeReversed(reversedBytes));
                    reversedBytes.clear();
                } else if (current != '\r') {
                    reversedBytes.add(current);
                }
            }
            if (!reversedBytes.isEmpty() && reversedLines.size() < lineCount) reversedLines.add(decodeReversed(reversedBytes));
        }
        Collections.reverse(reversedLines);
        return reversedLines;
    }

    private static String decodeReversed(List<Byte> bytes) {
        byte[] ordered = new byte[bytes.size()];
        for (int i = 0; i < bytes.size(); i++) ordered[i] = bytes.get(bytes.size() - 1 - i);
        return new String(ordered, StandardCharsets.UTF_8);
    }

    private static Path resolveProjectRoot() {
        Path cwd = Paths.get(System.getProperty("user.dir")).toAbsolutePath().normalize();
        if (cwd.getFileName() != null && "backend".equals(cwd.getFileName().toString())) return cwd.getParent();
        if (Files.isDirectory(cwd.resolve("worker")) && Files.isDirectory(cwd.resolve("frontend"))) return cwd;
        Path nested = cwd.resolve("auto-post-saas");
        if (Files.isDirectory(nested.resolve("worker"))) return nested.normalize();
        return cwd;
    }

    private record LogFile(String id, String name, String description, Path path) {}
    public record LogSourceResponse(String id, String name, String description, boolean exists, long size, Instant lastModified) {}
    public record LogResponse(String source, List<String> lines, int returned, long fileSize, Instant lastModified) {}
}
