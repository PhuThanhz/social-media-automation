package com.autopost.saas.publishing.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Kết quả kiểm tra điều kiện trước khi đưa bài đăng vào Queue và gửi tới Worker (Preflight Validation).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PreflightResult {

    private boolean valid;

    @Builder.Default
    private List<String> errors = new ArrayList<>();

    @Builder.Default
    private List<String> warnings = new ArrayList<>();

    public static PreflightResult success() {
        return PreflightResult.builder().valid(true).build();
    }

    public static PreflightResult fail(String error) {
        List<String> errs = new ArrayList<>();
        errs.add(error);
        return PreflightResult.builder().valid(false).errors(errs).build();
    }

    public void addError(String error) {
        if (this.errors == null) this.errors = new ArrayList<>();
        this.errors.add(error);
        this.valid = false;
    }

    public void addWarning(String warning) {
        if (this.warnings == null) this.warnings = new ArrayList<>();
        this.warnings.add(warning);
    }
}

