package com.autopost.saas.repository;

import com.autopost.saas.entity.SocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {
    List<SocialAccount> findByUserId(Long userId);
    List<SocialAccount> findByAccountType(String accountType);
    List<SocialAccount> findByAccountTypeIn(List<String> accountTypes);
    List<SocialAccount> findByAccountTypeAndPlatformAccountId(String accountType, String platformAccountId);
    Optional<SocialAccount> findByIdAndUserId(Long id, Long userId);
    Optional<SocialAccount> findByPlatformAccountId(String platformAccountId);
    Optional<SocialAccount> findByUserIdAndPlatformAndPlatformAccountId(Long userId, String platform, String platformAccountId);
}
