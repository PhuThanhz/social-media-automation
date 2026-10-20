package com.autopost.saas.repository;

import com.autopost.saas.entity.PostQueue;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface PostQueueRepository extends JpaRepository<PostQueue, Long> {
    List<PostQueue> findByCampaignId(Long campaignId);

    // Bài của Threads Studio: targetFanpageId dạng "username:THREADS_COOKIE:connectionId".
    List<PostQueue> findTop500ByTargetFanpageIdContainingOrderByIdDesc(String marker);

    /** Bản phân trang của findByCampaignId, dùng cho các endpoint/lời gọi mới cần giới hạn kích thước lịch sử trả về. */
    Page<PostQueue> findByCampaignId(Long campaignId, Pageable pageable);
    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u WHERE p.status = :status AND p.scheduledAt < :time ORDER BY p.scheduledAt ASC, p.id ASC")
    List<PostQueue> findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc(@org.springframework.data.repository.query.Param("status") String status, @org.springframework.data.repository.query.Param("time") LocalDateTime time);
    boolean existsByOriginalUrlAndCampaignId(String originalUrl, Long campaignId);

    /** Dedup xuyên suốt mọi campaign của 1 user — tránh đăng trùng khi cùng 1 bài được cào lại từ nguồn khác. */
    boolean existsByOriginalUrlAndCampaign_User_Id(String originalUrl, Long userId);

    /**
     * Bài trong Lịch đăng (đang chờ / đang đăng / đã đăng) có link gốc chứa ID bài này — dùng để chặn
     * gửi trùng cùng 1 bài gốc vào cùng nhóm. Kết quả cần so lại ID chính xác vì LIKE có thể khớp ID dài hơn.
     */
    @Query("SELECT p FROM PostQueue p LEFT JOIN p.campaign c LEFT JOIN c.user u WHERE u.id = :userId AND p.originalUrl LIKE CONCAT('%', :postId, '%') AND p.status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'PENDING_APPROVAL')")
    List<PostQueue> findActiveByUserIdAndOriginalUrlContaining(@org.springframework.data.repository.query.Param("userId") Long userId, @org.springframework.data.repository.query.Param("postId") String postId);

    /**
     * Dedup theo content-hash (thay cho original_url): khi Playwright không tìm thấy permalink
     * riêng của 1 bài, original_url bị fallback về URL của Group/Page nguồn nên nhiều bài khác
     * nội dung có thể trùng original_url — dedup theo hash nội dung tránh bỏ sót bài mới.
     */
    boolean existsByContentHashAndCampaignId(String contentHash, Long campaignId);

    /** Bản xuyên suốt mọi campaign của 1 user của existsByContentHashAndCampaignId. */
    boolean existsByContentHashAndCampaign_User_Id(String contentHash, Long userId);

    @Query("SELECT COUNT(p) > 0 FROM PostQueue p LEFT JOIN p.campaign c LEFT JOIN c.user u WHERE p.contentHash = :contentHash AND u.id = :userId AND p.createdAt >= :since")
    boolean existsRecentByContentHashAndUserId(String contentHash, Long userId, LocalDateTime since);

    /** Danh sách bài cào tự động hàng loạt đang chờ duyệt trước khi lên lịch đăng thật. */
    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u WHERE p.status = 'PENDING_APPROVAL' AND u.id = :userId ORDER BY p.id DESC")
    List<PostQueue> findPendingApprovalByUserId(Long userId);

    /** Lấy bài trong khoảng thời gian [from, to) để hiển thị trên Lịch đăng bài. */
    List<PostQueue> findByScheduledAtBetween(LocalDateTime from, LocalDateTime to);

    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u WHERE p.id = :id")
    java.util.Optional<PostQueue> findByIdWithCampaignAndUser(Long id);

    /**
     * Đánh dấu nguyên tử (atomic) 1 bài PENDING sang PROCESSING trước khi thực sự đăng, để tránh
     * việc CampaignScheduler (chạy mỗi 60s) và request đăng-ngay cùng đăng trùng 1 bài (do lúc đăng
     * qua Graph API + chờ xác nhận mã hóa video có thể mất hơn 60 giây). Trả về 1 nếu "chiếm" được
     * quyền đăng bài này, 0 nếu bài đã được thread khác xử lý/đăng trước rồi.
     */
    @Modifying
    @Transactional
    @Query("UPDATE PostQueue p SET p.status = 'PROCESSING' WHERE p.id = :id AND (p.status = 'PENDING' OR p.status = 'FAILED' OR p.status = 'CANCELLED')")
    int markProcessingIfPending(Long id);

    List<PostQueue> findByStatusAndUpdatedAtBefore(String status, LocalDateTime time);

    List<PostQueue> findByStatusAndTargetFanpageIdEndingWith(String status, String suffix);

    List<PostQueue> findTop50ByStatusOrderByIdDesc(String status);

    List<PostQueue> findByStatusOrderByIdAsc(String status);

    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u WHERE p.status = 'PUBLISHED' ORDER BY p.id DESC")
    List<PostQueue> findTop50PublishedWithCampaignAndUser();

    /** Cập nhật nhịp sống khi một bài PROCESSING đang lần lượt đăng qua nhiều Group. */
    @Modifying
    @Transactional
    @Query("UPDATE PostQueue p SET p.updatedAt = :heartbeatAt WHERE p.id = :id AND p.status = 'PROCESSING'")
    int touchProcessing(Long id, LocalDateTime heartbeatAt);

    /**
     * Đánh dấu nguyên tử 1 bài FAILED quay lại PENDING để thử đăng lại (auto-retry), tăng retryCount
     * lên 1. Chỉ áp dụng nếu chưa vượt quá số lần thử tối đa. Trả về 1 nếu "chiếm" được quyền retry.
     */
    @Modifying
    @Transactional
    @Query("UPDATE PostQueue p SET p.status = 'PENDING', p.retryCount = p.retryCount + 1 WHERE p.id = :id AND p.status = 'FAILED' AND p.retryCount < :maxRetries")
    int markRetryIfEligible(Long id, int maxRetries);

    /**
     * Đếm số bài đã đăng thành công hôm nay cho 1 Fanpage (dùng để giới hạn số bài/ngày, tránh spam).
     * So khớp chính xác hoặc prefix CÓ dấu ':' theo sau (dạng platformAccountId:accountType:connectionId)
     * — tránh gộp nhầm nếu 1 platformAccountId là tiền tố số của 1 platformAccountId khác.
     */
    @Query("SELECT COUNT(p) FROM PostQueue p WHERE (p.targetFanpageId = :pageIdPrefix OR p.targetFanpageId LIKE CONCAT(:pageIdPrefix, ':%')) AND p.status = 'PUBLISHED' AND p.publishedAt >= :startOfDay")
    long countPublishedTodayForFanpage(String pageIdPrefix, LocalDateTime startOfDay);

    /** Đếm tổng số bài đã đăng thành công hôm nay của 1 user (xuyên suốt mọi campaign/Fanpage) — dùng cho KPI trên Dashboard. */
    @Query("SELECT COUNT(p) FROM PostQueue p WHERE p.campaign.user.id = :userId AND p.status = 'PUBLISHED' AND p.publishedAt >= :startOfDay")
    long countPublishedTodayByUserId(Long userId, LocalDateTime startOfDay);

    /** Lấy danh sách lịch sử & hàng đợi Story của người dùng */
    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c WHERE p.postType = 'STORY' AND c.user.id = :userId ORDER BY p.id DESC")
    List<PostQueue> findStoriesByUserId(Long userId);

    /**
     * Lấy các bài đã đăng thành công của 1 user trong khoảng thời gian, dùng để tính KPI Fanpage theo
     * ngày trên Lịch đăng bài (KHÁC với countPublishedTodayForFanpage — đó là để giới hạn maxPostsPerDay,
     * không đụng vào để tránh ảnh hưởng logic cũ).
     */
    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u " +
           "WHERE u.id = :userId AND p.status = 'PUBLISHED' AND (p.postType IS NULL OR p.postType != 'STORY') AND p.publishedAt >= :from AND p.publishedAt < :to")
    List<PostQueue> findPublishedByUserIdAndPublishedAtBetween(Long userId, LocalDateTime from, LocalDateTime to);

    /** Lấy các bài đang PENDING / PROCESSING của user trong khoảng thời gian để tính số bài đã lên lịch hôm nay. */
    @Query("SELECT p FROM PostQueue p LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u " +
           "WHERE u.id = :userId AND (p.status = 'PENDING' OR p.status = 'PROCESSING') AND (p.postType IS NULL OR p.postType != 'STORY') " +
           "AND p.scheduledAt >= :from AND p.scheduledAt < :to")
    List<PostQueue> findActivePendingByUserIdAndScheduledAtBetween(Long userId, LocalDateTime from, LocalDateTime to);

    /** Kiểm tra xem bài có original_url đã được đăng thành công hoặc ĐANG ĐĂNG (PROCESSING) lên nhóm targetGroupNames trước đó chưa (tránh spam/đăng lặp). */
    @Query("SELECT COUNT(p) > 0 FROM PostQueue p WHERE p.originalUrl = :url AND p.targetGroupNames = :groupNames AND (p.status = 'PUBLISHED' OR p.status = 'PROCESSING') AND p.id <> :excludeId")
    boolean existsActiveOrPublishedDuplicate(@org.springframework.data.repository.query.Param("url") String url,
                                             @org.springframework.data.repository.query.Param("groupNames") String groupNames,
                                             @org.springframework.data.repository.query.Param("excludeId") Long excludeId);

    /** Thống kê số lượng bài theo từng trạng thái (PENDING, PROCESSING, PUBLISHED, FAILED) của 1 user */
    @Query("SELECT p.status, COUNT(p) FROM PostQueue p WHERE p.campaign.user.id = :userId GROUP BY p.status")
    List<Object[]> countByStatusForUser(@org.springframework.data.repository.query.Param("userId") Long userId);

    /** Lấy hàng đợi active (PENDING, PROCESSING, FAILED) + các bài PUBLISHED từ thời điểm 'since' trở lại đây của 1 campaign */
    @Query("SELECT p FROM PostQueue p WHERE p.campaign.id = :campaignId AND (p.status != 'PUBLISHED' OR p.publishedAt >= :since) ORDER BY p.id DESC")
    List<PostQueue> findActiveAndRecentByCampaignId(@org.springframework.data.repository.query.Param("campaignId") Long campaignId, @org.springframework.data.repository.query.Param("since") LocalDateTime since);
}
