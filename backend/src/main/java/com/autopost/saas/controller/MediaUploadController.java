package com.autopost.saas.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/media")
@Slf4j
@CrossOrigin(originPatterns = "*")
public class MediaUploadController {

    private final Path uploadDir = Paths.get("uploads").toAbsolutePath().normalize();

    public MediaUploadController() {
        try {
            Files.createDirectories(uploadDir);
        } catch (IOException e) {
            log.error("Failed to create upload directory", e);
        }
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadMedia(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Tệp tải lên rỗng"));
        }

        try {
            String originalFilename = file.getOriginalFilename();
            String extension = "";
            if (originalFilename != null && originalFilename.contains(".")) {
                extension = originalFilename.substring(originalFilename.lastIndexOf(".")).toLowerCase();
            }

            String filename = UUID.randomUUID().toString() + extension;
            Path targetLocation = uploadDir.resolve(filename);
            Files.copy(file.getInputStream(), targetLocation, StandardCopyOption.REPLACE_EXISTING);

            String fileUrl = ServletUriComponentsBuilder.fromCurrentContextPath()
                    .path("/uploads/")
                    .path(filename)
                    .toUriString();

            boolean isVideo = extension.matches("\\.(mp4|mov|webm|mkv|avi)");

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "url", fileUrl,
                    "filename", filename,
                    "originalName", originalFilename != null ? originalFilename : filename,
                    "mediaType", isVideo ? "video" : "image"
            ));
        } catch (IOException e) {
            log.error("Upload error", e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Không thể lưu tệp: " + e.getMessage()));
        }
    }
}
