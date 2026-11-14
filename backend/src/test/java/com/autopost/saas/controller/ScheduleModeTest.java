package com.autopost.saas.controller;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ScheduleModeTest {

    @Test
    void explicitModeWins() {
        assertEquals("QUEUE", PostQueueController.resolveScheduleMode(Map.of("scheduleMode", "queue", "publishNow", true)));
        assertEquals("NOW", PostQueueController.resolveScheduleMode(Map.of("scheduleMode", "NOW")));
        assertEquals("AT", PostQueueController.resolveScheduleMode(Map.of("scheduleMode", "AT")));
    }

    @Test
    void legacyFlagsStillUnderstood() {
        assertEquals("NOW", PostQueueController.resolveScheduleMode(Map.of("publishNow", true)));
        assertEquals("QUEUE", PostQueueController.resolveScheduleMode(Map.of("appendToQueue", "true")));
        assertEquals("AT", PostQueueController.resolveScheduleMode(Map.of("scheduledAt", "2026-11-07T09:00:00")));
    }
}
