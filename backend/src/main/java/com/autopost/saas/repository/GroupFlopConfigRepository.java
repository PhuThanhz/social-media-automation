package com.autopost.saas.repository;

import com.autopost.saas.entity.GroupFlopConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface GroupFlopConfigRepository extends JpaRepository<GroupFlopConfig, Long> {
    List<GroupFlopConfig> findByUserIdOrderByCreatedAtDesc(Long userId);
    List<GroupFlopConfig> findByUserIdAndEnabledTrue(Long userId);
    Optional<GroupFlopConfig> findByUserIdAndGroupName(Long userId, String groupName);
}
