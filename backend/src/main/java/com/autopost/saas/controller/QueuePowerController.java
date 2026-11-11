package com.autopost.saas.controller;

import com.autopost.saas.service.QueuePowerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/queue/power")
@RequiredArgsConstructor
public class QueuePowerController {
    private final QueuePowerService power;

    @GetMapping
    public Map<String, Object> status() { return power.status(); }

    @PostMapping
    public ResponseEntity<?> configure(@RequestBody Map<String, String> body) {
        try { return ResponseEntity.ok(power.configure(body.getOrDefault("action", "OFF"))); }
        catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
        }
    }
}
