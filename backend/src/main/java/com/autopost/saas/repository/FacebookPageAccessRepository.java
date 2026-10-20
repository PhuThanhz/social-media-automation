package com.autopost.saas.repository;

import com.autopost.saas.entity.FacebookPageAccess;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface FacebookPageAccessRepository extends JpaRepository<FacebookPageAccess, Long> {
    List<FacebookPageAccess> findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(Long userId, String personalProfileId);

    Optional<FacebookPageAccess> findByUserIdAndPersonalProfileIdAndPageId(
            Long userId,
            String personalProfileId,
            String pageId
    );

    List<FacebookPageAccess> findByPageIdAndActiveTrue(String pageId);

    List<FacebookPageAccess> findByUserIdAndPageIdAndActiveTrue(Long userId, String pageId);

    void deleteBySourceAccountId(Long sourceAccountId);
}
