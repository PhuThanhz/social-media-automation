-- =========================================================
-- SQL Schema Cho Auto Post SaaS - Dùng với MySQL Workbench
-- =========================================================

-- 1. Tạo Database nếu chưa có
CREATE DATABASE IF NOT EXISTS `autopost_saas` 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `autopost_saas`;

-- 2. Bảng Users (Người dùng)
CREATE TABLE IF NOT EXISTS `users` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `username` VARCHAR(50) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng Social Accounts (Tài khoản/Fanpage liên kết)
CREATE TABLE IF NOT EXISTS `social_accounts` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `platform` VARCHAR(50) NOT NULL,
    `platform_account_id` VARCHAR(100),
    `access_token` TEXT,
    `page_name` VARCHAR(150),
    `account_type` VARCHAR(50),
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_social_accounts_user_platform` (`user_id`, `platform`),
    KEY `idx_social_accounts_platform_id_type` (`platform_account_id`, `account_type`),
    KEY `idx_social_accounts_account_type` (`account_type`),
    KEY `idx_social_accounts_token_status` (`token_status`),
    CONSTRAINT `fk_social_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3b. Snapshot quyền Page theo từng nick cá nhân (c_user)
CREATE TABLE IF NOT EXISTS `facebook_page_accesses` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `source_account_id` BIGINT NOT NULL,
    `personal_profile_id` VARCHAR(100) NOT NULL,
    `profile_name` VARCHAR(180),
    `page_id` VARCHAR(100) NOT NULL,
    `page_name` VARCHAR(180) NOT NULL,
    `page_url` VARCHAR(1000),
    `avatar_url` VARCHAR(1500),
    `verification_status` VARCHAR(30) NOT NULL,
    `verification_message` VARCHAR(500),
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `first_seen_at` DATETIME NOT NULL,
    `last_seen_at` DATETIME NOT NULL,
    `last_verified_at` DATETIME,
    `last_scan_at` DATETIME NOT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_page_access_user_profile_page` (`user_id`, `personal_profile_id`, `page_id`),
    KEY `idx_page_access_profile` (`user_id`, `personal_profile_id`),
    KEY `idx_page_access_status` (`verification_status`, `last_seen_at`),
    CONSTRAINT `fk_page_access_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_page_access_source_account` FOREIGN KEY (`source_account_id`) REFERENCES `social_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bảng Campaigns (Chiến dịch cào/đăng bài)
CREATE TABLE IF NOT EXISTS `campaigns` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `source_url` VARCHAR(500),
    `source_type` VARCHAR(50),
    `target_fanpage_ids` VARCHAR(500),
    `ai_rewrite_enabled` TINYINT(1) DEFAULT 0,
    `posting_interval_minutes` INT DEFAULT 60,
    `max_items_per_scrape` INT DEFAULT 10,
    `cron_expression` VARCHAR(50),
    `last_scraped_at` DATETIME,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `n8n_webhook_url` VARCHAR(500),
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_campaigns_user_status` (`user_id`, `status`),
    KEY `idx_campaigns_status` (`status`),
    CONSTRAINT `fk_campaigns_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bảng Post Queue (Hàng chờ đăng bài)
CREATE TABLE IF NOT EXISTS `post_queue` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `campaign_id` BIGINT NOT NULL,
    `original_url` MEDIUMTEXT,
    `title` TEXT,
    `content` TEXT,
    `media_urls` TEXT,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `target_fanpage_id` VARCHAR(255),
    `scheduled_at` DATETIME,
    `published_at` DATETIME,
    `error_message` TEXT,
    `affiliate_link` VARCHAR(1000),
    `target_group_names` TEXT,
    `published_post_url` MEDIUMTEXT,
    `published_group_post_urls` TEXT,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_post_queue_status_scheduled_id` (`status`, `scheduled_at`, `id`),
    KEY `idx_post_queue_status_updated` (`status`, `updated_at`),
    KEY `idx_post_queue_published_at` (`published_at`),
    KEY `idx_post_queue_target_fanpage_id` (`target_fanpage_id`),
    CONSTRAINT `fk_post_queue_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Bảng Cấu hình Bài Flop theo Group chỉ định (Tiêu chí động)
CREATE TABLE IF NOT EXISTS `group_flop_configs` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `group_name` VARCHAR(255) NOT NULL,
    `group_url` VARCHAR(500),
    `social_account_id` BIGINT NULL,
    `social_account_name` VARCHAR(150),
    `check_after_hours` INT DEFAULT 2,
    `check_after_minutes` INT DEFAULT 120,
    `min_likes_threshold` INT DEFAULT 10,
    `min_comments_threshold` INT DEFAULT 0,
    `enabled` TINYINT(1) DEFAULT 1,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_group_flop_configs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Bảng Nhật ký Bài viết bị Xoá do Flop
CREATE TABLE IF NOT EXISTS `group_flop_logs` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL,
    `post_queue_id` BIGINT,
    `group_name` VARCHAR(255) NOT NULL,
    `post_url` VARCHAR(1000) NOT NULL,
    `likes_count` INT DEFAULT 0,
    `comments_count` INT DEFAULT 0,
    `status` VARCHAR(50) NOT NULL DEFAULT 'DELETED_SUCCESS',
    `reason` VARCHAR(500),
    `deleted_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_group_flop_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mẫu dữ liệu Admin test (Mật khẩu mã hóa BCrypt: admin123)
-- INSERT INTO `users` (`email`, `username`, `password`) 
-- VALUES ('admin@example.com', 'admin', '$2a$10$e8W/X21wV8w.uB3uS9g8d.8fH28a2p.X.y1G8N1g/Z8v3J3k3k3k3');

