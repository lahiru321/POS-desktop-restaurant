import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * First-run tenant seeding. The launcher collects the business name + admin
 * credentials, bcrypt-hashes the password HERE (so plaintext never lands on
 * disk), and writes tenant-seed.json for the backend's DesktopBootstrapRunner
 * to consume once on first boot.
 */

export interface FirstRunInput {
  tenantName: string;
  adminEmail: string;
  adminPassword: string;
  /** The Lumora support (super-admin) login, if the installer set one. */
  superAdminEmail?: string;
  superAdminPassword?: string;
}

/** Must match the path main.ts passes to the backend as APP_TENANT_SEED_FILE. */
export function tenantSeedPath(userDataDir: string): string {
  return join(userDataDir, "config", "tenant-seed.json");
}

/**
 * True when no seed has been written yet. Note: if the DB is later wiped but the
 * seed file remains, the backend re-seeds from it (its tenant-count guard) using
 * the same credentials — so we deliberately do NOT re-prompt in that case.
 */
export function needsFirstRun(userDataDir: string): boolean {
  return !existsSync(tenantSeedPath(userDataDir));
}

export function writeTenantSeed(userDataDir: string, input: FirstRunInput): void {
  const path = tenantSeedPath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });
  const seed = {
    tenantName: input.tenantName.trim(),
    adminEmail: input.adminEmail.trim().toLowerCase(),
    // cost 10 — Spring's BCryptPasswordEncoder verifies the $2a$/$2b$ output.
    adminPasswordBcrypt: bcrypt.hashSync(input.adminPassword, 10),
    // Hashed here too; the backend applies it once, when it provisions the tenant.
    ...(input.superAdminEmail && input.superAdminPassword
      ? {
          superAdminEmail: input.superAdminEmail.trim().toLowerCase(),
          superAdminPasswordBcrypt: bcrypt.hashSync(input.superAdminPassword, 10),
        }
      : {}),
  };
  writeFileSync(path, JSON.stringify(seed, null, 2), { encoding: "utf8" });
}
