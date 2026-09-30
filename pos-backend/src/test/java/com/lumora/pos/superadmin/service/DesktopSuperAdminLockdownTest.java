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

@DisplayName("Desktop super-admin: only with a password the installer chose")
class DesktopSuperAdminLockdownTest {

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);

    private SuperAdminEntity admin(String password, boolean active) {
        SuperAdminEntity a = new SuperAdminEntity();
        a.setEmail("superadmin@lumora.com");
        a.setActive(active);
        a.setPasswordHash(encoder.encode(password));
        return a;
    }

    @Test
    @DisplayName("An account still on the published default is disabled and scrambled")
    void shouldDisableTheDefault() {
        SuperAdminEntity seeded = admin(DesktopSuperAdminLockdown.PUBLISHED_DEFAULT_PASSWORD, true);
        SuperAdminRepository repo = mock(SuperAdminRepository.class);
        when(repo.findAll()).thenReturn(List.of(seeded));
        DesktopSuperAdminLockdown.State state = new DesktopSuperAdminLockdown.State();

        new DesktopSuperAdminLockdown.Accounts(repo, encoder, state).run(null);

        assertThat(seeded.isActive()).isFalse();
        assertThat(encoder.matches(DesktopSuperAdminLockdown.PUBLISHED_DEFAULT_PASSWORD, seeded.getPasswordHash())).isFalse();
        assertThat(state.isChecked()).isTrue();
    }

    @Test
    @DisplayName("A password the installer chose is left alone")
    void shouldKeepAChosenPassword() {
        SuperAdminEntity chosen = admin("Lumora-support-7731", true);
        String hash = chosen.getPasswordHash();
        SuperAdminRepository repo = mock(SuperAdminRepository.class);
        when(repo.findAll()).thenReturn(List.of(chosen));

        new DesktopSuperAdminLockdown.Accounts(repo, encoder, new DesktopSuperAdminLockdown.State()).run(null);

        assertThat(chosen.isActive()).isTrue();
        assertThat(chosen.getPasswordHash()).isEqualTo(hash);
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("The console is closed until the startup check has run, and while nobody can log in")
    void shouldOpenOnlyWhenCheckedAndActive() throws Exception {
        DesktopSuperAdminLockdown.State state = new DesktopSuperAdminLockdown.State();
        SuperAdminRepository repo = mock(SuperAdminRepository.class);
        DesktopSuperAdminLockdown.Routes filter = new DesktopSuperAdminLockdown.Routes(state, repo);

        when(repo.existsByIsActiveTrue()).thenReturn(true);
        assertThat(status(filter, "/api/v1/super-admin/auth/login")).as("before the check").isEqualTo(404);

        state.markChecked();
        when(repo.existsByIsActiveTrue()).thenReturn(false);
        assertThat(status(filter, "/api/v1/super-admin/auth/login")).as("no super-admin set").isEqualTo(404);

        when(repo.existsByIsActiveTrue()).thenReturn(true);
        assertThat(status(filter, "/api/v1/super-admin/auth/login")).as("set by the installer").isEqualTo(200);
    }

    @Test
    @DisplayName("Other routes are never touched")
    void shouldLeaveOtherRoutesAlone() throws Exception {
        DesktopSuperAdminLockdown.Routes filter =
                new DesktopSuperAdminLockdown.Routes(new DesktopSuperAdminLockdown.State(), mock(SuperAdminRepository.class));
        for (String path : List.of("/api/v1/auth/login", "/api/v1/super-administrators")) {
            MockFilterChain chain = new MockFilterChain();
            filter.doFilter(new MockHttpServletRequest("POST", path), new MockHttpServletResponse(), chain);
            assertThat(chain.getRequest()).as(path).isNotNull();
        }
    }

    private static int status(DesktopSuperAdminLockdown.Routes filter, String path) throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("POST", path), res, new MockFilterChain());
        return res.getStatus();
    }
}
