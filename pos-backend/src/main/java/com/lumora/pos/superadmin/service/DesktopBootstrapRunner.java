package com.lumora.pos.superadmin.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lumora.pos.superadmin.dto.TenantSeed;
import com.lumora.pos.superadmin.entity.SuperAdminEntity;
import com.lumora.pos.superadmin.repository.SuperAdminRepository;
import com.lumora.pos.superadmin.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Desktop-only first-run seeding. On the very first boot of a fresh install the
 * Electron launcher has written {@code tenant-seed.json} (path injected via
 * {@code APP_TENANT_SEED_FILE}); this runner reads it and provisions the single
 * local tenant + admin. It is a no-op on every subsequent boot — the tenant-count
 * guard makes it safe to run unconditionally and idempotently.
 */
@Slf4j
@Component
@Profile("desktop")
@Order(0) // before DesktopSuperAdminLockdown.Accounts, which checks what this set
@RequiredArgsConstructor
public class DesktopBootstrapRunner implements ApplicationRunner {

    private final TenantRepository tenantRepository;
    private final SuperAdminRepository superAdminRepository;
    private final SuperAdminTenantService tenantService;
    private final ObjectMapper objectMapper;

    @Value("${app.tenant-seed-file:}")
    private String seedFilePath;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (seedFilePath == null || seedFilePath.isBlank()) {
            log.info("Desktop bootstrap: no tenant-seed file configured; skipping.");
            return;
        }
        // NOT count()>0: V1 always seeds the "Demo Business" tenant, so the table is
        // never empty. Guard on our own LOCAL tenant instead.
        if (tenantRepository.existsByDomain("LOCAL")) {
            return; // already provisioned on a previous run
        }
        Path path = Path.of(seedFilePath);
        if (!Files.exists(path)) {
            log.warn("Desktop bootstrap: no tenant exists yet but seed file {} is missing.", seedFilePath);
            return;
        }

        TenantSeed seed = objectMapper.readValue(path.toFile(), TenantSeed.class);
        if (seed.tenantName() == null || seed.adminEmail() == null || seed.adminPasswordBcrypt() == null) {
            log.error("Desktop bootstrap: seed file is missing required fields; skipping.");
            return;
        }

        tenantService.provisionFromSeed(seed);
        log.info("Desktop bootstrap: seeded tenant '{}'.", seed.tenantName());
        applySuperAdmin(seed);
    }

    /**
     * The Lumora support login the installer chose in the setup wizard. Replaces
     * the migration-seeded account (and its published default password) rather
     * than adding a second one. Already hashed by the wizard; active at once, with
     * no forced change — the person who set it just chose it.
     */
    private void applySuperAdmin(TenantSeed seed) {
        String email = seed.superAdminEmail() == null ? "" : seed.superAdminEmail().trim().toLowerCase();
        String hash = seed.superAdminPasswordBcrypt();
        if (email.isEmpty() || hash == null || hash.isBlank()) {
            log.info("Desktop bootstrap: no super-admin chosen at setup; the console stays closed.");
            return;
        }
        SuperAdminEntity admin = superAdminRepository.findByEmail(email)
                .or(() -> superAdminRepository.findByEmail(DesktopSuperAdminLockdown.SEEDED_EMAIL))
                .orElseGet(() -> {
                    SuperAdminEntity created = new SuperAdminEntity();
                    created.setFirstName("Lumora");
                    created.setLastName("Support");
                    return created;
                });
        admin.setEmail(email);
        admin.setPasswordHash(hash);
        admin.setActive(true);
        admin.setPasswordChangeRequired(false);
        admin.setFailedLoginAttempts(0);
        admin.setLockedUntil(null);
        superAdminRepository.save(admin);
        log.info("Desktop bootstrap: super-admin '{}' set from setup.", email);
    }
}
