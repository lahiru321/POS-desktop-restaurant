package com.lumora.pos.superadmin.service;

import com.lumora.pos.superadmin.entity.SuperAdminEntity;
import com.lumora.pos.superadmin.repository.SuperAdminRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@DisplayName("Desktop super-admin lockdown")
class DesktopSuperAdminLockdownTest {

    @Test
    @DisplayName("Disables every active super-admin and makes the default password useless")
    void shouldDisableAndScrambleActiveAccounts() {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
        SuperAdminEntity seeded = new SuperAdminEntity();
        seeded.setEmail("superadmin@lumora.com");
        seeded.setActive(true);
        seeded.setPasswordHash(encoder.encode("SuperAdmin@2024"));
        SuperAdminEntity alreadyOff = new SuperAdminEntity();
        alreadyOff.setActive(false);
        alreadyOff.setPasswordHash("untouched");
        SuperAdminRepository repo = mock(SuperAdminRepository.class);
        when(repo.findAll()).thenReturn(List.of(seeded, alreadyOff));

        new DesktopSuperAdminLockdown.Accounts(repo, encoder).run(null);

        assertThat(seeded.isActive()).isFalse();
        assertThat(encoder.matches("SuperAdmin@2024", seeded.getPasswordHash())).isFalse();
        assertThat(seeded.isPasswordChangeRequired()).isTrue();
        assertThat(alreadyOff.getPasswordHash()).isEqualTo("untouched");
        verify(repo, times(1)).save(any());
    }

    @Test
    @DisplayName("Answers 404 for every super-admin route, login included, and leaves the rest alone")
    void shouldCloseOnlySuperAdminRoutes() throws Exception {
        DesktopSuperAdminLockdown.Routes filter = new DesktopSuperAdminLockdown.Routes();

        for (String path : List.of("/api/v1/super-admin/auth/login", "/api/v1/super-admin/tenants/x/suspend",
                "/api/v1/super-admin")) {
            MockHttpServletResponse res = new MockHttpServletResponse();
            MockFilterChain chain = new MockFilterChain();
            filter.doFilter(new MockHttpServletRequest("POST", path), res, chain);
            assertThat(res.getStatus()).as(path).isEqualTo(404);
            assertThat(chain.getRequest()).as(path + " never reaches the app").isNull();
        }

        for (String path : List.of("/api/v1/auth/login", "/api/v1/super-administrators")) {
            MockFilterChain chain = new MockFilterChain();
            filter.doFilter(new MockHttpServletRequest("POST", path), new MockHttpServletResponse(), chain);
            assertThat(chain.getRequest()).as(path + " passes through").isNotNull();
        }
    }
}
