# CLAUDE.md

Guidance for Claude Code working in **`D:\Lumora\POS-desktop-restaurant`**.

## What this project is

The **restaurant fork** of Lumora POS (StoreX) — a single-machine **Electron** app that bundles its
own backend, database and web UI into one NSIS installer.

```
lahiru321/POS-desktop-restaurant     ← this repo (fork)
    └── forked from LumoraTechSolution/POS-desktop   ← the retail desktop product
```

At the time of forking the two are **identical**. Everything restaurant-specific — table dining,
kitchen order tickets, per-item toppings — is being added here and is **not** intended to flow back
upstream. Retail behaviour must keep working: the restaurant features sit behind a `RESTAURANT`
feature flag *and* a `restaurantMode` tenant setting, and with both off the terminal must be
byte-for-byte what it was.

The end product is a single installer: `pos-frontend/dist/StoreX-Setup-0.1.0.exe`.

> **The root `D:\Lumora\CLAUDE.md` does not describe this directory.** It documents `POS System/`
> (the old cloud stack) and `NEW POS/` (the greenfield rebuild). Neither applies here. Where they
> disagree about *this* repo, **this file wins**.

### Sibling directories — reference only, never edit from here

| Path | What |
|---|---|
| `D:\Lumora\POS System Desktop` | The local working copy this fork was cloned from. Same content. |
| `D:\Lumora\POS System` | The older cloud-first stack. Different product. |
| `D:\Lumora\NEW POS` | The offline-first greenfield rebuild. Shares no code. |

## Branches

`main` and `development`, both pushed. **Work lands on `development`** — that is what the
`ship-to-dev` skill targets. `main` tracks the fork point plus merges.

## Restaurant work — read before starting

The implementation plan lives at
`C:\Users\User\.claude\plans\user-wants-table-dining-snoopy-spark.md`. Three decisions drive
everything and should not be relitigated without reading it:

1. **An order is its own aggregate (`restaurant_orders`), not a DRAFT `SaleEntity`.**
   `SaleService.createSale` stamps `cashSessionId` from *the creating user's* drawer (L122-125). A tab
   opened by one server and paid to another lands in the wrong drawer and corrupts the Z-report.
   Settle calls `createSale` **unmodified**, so the sale lands on the *paying* cashier — for free.
2. **Toppings are child `sale_items` rows** via a new nullable `parent_item_id` self-FK. Verified:
   every product report already filters `si.productId IS NOT NULL` (`SaleRepository` L64-178), so
   topping rows (which carry a null `product_id`) are excluded automatically — **no report query
   changes**.
3. **Two-level gating.** `RESTAURANT` (feature flag) = the API exists. `restaurantMode` (tenant
   setting in `tenants.settings` JSONB) = this business is a restaurant. Both needed, because the
   desktop installer grants every feature to every install.

### Landmines found during planning

- **`Feature.java` is decorative — nothing reads it.** The real enforcement is
  `FeatureGuardInterceptor.FEATURE_ROUTES` plus `SuperAdminTenantService.provisionFromSeed`.
  `STORE_CREDIT` is enforced without being in the enum. Adding `RESTAURANT` to the enum alone does
  nothing.
- **CSP `connect-src` omits QZ Tray's WebSocket.** `src/middleware.ts` L46 is
  `connect-src 'self' ${apiUrl}`, and CSP `connect-src` governs WebSocket. QZ connects to
  `ws://localhost:8181` / `wss://localhost:8182`. Kitchen printing cannot work until this is widened
  — and receipt QZ printing may already be silently broken in the packaged app for the same reason.
- **`processHardwareCheckoutActions` swallows QZ errors and falls back to browser print** — which
  `electron/main.ts:274-277` makes impossible (it denies `window.open`). A kitchen print must
  **never** do this; a swallowed failure means the kitchen never got the order.
- **`ProductEntity.stockQuantity` is a `@Formula`** summing `stock_levels`, so a non-stock-tracked
  product reports `0` and both `ProductGrid` and `useCart.addToCart` refuse to add it. Client guards
  must key off `trackStock`, never off the number.
- **`ReturnService.restoreStock` throws on a null `productId`** — a pre-existing bug for V49 custom
  lines that toppings make reachable.
- **The tax chain is implemented twice** — backend `TaxRateService` + `SaleService` L283-297, and
  frontend `getProductTaxRate` + the `taxInfo` memo in `useCart.ts` L26-43 / L167-218. Change both in
  the same commit or the cart total and the server total silently disagree. The backend rounds **per
  `sale_items` row**; a topping is its own row, so the client must round per sub-line too.
- **`PUT /tenant/info` is a full replace.** Any new settings-tab save handler must re-send the
  business fields, as `handleSaveLoyalty` does (`settings/page.tsx` L163-173).
- **`CartSummary`'s "Hold Sale" button is wired to `onHold={() => {}}`** — a live dead control, and
  `F5` already routes to it. `F11` is unused.

## Layout

```
POS-desktop-restaurant/
  pos-backend/      Spring Boot 3.3.7 / Java 17 / Maven / Postgres / Flyway
  pos-frontend/     Next.js 14.2.35 / React 18 / TS strict / Tailwind + Electron launcher (electron/)
  lumora_pos/       Umbrella docs only (its CLAUDE.md has the SaaS architecture/conventions)
```

Desktop-specific code:
- `pos-frontend/electron/` — the launcher (`main.ts`), activation/first-run windows, license
  verify/crypto, IPC.
- `pos-backend/.../licensing/` — desktop-side license **verification** only (`LicenseGuard`,
  `LicenseVerifier`, `MachineFingerprint`, `LicenseProperties`). Issuance was removed from this build.
- `pos-backend/.../superadmin/DesktopBootstrapRunner.java` — first-run tenant seeding
  (`@Profile("desktop")`).

## Desktop runtime model

`npm run electron:build` produces the installer. At runtime `electron/main.ts` does, in order:
1. **Activation gate** (`ensureActivated`) — no valid sealed license on this machine → show the
   activation window; the key is redeemed against the cloud License Server.
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
| Next.js window/frontend | **47816** | Moved off 3000 because a separate local License Server (Next.js) on 3000 collided with — and was loaded instead of — the POS. Not baked anywhere, so it's free to move. |
| Postgres | 5433 | Windows service |
| Dev (`isDev`) | backend 8081, frontend 3000 | so `npm run electron:dev` matches `next dev` |

`main.ts` runs `assertPortAvailable()` before each spawn, so a busy port fails loudly with a dialog
instead of silently attaching to a foreign server. CORS `ALLOWED_ORIGINS` and the middleware CSP
`connect-src` are derived from these ports at runtime — keep them consistent.

Runtime logs: `%APPDATA%/frontend/logs/lumora-<date>.log` (the Electron `app.getName()` is `frontend`).

## Commands

Backend (`cd pos-backend`):
```powershell
./mvnw -o compile                      # quick compile check
./mvnw -o clean package -DskipTests    # build target/pos-backend-0.0.1-SNAPSHOT.jar
./mvnw -o clean verify                 # what CI runs
```

Frontend (`cd pos-frontend`):
```powershell
npm install
npm run typecheck     # CI-gated — never @ts-ignore to ship
npm run lint          # CI-gated
npm test              # Vitest, CI-gated
npm run build         # CI-gated — Next.js standalone output
npm run electron:dev  # backend 8081, frontend 3000
npm run electron:build  # next build + electron:tsc + electron-builder, full installer
```

CI gates, in order: frontend `typecheck → lint → test → build`; backend a duplicate-Flyway-version
check, then `./mvnw -B clean verify`.

### Migration drift — the check the test suite cannot give you

`src/test/resources/application-test.yml` uses H2 with `ddl-auto: create-drop` and
**`flyway.enabled: false`**, so **no migration is ever exercised by `mvn verify`** and entity/DDL
drift is invisible until a real install runs. After adding any migration, boot once against the real
desktop Postgres with validation on — Flyway builds the schema, then Hibernate refuses to start on
any mismatch:

```powershell
./mvnw -o spring-boot:run -Dspring-boot.run.profiles=prod,desktop -Dspring-boot.run.jvmArguments="-Dspring.jpa.hibernate.ddl-auto=validate"
```

### Staging the installer

```powershell
powershell -ExecutionPolicy Bypass -File .\build-installer.ps1
```

Builds the jar → stages `resources/backend`, `next build` → stages `resources/web`, `electron:tsc`,
then `electron-builder`. (The known `mvnw.cmd` failure on paths containing **parentheses** does not
apply here — this path is clean.)

Manual equivalent, when you need the steps individually:
```bash
cp ../pos-backend/target/pos-backend-0.0.1-SNAPSHOT.jar pos-frontend/resources/backend/pos-backend.jar
rm -rf pos-frontend/resources/web
cp -r pos-frontend/.next/standalone pos-frontend/resources/web
mkdir -p pos-frontend/resources/web/.next/static && cp -r pos-frontend/.next/static/. pos-frontend/resources/web/.next/static/
cp -r pos-frontend/public pos-frontend/resources/web/public
cd pos-frontend && npx electron-builder --win nsis --x64
```

> ⚠️ **`pos-frontend/resources/` is gitignored and not in this repo.** `jre` (Temurin 17, 53 MB) and
> `postgres-bin` (98 MB) were copied in by hand from `D:\Lumora\POS System Desktop`. **A fresh clone
> will not have them** and `electron-builder` will fail — copy both across before building an
> installer. `backend/` and `web/` are regenerated by the script.

Reinstalling does **not** touch `%APPDATA%/frontend` or `%LOCALAPPDATA%/LumoraPOS` — sealed license,
tenant-seed and logs persist across installs, so installing over an existing install is the real
upgrade path and the only place migration backfills get exercised.

## Licensing & activation

Issuance lives in a **separate Next.js app**: `D:\Lumora\Lumora License service` (deployed at
`https://lumora-k-ten.vercel.app`, console at `/super-admin/licenses`). This build only **verifies**.

- Activation contract is flat JSON, **not** the `{success,message,data}` envelope: success
  `{license, edition, customerName, expiresAt}`, failure `{error}`. Parser:
  `electron/services/license.ts`.
- `ACTIVATION_URL` default in `main.ts` = `https://lumora-k-ten.vercel.app` (override
  `LUMORA_ACTIVATION_URL`).
- **Ed25519**: the PUBLIC key is baked into `electron/keys/license-public-key.ts` **and**
  `pos-backend/.../application-desktop.yml` (`app.license.signing.public-key`). Both verify the token
  the cloud signs with the matching PRIVATE key. Do **not** remove either.
- Tokens are EdDSA compact JWS; claims `{iss,iat,kid,fp,customer,edition,features,machine,exp}`. The
  Electron verifier (`license-crypto.ts`) and the Spring `LicenseGuard` verify the SAME token.
- The sealed license is DPAPI-stored at `%LOCALAPPDATA%/LumoraPOS/config/license.lic`, machine-locked
  to `sha256("guid:"+MachineGuid)`. Delete it to force the activation screen again.

> **`license-signing-key.PRIVATE.txt` is not in this repo and must never be added.** It is the
> issuing secret and belongs only on the license server. It is gitignored; keep it that way.

### Credentials (desktop DB)
- **Super-admin** (Flyway V25/V38 default): `superadmin@lumora.com` / `SuperAdmin@2024` — single-use,
  forces a change.
- Normal entry is the **tenant login** created in the first-run wizard.

## Flyway version reservation

Migrations live in `pos-backend/src/main/resources/db/migration/`. Reserve the next `V<n>__` number
before writing one — **backend CI hard-fails on duplicates**.

**Highest on disk is `V61__sale_item_toppings.sql`.** The restaurant work reserves **V59–V64**.
V59–V61 are written; the numbering below is what is actually on disk, which is *not* the order the
plan first reserved — toppings landed before tables, so take the table here over the plan's:

| Version | Purpose | State |
|---|---|---|
| `V59` | `products.track_stock` | on disk |
| `V60` | `topping_groups`, `toppings`, `product_topping_groups` | on disk |
| `V61` | `sale_items.parent_item_id` (self-FK, **`DEFERRABLE INITIALLY DEFERRED`**), `topping_id`, `sort_order`, `notes` | on disk |
| `V62` | `restaurant_areas`, `restaurant_tables`, `RESTAURANT` feature backfill | reserved |
| `V63` | `restaurant_orders`, `restaurant_order_items`, `restaurant_order_counters` | reserved |
| `V64` | `kitchen_tickets`, `kitchen_ticket_items`, `kitchen_station` columns | reserved |

The self-FK **must** be deferrable: parent and child are both elements of the same cascaded
`SaleEntity.items` collection, and Hibernate makes no guarantee about insert order within one entity
type.

`V55__license_keys.sql` is intentionally kept even though issuance was removed — it creates an unused
table, and deleting it would break Flyway validation on already-provisioned desktop DBs.

House style (from `V56__loyalty_ledger.sql`): `id UUID PRIMARY KEY` with **no DB default** (Hibernate
generates via `@GeneratedValue(GenerationType.UUID)`), `tenant_id UUID NOT NULL` with no FK on newer
tables, the audit block (`created_at/updated_at/created_by/updated_by/version`), money
`NUMERIC(12,2)`, enums as `VARCHAR(20)` with a comment listing the values (never a Postgres ENUM
type), indexes `idx_<abbrev>_<cols>` leading with `tenant_id`, and a prose `--` header explaining
*why*. Never edit an applied migration — fix forward.

## Conventions that bite

- **There is no automatic tenant scoping.** `TenantContext` is a plain `ThreadLocal` set by
  `JwtAuthenticationFilter`; `BaseEntity`'s javadoc claims queries are auto-scoped and is **wrong**.
  Every repository method must take and filter on `tenantId`, and every service must call
  `setTenantId(TenantContext.getTenantId())` before save.
- **Pricing is server-authoritative.** Catalogue lines force `unitPrice = product.getBasePrice()` and
  ignore the request (`SaleService` L206-210, 259). Custom lines (`productId == null` + `itemName`)
  accept a typed price. Do not widen this; the topping "typed price" exemption is keyed on a
  server-side `price_mode` column, not on a client claim.
- **Auth is role-based via `@PreAuthorize`.** `PermissionEntity` exists and is granted as authorities
  but **no controller checks permissions**.
- All responses use the `ApiResponse<T>` `{success, message, data, timestamp}` envelope.
- Frontend services are flat exported objects in `<domain>Service.ts` that unwrap
  `.then(res => res.data.data)`, with request/response interfaces co-located. Query keys go in
  `src/lib/queryKeys.ts`.
- **There is no realtime transport anywhere** — no WebSocket, SSE or STOMP on either side. The
  established freshness pattern is TanStack Query `refetchInterval`.

## Where else to look

- `lumora_pos/CLAUDE.md` — SaaS architecture, multi-tenancy, auth, money-path invariants.
- `AGENTS.md` — the same guidance for other agents; keep the two in step.
- `C:\Users\User\.claude\plans\user-wants-table-dining-snoopy-spark.md` — the restaurant plan.

## Don't touch

- `license-signing-key.PRIVATE.txt` — never add it to this repo.
- `hs_err_pid*.log` / `replay_pid*.log` — JVM crash dumps, not source.
- The sibling directories listed at the top — reference only.
