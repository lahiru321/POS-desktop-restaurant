# AGENTS.md

Guidance for Codex when working in **`D:\Lumora\POS SYSTEM DESKTOP`** (formerly
`POS System - Copy (3)` — rename pending; build paths are all relative so the rename is safe).

## What this project is

This directory is the **active Windows desktop application build** of Lumora POS (StoreX) —
a single-machine **Electron** app that bundles its own backend, database, and web UI into one
NSIS installer. It is **not** a backup. (The root `D:\Lumora\AGENTS.md` describes the canonical
cloud/SaaS tree under `D:\Lumora\POS System\` and predates this desktop variant; where they
disagree about *this* directory, **this file wins**.)

The end product is a single installer: `pos-frontend/dist/StoreX-Setup-0.1.0.exe`.

## Layout

```
POS System - Copy (3)/
  pos-backend/      Spring Boot 3.3.7 / Java 17 / Maven / Postgres / Flyway
  pos-frontend/     Next.js 14.2.35 / React 18 / TS strict / Tailwind  + Electron launcher (electron/)
  lumora_pos/       Umbrella docs only here (its AGENTS.md has the SaaS architecture/conventions)
  license-signing-key.PRIVATE.txt   Ed25519 PRIVATE key — belongs ONLY on the license server, never bundled
```

The desktop-specific code lives in:
- `pos-frontend/electron/` — the launcher (`main.ts`), activation/first-run windows, license verify/crypto, IPC.
- `pos-backend/.../licensing/` — desktop-side license **verification** only (`LicenseGuard`, `LicenseVerifier`,
  `MachineFingerprint`, `LicenseProperties`). Key **issuance was removed** from this build (see Licensing).
- `pos-backend/.../superadmin/DesktopBootstrapRunner.java` — first-run tenant seeding (`@Profile("desktop")`).

## Desktop runtime model

`npm run electron:build` produces the installer. At runtime `electron/main.ts` does, in order:
1. **Activation gate** (`ensureActivated`) — if no valid sealed license on this machine, show the
   activation window; the key is redeemed against the cloud License Server (see below).
2. **First-run wizard** (once per machine) — collects business + admin creds, bcrypt-hashes the
   password, writes `%APPDATA%/frontend/config/tenant-seed.json` for `DesktopBootstrapRunner`.
3. **Spawn the Spring backend** (bundled JRE + `pos-backend.jar`) with profile `prod,desktop`.
4. **Spawn the Next.js standalone server** (`resources/web/server.js`).
5. **Open the Chromium window** at the local frontend.

Postgres runs separately as a **Windows service `LumoraPOSPostgres` on port 5433**, installed by the
NSIS `build/install-postgres.ps1`, which writes creds + a generated `jwtSecret` to
`%ProgramData%\Lumora POS\db.properties`. `main.ts` reads that file. The bundled postgres-bin is
**server-only (no psql.exe)** and the app uses the always-present `postgres` database; Flyway builds
the schema (V1 creates the `uuid-ossp` extension itself).

### Ports — DO NOT change without reading this

| Component | Port (packaged) | Why |
|---|---|---|
| Spring backend (loopback `127.0.0.1`) | **8081** | The web client bakes its target at BUILD time from `pos-frontend/.env` (`NEXT_PUBLIC_API_URL=http://localhost:8081`; `services/api.ts` + `superAdminApi.ts` default to 8081). **Moving the backend off 8081 breaks every client→backend call with a "network error."** |
| Next.js window/frontend | **47816** | Moved off the conventional 3000 because a separate local License Server (Next.js) on 3000 collided with — and was loaded instead of — the POS. The frontend port is NOT baked anywhere, so it's free to move. |
| Postgres | 5433 | Windows service |
| Dev (`isDev`) | backend 8081, frontend 3000 | so `npm run electron:dev` matches `next dev` |

`main.ts` runs `assertPortAvailable()` before each spawn, so a busy port fails loudly with a dialog
instead of silently attaching to a foreign server. CORS `ALLOWED_ORIGINS` and the middleware CSP
`connect-src` are derived from these ports at runtime — keep them consistent if you ever change them.

Runtime logs: `%APPDATA%/frontend/logs/lumora-<date>.log` (the Electron `app.getName()` is `frontend`).

## Commands

Backend (`cd pos-backend`):
```powershell
./mvnw -o compile                 # quick compile check
./mvnw -o clean package -DskipTests   # build pos-backend.jar (target/pos-backend-0.0.1-SNAPSHOT.jar)
```

Frontend (`cd pos-frontend`):
```powershell
npm run typecheck     # CI-gated — never @ts-ignore to ship
npm run build         # Next.js standalone output (output: 'standalone')
npm run electron:tsc  # compile electron/ TS + copy activation.html/first-run.html (CSP) into dist-electron/
npm run electron:build  # next build + electron:tsc + electron-builder (full installer in one shot)
```

### Staging the installer

The one-shot script `build-installer.ps1` (repo root) does the whole pipeline — build jar → stage
`resources/backend`, `next build` → stage `resources/web`, `electron:tsc`, then `electron-builder`:
```powershell
powershell -ExecutionPolicy Bypass -File .\build-installer.ps1
```
> ⚠ The script's `mvnw.cmd` step fails if the project path contains **parentheses** (the current
> `...Copy (3)` breaks the cmd batch wrapper with `"}" was unexpected`). It works once the folder is
> renamed to `POS SYSTEM DESKTOP`. Until then, use the bash pipeline below (bash `mvnw` is unaffected).

`extraResources` in `pos-frontend/package.json` pulls from `resources/`, which the script populates
(it's not committed). The manual equivalent, when you need to run steps individually:
```bash
# backend jar
cp ../pos-backend/target/pos-backend-0.0.1-SNAPSHOT.jar pos-frontend/resources/backend/pos-backend.jar
# web bundle (Next standalone omits static + public — copy them in)
rm -rf pos-frontend/resources/web
cp -r pos-frontend/.next/standalone pos-frontend/resources/web
mkdir -p pos-frontend/resources/web/.next/static && cp -r pos-frontend/.next/static/. pos-frontend/resources/web/.next/static/
cp -r pos-frontend/public pos-frontend/resources/web/public
# then package
cd pos-frontend && npx electron-builder --win nsis --x64
```
The JRE (Temurin 17) and `postgres-bin` under `resources/` are reused as-is (no download needed).
Reinstalling does **not** touch `%APPDATA%/frontend` or `%LOCALAPPDATA%/LumoraPOS` — sealed license,
tenant-seed, and logs persist across installs.

## Licensing & activation

Issuance/key-generation is a **separate Next.js app**: `D:\Lumora\Lumora License service`
(deployed at `https://lumora-k-ten.vercel.app`, super-admin console at `/super-admin/licenses`).
This desktop build only **verifies** licenses — the issuing/super-admin-license code was deleted here.

- Activation endpoint contract (flat JSON, NOT a `{success,message,data}` envelope):
  success `{license, edition, customerName, expiresAt}`; failure `{error}`. The client parser in
  `electron/services/license.ts` matches this.
- `ACTIVATION_URL` default in `main.ts` = `https://lumora-k-ten.vercel.app` (override `LUMORA_ACTIVATION_URL`).
- **Ed25519** keypair: the PUBLIC key is baked into `electron/keys/license-public-key.ts` **and**
  `pos-backend/.../application-desktop.yml` (`app.license.signing.public-key`) — both verify the token
  the cloud signs with the matching PRIVATE key. `LicenseVerifier` reads that public key; do NOT remove it.
- Tokens are EdDSA compact JWS; claims `{iss,iat,kid,fp,customer,edition,features,machine,exp}`. The
  Electron verifier (`license-crypto.ts`) and the Spring `LicenseGuard` both verify the SAME token.
- The sealed license is DPAPI-stored at `%LOCALAPPDATA%/LumoraPOS/config/license.lic` and is
  machine-locked to `sha256("guid:"+MachineGuid)`. Delete it to force the activation screen again.

### Credentials (desktop DB)
- **Super-admin** (Flyway V25/V38 default): `superadmin@lumora.com` / `SuperAdmin@2024` (single-use → forces change).
  Note: `LumoraAdmin@2026` belonged to a *separate local-test DB*, not this one.
- The desktop's normal entry is the **tenant login** (the account created in the first-run wizard).

## Flyway version reservation

Before adding a migration in `pos-backend/src/main/resources/db/migration/`, reserve the next
`V<n>__` number — duplicates fail the build. **Highest on disk is `V57`** (`V57__sales_tax_inclusive.sql`,
ported from the SaaS tree where it was `V56`, renumbered here because desktop already had `V56__loyalty_ledger.sql`).
(`V55__license_keys.sql`
is intentionally kept even though issuance was removed — it just creates an unused table; removing it
would break Flyway validation on already-provisioned desktop DBs.)

## Where else to look

- `lumora_pos/AGENTS.md` — SaaS architecture, multi-tenancy, auth, money-path invariants, conventions.
- `D:\Lumora\AGENTS.md` — on-disk layout of the canonical tree (treats this dir as a backup; outdated for desktop).
- Auto-memory `desktop-build-target.md` — running log of desktop build state, fixes, and gotchas.

## Don't touch
- `license-signing-key.PRIVATE.txt` — the issuing secret; never bundle it into the app.
- `hs_err_pid*.log` / `replay_pid*.log` — JVM crash dumps, not source.
