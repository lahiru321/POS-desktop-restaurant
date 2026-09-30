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
 * The super-admin console does not exist on a desktop install.
 *
 * <p>It is the hosted product's control panel — create tenants, reset any
 * user's password, suspend a business. Migrations V25/V38 seed its account with
 * a documented default password, which is fine on a server we run and a hole on
 * a till: anyone at the PC could open the login page in a browser, sign in first,
 * reset the owner's password and suspend the restaurant. A desktop install needs
 * none of it (first-run provisioning calls the service directly, not the API).
 *
 * <p>So, desktop profile only, two independent locks:
 * <ul>
 *   <li>{@link Accounts} — on every start, any active super-admin is deactivated
 *       and its password replaced with random bytes nobody knows. Idempotent, and
 *       it fixes installs that shipped before this existed on their next launch.</li>
 *   <li>{@link Routes} — every {@code /api/v1/super-admin/**} request is answered
 *       404 before authentication runs, so re-enabling a row in the database still
 *       opens nothing.</li>
 * </ul>
 */
public final class DesktopSuperAdminLockdown {

    static final String ROUTE_PREFIX = "/api/v1/super-admin";

    private DesktopSuperAdminLockdown() {
    }

    @Slf4j
    @Component
    @Profile("desktop")
    @RequiredArgsConstructor
    public static class Accounts implements ApplicationRunner {

        private final SuperAdminRepository superAdminRepository;
        private final PasswordEncoder passwordEncoder;

        @Override
        @Transactional
        public void run(ApplicationArguments args) {
            int locked = 0;
            for (SuperAdminEntity admin : superAdminRepository.findAll()) {
                if (!admin.isActive()) {
                    continue;
                }
                admin.setActive(false);
                admin.setPasswordHash(passwordEncoder.encode(randomSecret()));
                admin.setPasswordChangeRequired(true);
                superAdminRepository.save(admin);
                locked++;
            }
            if (locked > 0) {
                log.warn("Desktop install: disabled {} super-admin account(s); the super-admin console is not "
                        + "available on a till.", locked);
            }
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
    public static class Routes extends OncePerRequestFilter {

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return !(path.equals(ROUTE_PREFIX) || path.startsWith(ROUTE_PREFIX + "/"));
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }
}
