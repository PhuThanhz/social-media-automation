package com.autopost.saas.repository;

import com.autopost.saas.entity.ViralInboxItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Set;

@Repository
public interface ViralInboxItemRepository extends JpaRepository<ViralInboxItem, Long> {
    List<ViralInboxItem> findByStatusOrderByFoundAtDesc(String status);

    long countByStatus(String status);

    java.util.Optional<ViralInboxItem> findByPostUrl(String postUrl);

    /** Thanh "Kiểm tra link". */
    @org.springframework.data.jpa.repository.Query("SELECT v FROM ViralInboxItem v WHERE LOWER(v.postUrl) LIKE CONCAT('%', :needle, '%') ORDER BY v.id DESC")
    List<ViralInboxItem> searchByPostUrlNeedle(@org.springframework.data.repository.query.Param("needle") String needle, org.springframework.data.domain.Pageable pageable);

    @Query("select i.postUrl from ViralInboxItem i where i.postUrl in :urls")
    Set<String> findExistingUrls(Collection<String> urls);

    @Modifying
    @Transactional
    @Query("delete from ViralInboxItem i where i.foundAt < :before")
    int deleteOlderThan(LocalDateTime before);
}
