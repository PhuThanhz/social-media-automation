package com.autopost.saas.repository;

import com.autopost.saas.entity.PostQueueGroupResult;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface PostQueueGroupResultRepository extends JpaRepository<PostQueueGroupResult, Long> {
    List<PostQueueGroupResult> findByPostQueue_Campaign_User_IdAndStatusAndAttemptedAtBetween(
            Long userId, String status, LocalDateTime from, LocalDateTime to);

    /** Bằng chứng gần nhất cho thấy một PostQueue đã thực sự đăng thành công vào ít nhất một Group. */
    java.util.Optional<PostQueueGroupResult> findFirstByPostQueue_IdAndStatusOrderByAttemptedAtDesc(Long postQueueId, String status);

    /**
     * Toàn bộ lần thử Group của một bài, mới nhất trước. Fetch luôn SocialAccount
     * để endpoint retry có thể xác định Group ID sau khi transaction repository đã đóng.
     */
    @EntityGraph(attributePaths = "socialAccount")
    List<PostQueueGroupResult> findByPostQueue_IdOrderByAttemptedAtDesc(Long postQueueId);

    /** Thanh "Kiểm tra link": permalink từng nhóm. */
    @org.springframework.data.jpa.repository.Query("SELECT r FROM PostQueueGroupResult r JOIN FETCH r.postQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH r.socialAccount WHERE c.user.id = :userId AND LOWER(r.postUrl) LIKE CONCAT('%', :needle, '%') ORDER BY r.id DESC")
    List<PostQueueGroupResult> searchByPostUrlNeedle(@org.springframework.data.repository.query.Param("userId") Long userId, @org.springframework.data.repository.query.Param("needle") String needle, org.springframework.data.domain.Pageable pageable);

    void deleteByPostQueue_Id(Long postQueueId);

    void deleteBySocialAccount_Id(Long socialAccountId);
}
