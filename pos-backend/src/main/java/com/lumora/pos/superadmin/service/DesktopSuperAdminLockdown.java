package com.lumora.pos.superadmin.service;

import com.lumora.pos.superadmin.entity.SuperAdminEntity;
import com.lumora.pos.superadmin.repository.SuperAdminRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * The super-admin console on a desktop install: only with a password the
 * installer chose, never with the published default.
 *
 * <p>Migrations V25/V38 seed {@code superadmin@lumora.com} with a documented
 * default password — right for the hosted product, where we log in first; wrong
 * on a till, where anyone at the PC could sign in with it, reset the owner's
 * password or suspend the restaurant ("change it on first login" only means
 * whoever gets there first chooses). So on desktop:
 * <ul>
 *   <li>The installer sets the super-admin in the setup wizard
 *       ({@code DesktopBootstrapRunner}), or later with the "Set super-admin
 *       password" tool ({@code SetSuperAdminPassword}), run as a Windows admin.</li>
 *   <li>{@link Accounts}, on every start: any active super-admin whose password
 *       is still the published default is disabled and scrambled.</li>
 *   <li>{@link Routes}: {@code /api/v1/super-admin/**} answers 404 until that
 *       check has run and while no super-admin is active — so the default works
 *       for not one request, and a till with no support login shows no console.</li>
 * </ul>
 */
public final class DesktopSuperAdminLockdown {

    static final String ROUTE_PREFIX = "/api/v1/super-admin";
    /** The account V25 seeds; the wizard and the tool take it over rather than add another. */
    public static final String SEEDED_EMAIL = "superadmin@lumora.com";
    /** Published in V38's comment and the docs — never a working password on a till. */
    public static final String PUBLISHED_DEFAULT_PASSWORD = "SuperAdmin@2024";

    private DesktopSuperAdminLockdown() {
    }

    /** Set once the startup check has run; the console stays closed until then. */
    @Component
    @Profile("desktop")
    public static class State {
        private volatile boolean checked;

        public boolean isChecked() {
            return checked;
        }

        void markChecked() {
            checked = true;
        }
    }

    @Slf4j
    @Component
    @Profile("desktop")
    @Order(100) // after DesktopBootstrapRunner (0), which may have just set a super-admin
    @RequiredArgsConstructor
    public static class Accounts implements ApplicationRunner {

        private final SuperAdminRepository superAdminRepository;
        private final PasswordEncoder passwordEncoder;
        private final State state;

        @Override
        @Transactional
        public void run(ApplicationArguments args) {
            int disabled = 0;
            for (SuperAdminEntity admin : superAdminRepository.findAll()) {
                if (!admin.isActive() || !passwordEncoder.matches(PUBLISHED_DEFAULT_PASSWORD, admin.getPasswordHash())) {
                    continue;
                }
                admin.setActive(false);
                admin.setPasswordHash(passwordEncoder.encode(randomSecret()));
                admin.setPasswordChangeRequired(true);
                superAdminRepository.save(admin);
                disabled++;
            }
            if (disabled > 0) {
                log.warn("Desktop install: disabled {} super-admin account(s) still on the published default "
                        + "password. Set one with Start menu > StoreX Restaurant - Set super-admin password.", disabled);
            }
            state.markChecked();
        }

        private static String randomSecret() {
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            return Base64.getEncoder().encodeToString(bytes);
        }
    }

    @Component
    @Profile("desktop")
    @Order(Ordered.HIGHEST_PRECEDENCE)
    @RequiredArgsConstructor
    public static class Routes extends OncePerRequestFilter {

        private final State state;
        private final SuperAdminRepository superAdminRepository;

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return !(path.equals(ROUTE_PREFIX) || path.startsWith(ROUTE_PREFIX + "/"));
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            if (state.isChecked() && superAdminRepository.existsByIsActiveTrue()) {
                chain.doFilter(request, response);
                return;
            }
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }
}
