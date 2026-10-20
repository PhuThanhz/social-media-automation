package com.autopost.saas.repository;

import com.autopost.saas.entity.Campaign;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CampaignRepository extends JpaRepository<Campaign, Long> {
    List<Campaign> findByUserId(Long userId);
    List<Campaign> findByStatus(String status);
    java.util.Optional<Campaign> findByUserIdAndName(Long userId, String name);
    java.util.Optional<Campaign> findByName(String name);
}
