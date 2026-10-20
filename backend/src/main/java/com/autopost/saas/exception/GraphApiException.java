package com.autopost.saas.exception;

import lombok.Getter;

/**
 * Lỗi thật trả về từ Facebook Graph API (đã parse từ body {"error": {...}}),
 * thay vì message chung chung của RestTemplate/Spring.
 */
@Getter
public class GraphApiException extends RuntimeException {

    private final int code;
    private final int subcode;

    public GraphApiException(String message, int code, int subcode, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.subcode = subcode;
    }

    /** code=190 là mã lỗi chuẩn của Facebook cho access token hết hạn/không hợp lệ. */
    public boolean isInvalidToken() {
        return code == 190;
    }
}
