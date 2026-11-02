package com.autopost.saas.repository;

import com.autopost.saas.entity.SocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {
    List<SocialAccount> findByUserId(Long userId);

    /** Số tài khoản tính vào gói bản quyền (Via, Fanpage, TikTok, Threads…); Nhóm Facebook không tính */
    @org.springframework.data.jpa.repository.Query("select count(a) from SocialAccount a where a.platform is null or a.platform <> 'FACEBOOK_GROUP'")
    long countBillableAccounts();
    List<SocialAccount> findByAccountType(String accountType);
    List<SocialAccount> findByAccountTypeIn(List<String> accountTypes);
    List<SocialAccount> findByAccountTypeAndPlatformAccountId(String accountType, String platformAccountId);
    Optional<SocialAccount> findByIdAndUserId(Long id, Long userId);
    Optional<SocialAccount> findByPlatformAccountId(String platformAccountId);
    Optional<SocialAccount> findFirstByPlatformAccountIdOrderByIdAsc(String platformAccountId);
    Optional<SocialAccount> findFirstByPlatformAccountIdAndAccountTypeIgnoreCaseOrderByIdAsc(String platformAccountId, String accountType);
    Optional<SocialAccount> findByUserIdAndPlatformAndPlatformAccountId(Long userId, String platform, String platformAccountId);
}
