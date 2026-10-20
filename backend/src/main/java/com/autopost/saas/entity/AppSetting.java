package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;

/** Cài đặt chung dạng khoá/giá trị cho toàn app (VD: khung giờ đăng). */
@Entity
@Table(name = "app_settings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class AppSetting {

    @Id
    @Column(name = "setting_key", length = 100)
    private String key;

    @Column(name = "setting_value", columnDefinition = "TEXT")
    private String value;
}
