package com.autopost.saas.desktop;

import com.autopost.saas.entity.User;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Bản Desktop: người dùng trong app khách.
 * - Lần đầu mở app: tạo tài khoản Chủ (không còn tài khoản mặc định admin@gmail.com / 123456).
 * - Chủ thêm / khóa / xóa / đặt lại mật khẩu người dùng, trong giới hạn "số người dùng" của gói.
 * Mỗi người dùng có dữ liệu riêng (Via, Fanpage, chiến dịch…) như backend vốn tách theo user.
 */
@RestController
@RequestMapping("/api/desktop")
@ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
@RequiredArgsConstructor
public class DesktopUsersController {

    private static final Pattern LOGIN_NAME = Pattern.compile("^[a-z0-9._-]{3,50}$");
    private static final String OWNER = "OWNER";
    private static final String MEMBER = "MEMBER";

    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final DesktopLicense license;
    private final DesktopDefaultGroups defaultGroups;

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("success", false, "message", message));
    }

    private int userLimit() {
        return license.current().map(DesktopLicense.Claims::userLimit).orElse(0);
    }

    private long activeUsers() {
        return userRepository.findAll().stream().filter(u -> !Boolean.TRUE.equals(u.getDisabled())).count();
    }

    private User currentUser(Authentication auth) {
        return userRepository.findByEmail(auth.getName()).orElseThrow();
    }

    private static boolean isOwner(User u) {
        return OWNER.equals(u.getRole());
    }

    private String tokenFor(User user) {
        return jwtTokenProvider.generateToken(new UsernamePasswordAuthenticationToken(
                user.getEmail(), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
    }

    private Map<String, Object> plan() {
        Map<String, Object> plan = new LinkedHashMap<>();
        license.current().ifPresent(c -> {
            plan.put("client", c.client());
            plan.put("licenseExp", c.licenseExp());
        });
        plan.put("maxUsers", userLimit());
        plan.put("usedUsers", activeUsers());
        plan.put("maxAccounts", license.current().map(DesktopLicense.Claims::accountLimit).orElse(0));
        plan.put("usedAccounts", socialAccountRepository.countBillableAccounts());
        return plan;
    }

    private static Map<String, Object> view(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("login", u.getEmail());
        m.put("displayName", u.getUsername());
        m.put("role", u.getRole() == null ? MEMBER : u.getRole());
        m.put("disabled", Boolean.TRUE.equals(u.getDisabled()));
        m.put("createdAt", u.getCreatedAt());
        return m;
    }

    @GetMapping("/setup-status")
    public Map<String, Object> setupStatus() {
        return Map.of("needsSetup", userRepository.count() == 0, "plan", plan());
    }

    /** Tạo tài khoản Chủ — chỉ khi chưa có người dùng nào */
    @PostMapping("/setup")
    @Transactional
    public ResponseEntity<?> setup(@RequestBody Map<String, String> body) {
        if (userRepository.count() > 0) return error(HttpStatus.CONFLICT, "Ứng dụng đã được thiết lập");
        String login = body.getOrDefault("login", "").trim().toLowerCase();
        String password = body.getOrDefault("password", "");
        String displayName = body.getOrDefault("displayName", "").trim();
        if (!LOGIN_NAME.matcher(login).matches()) return error(HttpStatus.BAD_REQUEST, "Tên đăng nhập 3-50 ký tự: chữ thường, số, . _ -");
        if (password.length() < 6) return error(HttpStatus.BAD_REQUEST, "Mật khẩu tối thiểu 6 ký tự");

        User owner = new User();
        owner.setEmail(login);
        owner.setUsername(displayName.isEmpty() ? login : displayName);
        owner.setPassword(passwordEncoder.encode(password));
        owner.setRole(OWNER);
        userRepository.save(owner);
        defaultGroups.seedFor(owner);
        return ResponseEntity.ok(Map.of("success", true, "accessToken", tokenFor(owner)));
    }

    @GetMapping("/me")
    public Map<String, Object> me(Authentication auth) {
        Map<String, Object> m = new LinkedHashMap<>(view(currentUser(auth)));
        m.put("plan", plan());
        return m;
    }

    @GetMapping("/users")
    public ResponseEntity<?> list(Authentication auth) {
        if (!isOwner(currentUser(auth))) return error(HttpStatus.FORBIDDEN, "Chỉ chủ tài khoản mới quản lý được người dùng");
        return ResponseEntity.ok(Map.of("users", userRepository.findAll().stream().map(DesktopUsersController::view).toList(), "plan", plan()));
    }

    @PostMapping("/users")
    @Transactional
    public ResponseEntity<?> create(Authentication auth, @RequestBody Map<String, String> body) {
        if (!isOwner(currentUser(auth))) return error(HttpStatus.FORBIDDEN, "Chỉ chủ tài khoản mới thêm được người dùng");
        String login = body.getOrDefault("login", "").trim().toLowerCase();
        String password = body.getOrDefault("password", "");
        String displayName = body.getOrDefault("displayName", "").trim();
        if (!LOGIN_NAME.matcher(login).matches()) return error(HttpStatus.BAD_REQUEST, "Tên đăng nhập 3-50 ký tự: chữ thường, số, . _ -");
        if (password.length() < 6) return error(HttpStatus.BAD_REQUEST, "Mật khẩu tối thiểu 6 ký tự");
        if (userRepository.existsByEmail(login)) return error(HttpStatus.BAD_REQUEST, "Tên đăng nhập đã tồn tại");
        int limit = userLimit();
        if (activeUsers() >= limit) {
            return error(HttpStatus.FORBIDDEN, "Gói bản quyền cho phép tối đa " + limit + " người dùng. Liên hệ admin để nâng gói.");
        }
        User u = new User();
        u.setEmail(login);
        u.setUsername(displayName.isEmpty() ? login : displayName);
        u.setPassword(passwordEncoder.encode(password));
        u.setRole(MEMBER);
        userRepository.save(u);
        defaultGroups.seedFor(u);
        return ResponseEntity.ok(Map.of("success", true, "message", "Đã thêm người dùng " + login));
    }

    /** Body: { password?, disabled?, displayName? } */
    @PatchMapping("/users/{id}")
    @Transactional
    public ResponseEntity<?> update(Authentication auth, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        User me = currentUser(auth);
        if (!isOwner(me)) return error(HttpStatus.FORBIDDEN, "Chỉ chủ tài khoản mới sửa được người dùng");
        User u = userRepository.findById(id).orElse(null);
        if (u == null) return error(HttpStatus.NOT_FOUND, "Không tìm thấy người dùng");

        if (body.containsKey("disabled")) {
            boolean disable = Boolean.TRUE.equals(body.get("disabled"));
            if (disable && u.getId().equals(me.getId())) return error(HttpStatus.BAD_REQUEST, "Không thể tự khóa chính mình");
            if (!disable && Boolean.TRUE.equals(u.getDisabled()) && activeUsers() >= userLimit()) {
                return error(HttpStatus.FORBIDDEN, "Đã đủ " + userLimit() + " người dùng của gói. Khóa bớt người khác hoặc nâng gói.");
            }
            u.setDisabled(disable);
        }
        if (body.get("password") instanceof String pw && !pw.isEmpty()) {
            if (pw.length() < 6) return error(HttpStatus.BAD_REQUEST, "Mật khẩu tối thiểu 6 ký tự");
            u.setPassword(passwordEncoder.encode(pw));
        }
        if (body.get("displayName") instanceof String name && !name.isBlank()) {
            u.setUsername(name.trim());
        }
        userRepository.save(u);
        return ResponseEntity.ok(Map.of("success", true, "message", "Đã cập nhật " + u.getEmail()));
    }

    @DeleteMapping("/users/{id}")
    public ResponseEntity<?> delete(Authentication auth, @PathVariable Long id) {
        User me = currentUser(auth);
        if (!isOwner(me)) return error(HttpStatus.FORBIDDEN, "Chỉ chủ tài khoản mới xóa được người dùng");
        if (me.getId().equals(id)) return error(HttpStatus.BAD_REQUEST, "Không thể tự xóa chính mình");
        try {
            userRepository.deleteById(id);
            userRepository.flush();
        } catch (DataIntegrityViolationException e) {
            return error(HttpStatus.CONFLICT, "Người dùng này còn dữ liệu (Via, Fanpage, chiến dịch…). Hãy khóa thay vì xóa.");
        }
        return ResponseEntity.ok(Map.of("success", true, "message", "Đã xóa người dùng"));
    }
}
