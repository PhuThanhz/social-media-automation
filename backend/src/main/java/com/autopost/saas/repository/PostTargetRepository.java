package com.autopost.saas.repository;

import com.autopost.saas.entity.PostTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface PostTargetRepository extends JpaRepository<PostTarget, Long> {
    Optional<PostTarget> findBySocialAccount_IdAndTargetDate(Long socialAccountId, LocalDate targetDate);
    List<PostTarget> findBySocialAccount_User_IdAndTargetDateBetween(Long userId, LocalDate from, LocalDate to);
    List<PostTarget> findByTargetDate(LocalDate targetDate);
    Optional<PostTarget> findFirstBySocialAccount_IdOrderByTargetDateDesc(Long socialAccountId);
    List<PostTarget> findBySocialAccount_Id(Long socialAccountId);
    void deleteBySocialAccount_Id(Long socialAccountId);
}

