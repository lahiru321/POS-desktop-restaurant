import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import os from "os";

import { computeFingerprint } from "./fingerprint";
import { verifyLicenseToken, type LicenseClaims } from "./license-crypto";
import { EMBEDDED_PUBLIC_KEY, isPublicKeyConfigured } from "../keys/license-public-key";

/**
 * Desktop license lifecycle: online one-time activation, DPAPI-sealed storage,
 * and offline verification on every launch. The sealed token is node-locked — it
 * only verifies on the machine whose fingerprint it was signed for.
 */

export interface RuntimeLicenseInfo {
  customer: string;
  edition: string;
  features: string[];
  /** ISO-8601 expiry, or null for perpetual. */
  expiresAt: string | null;
}

export type VerifyFailureReason =
  | "NOT_ACTIVATED"
  | "SEAL_UNREADABLE"
  | "SIGNATURE_INVALID"
  | "MACHINE_MISMATCH"
  | "EXPIRED";

export type VerifyResult =
  | { ok: true; token: string; info: RuntimeLicenseInfo }
  | { ok: false; reason: VerifyFailureReason };

/**
 * %LOCALAPPDATA%\StoreXRestaurant\config\license.lic — matches the desktop build
 * layout. Deliberately NOT retail StoreX's LumoraPOS folder: this is a separate
 * product with its own licence, so the two must never seal over each other.
 */
export function licenseFilePath(): string {
  const base = process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local");
  return join(base, "StoreXRestaurant", "config", "license.lic");
}

function toRuntimeInfo(claims: LicenseClaims): RuntimeLicenseInfo {
  return {
    customer: claims.customer,
    edition: claims.edition,
    features: claims.features ? claims.features.split(",").filter(Boolean) : [],
    expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
  };
}

function writeSealedLicense(token: string): void {
  const path = licenseFilePath();
  mkdirSync(dirname(path), { recursive: true });
  // safeStorage uses DPAPI on Windows, tying the blob to this OS user/machine.
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, "utf8"); // still signature-protected + fingerprint-locked
  writeFileSync(path, data);
}

function readSealedLicense(): string {
  const raw = readFileSync(licenseFilePath());
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(raw);
  }
  return raw.toString("utf8");
}

/**
 * Verify the locally-stored license. Pure/offline — no network. Run this before
 * spawning the backend/frontend; block the app on any non-ok result.
 */
export function verifyLocalLicense(): VerifyResult {
  if (!isPublicKeyConfigured()) {
    // Misconfigured build — fail closed rather than accept unverifiable licenses.
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }
  if (!existsSync(licenseFilePath())) {
    return { ok: false, reason: "NOT_ACTIVATED" };
  }

  let token: string;
  try {
    token = readSealedLicense();
  } catch {
    return { ok: false, reason: "SEAL_UNREADABLE" };
  }

  let claims: LicenseClaims;
  try {
    claims = verifyLicenseToken(token, EMBEDDED_PUBLIC_KEY);
  } catch {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  if (claims.fp !== computeFingerprint()) {
    return { ok: false, reason: "MACHINE_MISMATCH" };
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, token, info: toRuntimeInfo(claims) };
}

/** Default friendly machine label sent to the cloud for the admin console. */
export function defaultMachineName(): string {
  return os.hostname();
}

/**
 * The cloud License Server's activation contract is a FLAT JSON body (not the
 * {success,message,data} envelope the old local Spring issuer used):
 *   success → { license (JWS), edition, customerName, expiresAt }
 *   failure → { error: "<message>" } with a non-2xx status
 */
interface ActivateResponseBody {
  license?: string;
  edition?: string;
  customerName?: string;
  expiresAt?: string | null;
  error?: string;
}

/**
 * Online one-time activation. Redeems the key against the cloud, verifies the
 * returned token with our embedded key, then seals it locally. Throws with a
 * user-facing message on any failure (bad key, already activated elsewhere, etc.).
 */
export async function activate(params: {
  apiBaseUrl: string;
  key: string;
  machineName?: string;
}): Promise<RuntimeLicenseInfo> {
  if (!isPublicKeyConfigured()) {
    throw new Error("This build is missing its license verification key. Contact StoreX Restaurant support.");
  }

  const fingerprint = computeFingerprint();
  const url = `${params.apiBaseUrl.replace(/\/+$/, "")}/api/v1/activation/activate`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: params.key.trim(),
        fingerprint,
        machineName: params.machineName ?? defaultMachineName(),
      }),
    });
  } catch {
    throw new Error("Couldn't reach the activation server. Check your internet connection and try again.");
  }

  const body = (await res.json().catch(() => ({}))) as ActivateResponseBody;
  if (!res.ok || !body.license) {
    throw new Error(body.error || `Activation failed (HTTP ${res.status}).`);
  }

  const token = body.license;
  // Verify before trusting/sealing — proves our embedded key matches the signer
  // and that the token is bound to THIS machine.
  let claims: LicenseClaims;
  try {
    claims = verifyLicenseToken(token, EMBEDDED_PUBLIC_KEY);
  } catch {
    throw new Error("The activation server returned a license this app can't verify. Contact StoreX Restaurant support.");
  }
  if (claims.fp !== fingerprint) {
    throw new Error("Activation returned a license bound to a different machine. Please try again.");
  }

  writeSealedLicense(token);
  return toRuntimeInfo(claims);
}
