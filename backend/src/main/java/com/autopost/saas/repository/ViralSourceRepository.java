package com.autopost.saas.repository;

import com.autopost.saas.entity.ViralSource;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ViralSourceRepository extends JpaRepository<ViralSource, Long> {
    Optional<ViralSource> findByUrl(String url);

    List<ViralSource> findAllByOrderByCreatedAtDesc();

    List<ViralSource> findByAutoScanTrue();
}
