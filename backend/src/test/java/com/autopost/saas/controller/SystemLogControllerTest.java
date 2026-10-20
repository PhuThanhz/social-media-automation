package com.autopost.saas.controller;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SystemLogControllerTest {

    private final SystemLogController controller = new SystemLogController();

    @Test
    void listsOnlyAllowlistedLogSources() {
        var sources = controller.sources();

        assertEquals(3, sources.size());
        assertEquals("worker", sources.get(0).id());
        assertEquals("backend", sources.get(1).id());
        assertEquals("frontend", sources.get(2).id());
        assertTrue(sources.stream().allMatch(source -> !source.id().contains("/")));
    }

    @Test
    void readsUtf8TailWithinRequestedLimit() throws Exception {
        var response = controller.read("worker", 40);

        assertEquals("worker", response.source());
        assertTrue(response.returned() <= 40);
        assertEquals(response.returned(), response.lines().size());
        assertTrue(response.fileSize() >= 0);
        assertFalse(response.lines().stream().anyMatch(line -> line.contains("�")));
    }

    @Test
    void rejectsUnknownSourceInsteadOfAcceptingAPath() {
        assertThrows(ResponseStatusException.class, () -> controller.read("../../application.yml", 100));
    }
}
