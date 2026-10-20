package com.autopost.saas.repository;

import com.autopost.saas.entity.GroupFlopLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface GroupFlopLogRepository extends JpaRepository<GroupFlopLog, Long> {
    List<GroupFlopLog> findByUserIdOrderByCreatedAtDesc(Long userId);
    boolean existsByPostQueueIdAndPostUrl(Long postQueueId, String postUrl);
}
