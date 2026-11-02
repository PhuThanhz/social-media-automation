package com.autopost.saas.desktop;

/** Vượt giới hạn gói bản quyền (số tài khoản / số người dùng) */
public class PlanLimitException extends RuntimeException {
    public PlanLimitException(String message) {
        super(message);
    }
}
