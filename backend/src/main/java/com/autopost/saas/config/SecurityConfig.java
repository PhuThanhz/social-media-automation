package com.autopost.saas.config;

import com.autopost.saas.security.DesktopSessionTokenFilter;
import com.autopost.saas.security.JwtAuthenticationFilter;
import com.autopost.saas.util.LocalServices;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration configuration) throws Exception {
        return configuration.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        if (LocalServices.SESSION_TOKEN != null) {
            return desktopFilterChain(http);
        }
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests((authorize) -> authorize
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/**").permitAll()
                        .requestMatchers("/api/queue/**").permitAll()
                        .requestMatchers("/api/campaigns/**").permitAll()
                        .requestMatchers("/api/connections/**").permitAll()
                        .requestMatchers("/actuator/**").permitAll()
                        .anyRequest().permitAll()
                )
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
                );

        http.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    /**
     * Bản Desktop: mọi API cần token phiên (filter) + đăng nhập người dùng trong app.
     * Ngoại lệ: đăng nhập/thiết lập lần đầu, file tĩnh, health, và request của worker.
     * Không cho tự đăng ký: người dùng do chủ tạo trong giới hạn gói.
     */
    private SecurityFilterChain desktopFilterChain(HttpSecurity http) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/register").denyAll()
                        .requestMatchers("/api/auth/login", "/api/desktop/setup-status", "/api/desktop/setup",
                                "/actuator/health", "/uploads/**", "/error").permitAll()
                        .requestMatchers(req -> Boolean.TRUE.equals(req.getAttribute(DesktopSessionTokenFilter.WORKER_ATTR))).permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint((req, res, ex) -> {
                    res.setStatus(401);
                    res.setContentType("application/json;charset=UTF-8");
                    res.getWriter().write("{\"error\":\"LOGIN_REQUIRED\",\"message\":\"Vui lòng đăng nhập\"}");
                }))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(new DesktopSessionTokenFilter(LocalServices.SESSION_TOKEN, LocalServices.WORKER_TOKEN),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(List.of("*"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
