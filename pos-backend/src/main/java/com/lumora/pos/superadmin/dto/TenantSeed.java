package com.lumora.pos.superadmin.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * First-run tenant seed written by the Electron desktop launcher to
 * {@code %LOCALAPPDATA%\LumoraPOS\config\tenant-seed.json}. The admin password
 * arrives ALREADY bcrypt-hashed — the launcher hashes it so plaintext never
 * touches disk. Consumed once by {@code DesktopBootstrapRunner} on first boot.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TenantSeed(
        String tenantName,
        String adminEmail,
        String adminPasswordBcrypt,
        /* Lumora support login set by whoever installs the till; both null = none. */
        String superAdminEmail,
        String superAdminPasswordBcrypt
) {}
