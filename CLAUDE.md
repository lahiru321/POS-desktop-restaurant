# CLAUDE.md

Guidance for Claude Code working in **`D:\Lumora\POS-desktop-restaurant`**.

## What this project is

The **restaurant fork** of Lumora POS (StoreX) — a single-machine **Electron** app bundling its own backend,
database and web UI into one NSIS installer (`pos-frontend/dist/StoreX-Restaurant-Setup-0.1.0.exe`). Forked from
`LumoraTechSolution/POS-desktop` (the retail product) and identical to it at the fork point. Table dining,
kitchen tickets and per-item toppings are added **here only** and never flow back upstream. It ships as its own
product — appId `com.lumora.restaurant`, **StoreX Restaurant**, with its own install dir, service, data dir,
licence store and ports — so it sits beside retail StoreX. Retail behaviour must keep working: restaurant
features sit behind a `RESTAURANT` flag *and* a `restaurantMode` tenant setting; with both off, byte-for-byte.

> **The root `D:\Lumora\CLAUDE.md` does not describe this directory.** It documents `POS System/` (the old
> cloud stack) and `NEW POS/` (the greenfield rebuild); where they disagree about *this* repo, this file wins.
> Siblings `POS System Desktop` (the working copy this was cloned from), `POS System` and `NEW POS` are
> **reference only — never edit them from here**.

**Branches:** `main` and `development`, both pushed. **Work lands on `development`** — what the
`ship-to-dev` skill targets. `main` tracks the fork point plus merges.

## Restaurant work — read before starting

Plan: `C:\Users\User\.claude\plans\user-wants-table-dining-snoopy-spark.md`. Three decisions drive
everything and should not be relitigated without reading it:

1. **An order is its own aggregate (`restaurant_orders`), not a DRAFT `SaleEntity`.** `createSale` stamps
   `cashSessionId` from *the creating user's* drawer (`SaleService` L122-125), so a tab opened by one server
   and paid to another would corrupt the Z-report. Settle calls `createSale` **unmodified** → the sale lands
   on the *paying* cashier.
2. **Toppings are child `sale_items` rows** via the nullable `parent_item_id` self-FK. Every product report
   already filters `si.productId IS NOT NULL` (`SaleRepository` L64-178), so topping rows (null `product_id`)
   are excluded automatically — **no report query changes**.
3. **Two-level gating.** `RESTAURANT` (flag) = the API exists; `restaurantMode` (tenant setting in
   `tenants.settings` JSONB) = this business is a restaurant. Both, because the installer grants every
   feature to every install.

### Landmines

- **`Feature.java` is decorative — nothing reads it.** Real enforcement is `FeatureGuardInterceptor.FEATURE_ROUTES`
  plus `SuperAdminTenantService.provisionFromSeed` (`STORE_CREDIT` is enforced without being in the enum).
  Adding `RESTAURANT` to the enum alone does nothing.
- **CSP `connect-src` omits QZ Tray's WebSocket.** `src/middleware.ts` L46 is `connect-src 'self' ${apiUrl}`
  and `connect-src` governs WebSocket; QZ uses `ws://localhost:8181` / `wss://localhost:8182`. Kitchen printing
  cannot work until this is widened — receipt QZ printing may already be silently broken for the same reason.
- **`processHardwareCheckoutActions` swallows QZ errors and falls back to browser print**, which
  `electron/main.ts:274-277` makes impossible (it denies `window.open`). A kitchen print must **never** do
  this — a swallowed failure means the kitchen never got the order.
- **The tax chain is implemented twice** — backend `TaxRateService` + `SaleService`, frontend
  `getProductTaxRate` + the `taxInfo` memo in `useCart.ts`. Change both in one commit or the cart and server
  totals silently disagree. The backend rounds **per `sale_items` row**, so the client rounds per sub-line too.
- **`ProductEntity.stockQuantity` is a `@Formula`** over `stock_levels`, so an untracked product reports `0`;
  client guards must key off `trackStock`, never the number. **`PUT /tenant/info` is a full replace**, so a new
  settings-tab save handler must re-send the business fields (`handleSaveLoyalty`, `settings/page.tsx`
  L163-173). **`CartSummary`'s "Hold Sale" is wired to `onHold={() => {}}`** — a live dead control that `F5`
  already routes to; `F11` is unused.

## Layout

`pos-backend/` Spring Boot 3.3.7 / Java 17 / Maven / Postgres / Flyway · `pos-frontend/` Next.js 14.2.35 /
React 18 / TS strict / Tailwind + the Electron launcher (`electron/`) · `lumora_pos/` umbrella docs only
(its CLAUDE.md holds the SaaS architecture and conventions).

Desktop-specific: `pos-frontend/electron/` (launcher `main.ts`, activation/first-run windows, license
verify/crypto, IPC) · `pos-backend/.../licensing/` (**verification** only — `LicenseGuard`, `LicenseVerifier`,
`MachineFingerprint`, `LicenseProperties`) · `.../superadmin/DesktopBootstrapRunner.java` (first-run seeding).

## Desktop runtime model

`npm run electron:build` produces the installer. At runtime `electron/main.ts`, in order: **activation gate**
(`ensureActivated` — no valid sealed license → activation window, key redeemed against the cloud License
Server) → **first-run wizard** (once per machine; collects business + admin creds, bcrypt-hashes the password,
writes `%APPDATA%/StoreX Restaurant/config/tenant-seed.json` for `DesktopBootstrapRunner`) → **spawns the
Spring backend** (bundled JRE + `pos-backend.jar`, profile `prod,desktop`) → **spawns the Next.js standalone
server** (`resources/web/server.js`) → opens the window. `main.ts` calls `app.setName`, so user data lives in
`%APPDATA%/StoreX Restaurant` (logs `logs/lumora-<date>.log`), not the `frontend` folder retail also uses.
Postgres runs separately as a **Windows service `StoreXRestaurantPostgres` on port 5440**, installed by NSIS
`build/install-postgres.ps1`, which writes creds + a generated `jwtSecret` to `%ProgramData%\StoreX
Restaurant\db.properties`. postgres-bin is **server-only (no psql.exe)**; Flyway builds the schema in the always-present `postgres` DB (V1 creates `uuid-ossp` itself).

### Ports — DO NOT change without reading this

| Component | Port (packaged) | Why |
|---|---|---|
| Spring backend (loopback `127.0.0.1`) | **8082** | Retail StoreX owns 8081; this fork moved off it so both can run at once. The web client bakes its target at BUILD time from `pos-frontend/.env` (`NEXT_PUBLIC_API_URL=http://localhost:8082`; `services/api.ts` + `superAdminApi.ts` default to 8082, as does `application.yml`). **Changing it means .env + those fallbacks + `main.ts` + `application*.yml` in one commit, then a rebuild — miss one and every client→backend call is a "network error."** |
| Next.js window/frontend | **47817** | Off 3000 because a local License Server (Next.js) on 3000 collided with — and was loaded instead of — the POS; off retail's 47816 so the two products coexist. Not baked anywhere, so free to move. |
| Postgres | 5440 | Windows service `StoreXRestaurantPostgres`; retail keeps 5433, and stock EDB installs take 5432/5434/5435 |
| Dev (`isDev`) | backend 8082, frontend 3000 | so `npm run electron:dev` matches `next dev` |

`main.ts` runs `assertPortAvailable()` before each spawn, so a busy port fails loudly with a dialog instead of
silently attaching to a foreign server. CORS `ALLOWED_ORIGINS` and the middleware CSP `connect-src` derive
from these ports at runtime — keep them consistent.

## Commands

```powershell
cd pos-backend  ; ./mvnw -o compile  # quick check; -o clean package -DskipTests builds the jar
cd pos-frontend ; npm run electron:dev    # backend 8082, frontend 3000
npm run electron:build                    # next build + electron:tsc + electron-builder → installer
```

CI gates, in order — and what to run locally: `npm run typecheck && npm run lint && npm test && npm run build`
in `pos-frontend` (never `@ts-ignore` to ship), then a duplicate-Flyway-version check and `./mvnw -o clean
verify` in `pos-backend`.

### Migration drift — the check the test suite cannot give you

`application-test.yml` uses H2 with `ddl-auto: create-drop` and **`flyway.enabled: false`**, so **no migration
is ever exercised by `mvn verify`** and entity/DDL drift stays invisible until a real install runs. After
adding any migration, boot once against a real Postgres with validation on: Flyway builds the schema, then
Hibernate refuses to start on any mismatch. `/actuator/health` → `UP` means it passed.

```powershell
$env:DATABASE_URL="jdbc:postgresql://127.0.0.1:5440/postgres"; $env:DB_USERNAME="postgres"; $env:DB_PASSWORD="<db.properties>"; $env:JWT_SECRET="<any 64+ chars>"
./mvnw -o spring-boot:run -Dspring-boot.run.profiles=prod -Dspring-boot.run.jvmArguments="-Dspring.jpa.hibernate.ddl-auto=validate -Dserver.port=8099"
```

`DB_PASSWORD` is in `%ProgramData%\StoreX Restaurant\db.properties`. Use
**`prod` alone, never `prod,desktop`:** `LicenseGuard` is a `@PostConstruct` bean that aborts startup with
*"no license token was provided"* unless the launcher injects `APP_LICENSE_TOKEN`, and the `desktop` profile
adds only licensing, loopback binding and the seed — nothing schema-affecting. Starting a stopped
`StoreXRestaurantPostgres` needs **admin**; without it use a throwaway cluster from the bundled binaries,
never the installed data dir: `postgres-bin/bin/initdb.exe -D <tmp> -U postgres --auth=trust`, then `pg_ctl.exe -D <tmp>
-o "-p 5599" start`, point `DATABASE_URL` at 5599, and delete `<tmp>` after.

### Staging the installer

`powershell -ExecutionPolicy Bypass -File .\build-installer.ps1` stages jar → `resources/backend`,
`next build` → `resources/web`, `electron:tsc`, then runs `electron-builder`; it is the only source of truth
for what gets staged where. **`pos-frontend/resources/` is gitignored and not in this repo** — `jre` (Temurin
17, 53 MB) and `postgres-bin` (98 MB) were hand-copied from `D:\Lumora\POS System Desktop`, so a fresh clone
lacks them and `electron-builder` fails; `backend/` and `web/` are regenerated by the script. Reinstalling
does **not** touch `%APPDATA%/StoreX Restaurant` or `%LOCALAPPDATA%/StoreXRestaurant`, so installing over an
existing install is the real upgrade path — and the only place migration backfills get exercised.

## Licensing & activation

Issuance lives in a **separate Next.js app**, `D:\Lumora\Lumora License service` (`https://lumora-k-ten.vercel.app`,
console `/super-admin/licenses`); this build only **verifies**. That URL is `main.ts`'s `ACTIVATION_URL`
default, overridable with `LUMORA_ACTIVATION_URL`.

- Activation responses are flat JSON, **not** the `{success,message,data}` envelope: success `{license,
  edition, customerName, expiresAt}`, failure `{error}` (parser `electron/services/license.ts`).
- **Ed25519**: the PUBLIC key is baked into **both** `electron/keys/license-public-key.ts` and
  `application-desktop.yml` (`app.license.signing.public-key`) — do **not** remove either. Tokens are EdDSA
  compact JWS; the Electron verifier (`license-crypto.ts`) and Spring `LicenseGuard` verify the SAME one. The
  sealed license is DPAPI-stored at `%LOCALAPPDATA%/StoreXRestaurant/config/license.lic`, machine-locked to
  `sha256("guid:"+MachineGuid)` — delete it to force the activation screen again.
- **`license-signing-key.PRIVATE.txt` must never be added to this repo** — the issuing secret belongs only on
  the license server. It is gitignored; keep it that way.
- **Desktop DB credentials:** super-admin (Flyway V25/V38 default) `superadmin@lumora.com` /
  `SuperAdmin@2024`, single-use, forces a change. Normal entry is the first-run wizard's tenant login.

## Flyway version reservation

Migrations live in `pos-backend/src/main/resources/db/migration/`. Reserve the next `V<n>__` number
before writing one — **backend CI hard-fails on duplicates**. **Highest on disk is `V61`**: V59
`products.track_stock`, V60 the topping tables, V61 `sale_items.parent_item_id` + `topping_id` +
`sort_order` + `notes`. Toppings landed before tables, so this is *not* the order the plan reserved —
trust disk over the plan. Reserved next, in this order: **V62** `restaurant_areas` + `restaurant_tables` +
the `RESTAURANT` feature backfill · **V63** `restaurant_orders` + `restaurant_order_items` +
`restaurant_order_counters` · **V64** `kitchen_tickets` + `kitchen_ticket_items` + `kitchen_station` columns.

V61's self-FK **must** stay `DEFERRABLE INITIALLY DEFERRED`: parent and child are both elements of the same
cascaded `SaleEntity.items` collection and Hibernate guarantees no insert order within one entity type.
`V55__license_keys.sql` is kept though issuance was removed — deleting it breaks Flyway validation on
provisioned DBs. Never edit an applied migration; fix forward.

House style (copy `V56__loyalty_ledger.sql`): `id UUID PRIMARY KEY` with **no DB default** (Hibernate
generates it), `tenant_id UUID NOT NULL` with no FK on newer tables, the audit block
(`created_at/updated_at/created_by/updated_by/version`), money `NUMERIC(12,2)`, enums as `VARCHAR(20)` with a
comment listing the values (never a Postgres ENUM), indexes `idx_<abbrev>_<cols>` leading with `tenant_id`,
and a prose `--` header explaining *why*.

## Conventions that bite

- **There is no automatic tenant scoping.** `TenantContext` is a plain `ThreadLocal` set by
  `JwtAuthenticationFilter`, and `BaseEntity`'s javadoc claiming queries are auto-scoped is **wrong**. Every
  repository method must take and filter on `tenantId`; every service must call
  `setTenantId(TenantContext.getTenantId())` before save.
- **Pricing is server-authoritative.** Catalogue lines force `unitPrice = product.getBasePrice()` and ignore
  the request (`SaleService` L206-210, 259); custom lines (`productId == null` + `itemName`) accept a typed
  price. Do not widen this — the topping "typed price" exemption is keyed on a server-side `price_mode`
  column, never on a client claim.
- **Auth is role-based via `@PreAuthorize`.** `PermissionEntity` is granted as authorities but **no controller
  checks permissions**. All responses use the `ApiResponse<T>` envelope. Frontend services are flat exported
  objects in `<domain>Service.ts` unwrapping `.then(res => res.data.data)`, interfaces co-located; query keys
  go in `src/lib/queryKeys.ts`.
- **There is no realtime transport anywhere** — no WebSocket, SSE or STOMP on either side. The established
  freshness pattern is TanStack Query `refetchInterval`.

## Where else to look, and what not to touch

- `lumora_pos/CLAUDE.md` — SaaS architecture, multi-tenancy, auth, money-path invariants · `AGENTS.md` — the
  same guidance for other agents, keep the two in step ·
  `C:\Users\User\.claude\plans\user-wants-table-dining-snoopy-spark.md` — the restaurant plan.
- **Never touch:** `license-signing-key.PRIVATE.txt` (never add it here), `hs_err_pid*.log` /
  `replay_pid*.log` (JVM crash dumps, not source), and the sibling directories listed at the top.
