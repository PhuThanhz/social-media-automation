package com.autopost.saas.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

class DesktopLicenseTest {
    @Test
    void personalEditionWorksWithoutTokenOrServerAndHasNoPlanQuota() {
        DesktopLicense license = new DesktopLicense(new ObjectMapper());
        ReflectionTestUtils.setField(license, "personal", true);
        DesktopLicense.Claims claims = license.current().orElseThrow();
        assertTrue(license.isPersonal());
        assertEquals(Integer.MAX_VALUE, claims.accountLimit());
        assertEquals(Integer.MAX_VALUE, claims.userLimit());
        assertNull(claims.licenseExp());
        assertEquals("PERSONAL", claims.key());
    }

    @Test
    void personalEditionMustBeExplicitlyEnabled() {
        assertFalse(new DesktopLicense(new ObjectMapper()).isPersonal());
    }
}
