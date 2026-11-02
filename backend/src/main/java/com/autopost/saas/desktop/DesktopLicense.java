package com.autopost.saas.desktop;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Optional;

/**
 * Bản Desktop: backend tự đọc và kiểm chữ ký token bản quyền (file license.tok do app Tauri ghi),
 * không tin giới hạn gói do frontend gửi lên. Public key + HWID do app truyền qua biến môi trường.
 */
@Component
@ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class DesktopLicense {

    private static final long CACHE_MS = 15_000;
    private static final long CLOCK_SKEW_SECS = 300;
    // Tiền tố SubjectPublicKeyInfo cho khóa Ed25519 32 byte
    private static final byte[] ED25519_SPKI_PREFIX = {0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00};

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Claims(String key, String hwid, String client, Integer maxAccounts, Integer maxUsers,
                         Long licenseExp, long iat, long exp) {
        public int accountLimit() {
            return maxAccounts == null ? 10 : maxAccounts;
        }

        public int userLimit() {
            return maxUsers == null ? 1 : maxUsers;
        }
    }

    private final ObjectMapper objectMapper;
    private volatile Claims cached;
    private volatile long cachedAt;

    /** Token hợp lệ hiện tại; rỗng nếu chưa kích hoạt, sai chữ ký, sai máy hoặc hết hạn */
    public Optional<Claims> current() {
        long now = System.currentTimeMillis();
        if (now - cachedAt > CACHE_MS) {
            cached = load();
            cachedAt = now;
        }
        return Optional.ofNullable(cached);
    }

    private Claims load() {
        try {
            String dataDir = System.getenv("APP_DATA_DIR");
            String publicKey = System.getenv("LICENSE_PUBLIC_KEY");
            String hwid = System.getenv("DESKTOP_HWID");
            if (dataDir == null || publicKey == null || hwid == null) return null;
            Path file = Path.of(dataDir, "license.tok");
            if (!Files.exists(file)) return null;

            String[] parts = Files.readString(file).trim().split("\\.");
            if (parts.length != 2) return null;
            byte[] payload = Base64.getUrlDecoder().decode(parts[0]);
            byte[] sig = Base64.getUrlDecoder().decode(parts[1]);

            byte[] raw = Base64.getUrlDecoder().decode(publicKey);
            byte[] spki = new byte[ED25519_SPKI_PREFIX.length + raw.length];
            System.arraycopy(ED25519_SPKI_PREFIX, 0, spki, 0, ED25519_SPKI_PREFIX.length);
            System.arraycopy(raw, 0, spki, ED25519_SPKI_PREFIX.length, raw.length);
            PublicKey key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(spki));
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(key);
            verifier.update(payload);
            if (!verifier.verify(sig)) return null;

            Claims c = objectMapper.readValue(payload, Claims.class);
            long now = System.currentTimeMillis() / 1000;
            if (!hwid.equals(c.hwid())) return null;
            if (now + CLOCK_SKEW_SECS < c.iat() || now > c.exp()) return null;
            if (c.licenseExp() != null && now > c.licenseExp()) return null;
            return c;
        } catch (Exception e) {
            log.warn("Không đọc được token bản quyền: {}", e.getMessage());
            return null;
        }
    }
}
