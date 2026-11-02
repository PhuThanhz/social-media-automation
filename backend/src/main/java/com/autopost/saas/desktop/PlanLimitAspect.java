package com.autopost.saas.desktop;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.SocialAccountRepository;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Bản Desktop: chặn tạo tài khoản mới (Via, Fanpage, TikTok, Threads…) khi đã đủ số lượng của gói.
 * Chặn ngay ở repository nên mọi đường tạo (thêm tay, đồng bộ Via, tự tạo khi đăng bài…) đều bị áp.
 * Nhóm Facebook không tính; cập nhật tài khoản đã có không bị chặn.
 */
@Aspect
@Component
@ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
@RequiredArgsConstructor
public class PlanLimitAspect {

    private final DesktopLicense license;
    // Lấy lười: aspect này chặn chính repository đó, inject thẳng dễ thành phụ thuộc vòng
    private final ObjectProvider<SocialAccountRepository> socialAccountRepository;

    @Before("execution(* save*(..)) && target(com.autopost.saas.repository.SocialAccountRepository)")
    public void checkAccountLimit(JoinPoint jp) {
        Object arg = jp.getArgs().length > 0 ? jp.getArgs()[0] : null;
        List<Object> entities = new ArrayList<>();
        if (arg instanceof Iterable<?> it) it.forEach(entities::add);
        else if (arg != null) entities.add(arg);

        long adding = entities.stream()
                .filter(e -> e instanceof SocialAccount a && a.getId() == null && !"FACEBOOK_GROUP".equals(a.getPlatform()))
                .count();
        if (adding == 0) return;

        int limit = license.current().map(DesktopLicense.Claims::accountLimit).orElse(0);
        long used = socialAccountRepository.getObject().countBillableAccounts();
        if (used + adding > limit) {
            throw new PlanLimitException("Gói bản quyền của bạn cho phép tối đa " + limit
                    + " tài khoản (đang dùng " + used + "). Liên hệ admin để nâng gói.");
        }
    }

    @RestControllerAdvice
    @ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
    static class Handler {
        @ExceptionHandler(PlanLimitException.class)
        ResponseEntity<Map<String, Object>> handle(PlanLimitException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "code", "PLAN_LIMIT", "message", e.getMessage(), "error", e.getMessage()));
        }
    }
}
