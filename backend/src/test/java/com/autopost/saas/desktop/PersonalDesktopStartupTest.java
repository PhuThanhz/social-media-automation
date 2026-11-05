package com.autopost.saas.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:personal_startup;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE,KEY,USER,YEAR,MONTH,DAY,HOUR,MINUTE,SECOND",
        "spring.jpa.hibernate.ddl-auto=create-drop", "desktop.personal=true",
        "WORKER_BASE_URL=http://127.0.0.1:1", "APP_DATA_DIR=target/personal-startup-test",
        "app.jwt-secret=VGhpc0lzQVNlY3JldEtleUZvclBlcnNvbmFsRGVza3RvcFNtb2tlVGVzdGluZzEyMzQ1Njc4OTA="
})
@ActiveProfiles("desktop")
@AutoConfigureMockMvc
@DirtiesContext
class PersonalDesktopStartupTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void createsOwnerAndMemberWithoutActivationWhileKeepingSessionAuthentication() throws Exception {
        String session = System.getenv("DESKTOP_SESSION_TOKEN");
        org.junit.jupiter.api.Assumptions.assumeTrue(session != null, "Run with DESKTOP_SESSION_TOKEN for desktop security");
        mvc.perform(get("/api/desktop/setup-status")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/desktop/setup-status").header("X-Session-Token", session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.needsSetup").value(true))
                .andExpect(jsonPath("$.plan.personal").value(true));
        String result = mvc.perform(post("/api/desktop/setup").header("X-Session-Token", session)
                        .contentType("application/json").content("{\"login\":\"personal-owner\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String jwt = mapper.readTree(result).get("accessToken").asText();
        mvc.perform(get("/api/desktop/me").header("X-Session-Token", session))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/desktop/me").header("X-Session-Token", session).header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("OWNER"))
                .andExpect(jsonPath("$.plan.maxAccounts").value(Integer.MAX_VALUE));
        mvc.perform(post("/api/desktop/users").header("X-Session-Token", session).header("Authorization", "Bearer " + jwt)
                        .contentType("application/json").content("{\"login\":\"personal-member\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
    }
}
