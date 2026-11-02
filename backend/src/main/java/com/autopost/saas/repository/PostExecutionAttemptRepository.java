package com.autopost.saas.repository;

import com.autopost.saas.entity.PostExecutionAttempt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PostExecutionAttemptRepository extends JpaRepository<PostExecutionAttempt, Long> {

    List<PostExecutionAttempt> findByPostQueueIdOrderByStartedAtDesc(Long postQueueId);

    Optional<PostExecutionAttempt> findFirstByPostQueueIdOrderByStartedAtDesc(Long postQueueId);

    Optional<PostExecutionAttempt> findByAttemptToken(String attemptToken);

    List<PostExecutionAttempt> findTop50ByOrderByStartedAtDesc();
}

