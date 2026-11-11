package com.autopost.saas.service;

import com.autopost.saas.repository.PostQueueRepository;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class QueuePowerServiceTest {
    @Test
    void startsOffAndDoesNotReadQueue() {
        var queue = mock(PostQueueRepository.class);
        var power = new QueuePowerService(queue);
        power.tick();
        assertEquals("OFF", power.status().get("action"));
        verifyNoInteractions(queue);
    }

    @Test
    void waitsForAllPendingPostsAndAllowsCancellationDuringCountdown() {
        var queue = mock(PostQueueRepository.class);
        var power = spy(new QueuePowerService(queue));
        doReturn(true).when(power).supported();
        when(queue.existsByStatusIn(List.of("PENDING", "PROCESSING"))).thenReturn(true);
        power.configure("SLEEP");
        power.tick();
        assertEquals(0L, power.status().get("executeAt"));
        when(queue.existsByStatusIn(List.of("PENDING", "PROCESSING"))).thenReturn(false);
        power.tick();
        assertTrue((Long) power.status().get("executeAt") > System.currentTimeMillis());
        power.configure("OFF");
        power.tick();
        assertEquals("OFF", power.status().get("action"));
        assertEquals(0L, power.status().get("executeAt"));
    }

    @Test
    void newPostsResetCountdownAndReadFailureDisarms() throws Exception {
        var queue = mock(PostQueueRepository.class);
        var power = spy(new QueuePowerService(queue));
        doReturn(true).when(power).supported();
        when(queue.existsByStatusIn(List.of("PENDING", "PROCESSING"))).thenReturn(true);
        power.configure("SHUTDOWN");
        var deadline = QueuePowerService.class.getDeclaredField("executeAt");
        deadline.setAccessible(true);
        deadline.set(power, 1L);
        power.tick(); // Even an expired countdown must recheck the queue first.
        assertEquals(0L, power.status().get("executeAt"));
        when(queue.existsByStatusIn(List.of("PENDING", "PROCESSING"))).thenThrow(new RuntimeException());
        power.tick();
        assertEquals("OFF", power.status().get("action"));
        assertFalse(((String) power.status().get("error")).isBlank());
    }

    @Test
    void rejectsEmptyQueueInvalidActionAndUnsupportedMachine() {
        var queue = mock(PostQueueRepository.class);
        var power = spy(new QueuePowerService(queue));
        doReturn(true).when(power).supported();
        assertThrows(IllegalArgumentException.class, () -> power.configure("SLEEP"));
        assertThrows(IllegalArgumentException.class, () -> power.configure("REBOOT"));
        doReturn(false).when(power).supported();
        assertThrows(IllegalArgumentException.class, () -> power.configure("SHUTDOWN"));
        assertEquals("OFF", power.configure("OFF").get("action"));
    }
}
