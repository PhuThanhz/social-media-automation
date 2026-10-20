package com.autopost.saas.service;

import com.autopost.saas.entity.Campaign;
import com.autopost.saas.repository.CampaignRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class CampaignService {

    private final CampaignRepository repository;

    @Cacheable(value = "campaignsByUser", key = "#userId")
    public List<Campaign> getCampaignsByUserId(Long userId) {
        return repository.findByUserId(userId);
    }
}
