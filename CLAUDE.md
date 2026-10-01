# CLAUDE.md

Guidance for Claude Code working in **`D:\Lumora\POS-desktop-restaurant`**.

## What this project is

The **restaurant fork** of Lumora POS (StoreX) — a single-machine **Electron** app bundling its own backend,
database and web UI into one NSIS installer (`pos-frontend/dist/StoreX-Restaurant-Setup-<version>.exe`, version from `pos-frontend/package.json` — bump it for every build handed to a client). Forked from
`LumoraTechSolution/POS-desktop` (the retail product) and identical to it at the fork point. Table dining,
kitchen tickets and per-item toppings are added **here only** and never flow back upstream. It ships as its own
product — appId `com.lumora.restaurant`, **StoreX Restaurant**, with its own install dir, service, data dir,
licence store and ports — so it sits beside retail StoreX. It is **restaurant-only**: tables, tabs, toppings
and the floor are core behaviour with no on/off switch. A till with no tab open is a plain counter sale.

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
3. **No restaurant gating.** The `RESTAURANT` flag + `restaurantMode` setting were built, then **removed**:
   restaurant-only product, so `/api/v1/restaurant` is absent from `FEATURE_ROUTES` and the client never
   checks. Only role checks remain. V62's `RESTAURANT` backfill stays on disk, inert (never edit applied).

### Landmines

- **`Feature.java` is decorative — nothing reads it.** Real enforcement is `FeatureGuardInterceptor.FEATURE_ROUTES`
  plus `SuperAdminTenantService.provisionFromSeed` (`STORE_CREDIT` is enforced without being in the enum).
  Adding a value to the enum alone does nothing.
- **CSP `connect-src` must keep the loopback WebSocket entries** (`ws(s)://localhost:*`, `127.0.0.1:*`) in
  `src/middleware.ts` — `connect-src` governs WebSocket and QZ Tray lives there. Drop them and every QZ print dies.
- **Receipt printing returns a result; never ignore it.** `processHardwareCheckoutActions` →
  `ReceiptPrintResult`. In the desktop app (`window.lumora.isDesktop`) a QZ failure is reported, never
  browser-printed (the window denies `window.open`; the old fallback opened the customer's web browser),
  and `browser_print` means "no receipt printer set up". The terminal's `printReceipt()` turns a failure
  into `ReceiptPrintFailedDialog` (Retry/Skip). Kitchen printing is stricter still: `kitchenPrinterService`
  never throws or falls back, and every ticket is acked PRINTED/FAILED/HANDLED.
- **The windows only open `https:` links, and never navigate off the app** (`electron/navigation.ts`,
  applied to all three windows). Don't add a `shell.openExternal` or `setWindowOpenHandler` elsewhere.
- **The launcher supervises backend + web server once the till is up** (`electron/supervisor.ts`):
  unexpected exit → `reconnecting.html` → restart after 2/4/8 s → reload; >3 deaths in 10 min → stop and
  say so. Packaged app only. Startup failures keep their own path.
- **Licence: 7-day grace after expiry, on BOTH sides** — `LicensePolicy.GRACE` (backend, also serves
  `GET /license/status` for `LicenseBanner`) and `LICENSE_GRACE_DAYS` (launcher). Change one, change both.
  A forged token gets no grace: jjwt checks the signature before the expiry.
- **Backups:** `DatabaseBackupService` runs the bundled `postgres-bin/tools/pg_dump.exe` (staged from a local
  PostgreSQL 16 by `build/stage-postgres.ps1` on every installer build) into
  `%ProgramData%\StoreX Restaurant\backups` — daily catch-up, keeps 14, Settings → Backups, ADMIN only.
  Restore is `restore-backup.ps1` with the app closed (saves a `storex-pre-restore-*` copy first).
- **Kitchen stations are free-text codes matched by string equality** — once when a round is split into one
  ticket per station (`product → category → KITCHEN`), once on the till's `kitchenStationTargets` map
  (localStorage, per machine). Both sides normalize the same way (`KitchenStations.normalize` /
  `normalizeKitchenStation`: trim, collapse spaces, upper-case); change one, change both. There is no
  stations table — `GET /restaurant/kitchen-stations` is the distinct set in use, KITCHEN first.
- **An area is a map once any table in it has `pos_x/pos_y`** (V69; Restaurant → Tables → Arrange); unplaced
  tables still show as tiles under it, and an area with none placed is the old tile grid. Positions are written
  **only** by `PUT /restaurant/areas/{id}/layout` (whole-area, collision-checked; the table form never sends
  them), and moving a table to another area clears them. `uk_rest_table_area_pos` is DEFERRABLE so a swap in
  one save cannot trip it mid-flush. Grid arithmetic lives in `src/lib/floorMap.ts`.
- **Courses were removed: Send fires every unsent line.** V70's `released_course` and V63's `course_no`
  stay in the DB, unmapped/ignored (no fire-course endpoint, no `held` flag); don't bring them back piecemeal.
- **A tab can sit at several tables** (V71 `restaurant_order_tables`, "Join table" in the till's More menu).
  `restaurant_orders.table_id` stays the tab's *own* table, so `uk_rest_order_open_table` is unchanged; the
  extras are join rows that exist only while the tab is OPEN (`UNIQUE(table_id)`). "Is anyone on T2?" spans
  both places, so open/join/move take the table's row lock (`findByIdAndTenantIdForUpdate`) and then
  `requireTableFree`. Settle/void free every table; **merge now keeps the source's tables occupied** as joined
  tables of the target (a parked-takeaway target still frees them). Labels/tickets read `T1+T2`
  (`RestaurantOrderEntity.tableLabel`); the floor maps joined ids to the tab from `OrderResponse.joinedTables`.
- **Everything printed goes through `qzTrayService.printRaw`, which sends ISO-8859-1 and cleans every
  string to printable ASCII (`printerText.toPrinterText`)** — the target printers (DBL 822, 80mm ESC/POS,
  48 cols) carry a Chinese GB18030 font and no Sinhala/Tamil, so UTF-8 or a stray byte prints as garbage.
  Bytes that must not be touched (the drawer kick, ending 0xFA) go as `rawBytes()` hex elements, never
  strings; jobs start `INIT, SINGLE_BYTE` (FS . cancels Chinese mode). `kickBytes` is the one kick parser.
- **Silent QZ printing is per machine.** `build/setup-qz-signing.ps1` (installer hook, non-fatal; the Start-menu
  shortcut "StoreX Restaurant - Repair printing" re-runs it elevated via `build/repair-printing.ps1`) makes a keytool PKCS12 key in `%ProgramData%\StoreX Restaurant\qz\`,
  copies its cert into QZ Tray as `override.crt` and restarts QZ; the launcher passes `QZ_KEYSTORE`/
  `QZ_KEYSTORE_PASSWORD`; `QzSigningService` signs. Never ship one shared key — whoever unpacked the
  installer could sign print jobs for every customer's QZ. The till asks once; "Remember" makes it silent.
- **Voiding food the kitchen already has can need a manager's PIN** (tenant setting
  `restaurantVoidRequiresPin`, off by default; Settings → Restaurant). Enforced in
  `RestaurantOrderService.voidItem` — only the *fired* portion counts, managers/admins approve their own —
  and asked for up front by `useDineInCart.voidLine` via `ManagerPinDialog`. The PIN check itself is
  `auth/service/ManagerPinService` (constant-time, returns the approver for the audit); `SaleService`'s
  payment correction uses the same loop. Whole-tab void is ADMIN/MANAGER-only and needs no PIN.
- **The tax chain is implemented twice** — backend `TaxRateService` + `SaleService`, frontend
  `getProductTaxRate` + the `taxInfo` memo in `useCart.ts`. Change both in one commit or the cart and server
  totals silently disagree. The backend rounds **per `sale_items` row**, so the client rounds per sub-line too.
- **`ProductEntity.stockQuantity` is a `@Formula`** over `stock_levels`, so an untracked product reports `0`;
  client guards must key off `trackStock`, never the number. **`PUT /tenant/info` is a full replace**, so a new
  settings-tab save handler must re-send the business fields (`handleSaveLoyalty`, `settings/page.tsx`
  L163-173). **`F5` means two things:** send to kitchen on a tab, Park at the counter (Hold Sale is now Park).
  **Email login always lands on `/overview`**, so the older e2e specs expecting `/terminal` fail — pre-existing.

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

### Migration drift

`application-test.yml` uses H2 with `ddl-auto: create-drop` and `flyway.enabled: false`, so every other test
is blind to migrations. **`FlywayMigrationIntegrationTest` is the one that isn't:** it starts a real embedded
PostgreSQL (zonky `embedded-postgres`, PG 14, no Docker; UTF-8/C locale), applies every migration in
`db/migration`, boots the app with `ddl-auto=validate`, and checks the DB is at the highest `V<n>` on disk —
so a failing migration or an entity field with no column now fails `mvn verify`. The first run downloads the
Postgres binaries (run once without `-o`). The installed product runs PG 16, so before a release still boot
once against the real 16 as below — that also exercises the demo seeds and the desktop profile.

```powershell
$env:DATABASE_URL="jdbc:postgresql://127.0.0.1:5440/postgres"; $env:DB_USERNAME="postgres"; $env:DB_PASSWORD="<db.properties>"; $env:JWT_SECRET="<any 64+ chars>"
./mvnw -o spring-boot:run -Dspring-boot.run.profiles=prod -Dspring-boot.run.jvmArguments="-Dspring.jpa.hibernate.ddl-auto=validate -Dserver.port=8099"
```

`DB_PASSWORD` is in `%ProgramData%\StoreX Restaurant\db.properties`. Use **`prod` alone, never `prod,desktop`:**
`LicenseGuard` is a `@PostConstruct` bean that aborts startup with *"no license token was provided"* unless the launcher
injects `APP_LICENSE_TOKEN`; `desktop` adds only licensing, loopback binding and the seed — nothing schema-affecting.
Starting a stopped `StoreXRestaurantPostgres` needs **admin**; without it use a throwaway cluster from the bundled
binaries, never the installed data dir: `postgres-bin/bin/initdb.exe -D <tmp> -U postgres --auth=trust -E UTF8 --locale=C`
(**the encoding flags are not optional** — initdb otherwise takes WIN1252 from the Windows locale and Flyway dies at
`V16__add_returns_refunds.sql` L10, box-drawing characters, SQLState 22P05), then `pg_ctl.exe -D <tmp> -o "-p 5599" start`, point `DATABASE_URL` at 5599, and delete `<tmp>` after.
Start `pg_ctl` with its output redirected to a file, **never piped** (`| tail`): the postgres child inherits
the pipe and the shell hangs forever waiting for EOF.

**Running `e2e/restaurant.spec.ts` locally** (backend `prod,demo` on 8082 against that cluster + `npm run dev`)
needs two env vars on the backend: `ALLOWED_ORIGINS=http://localhost:3000` (`prod` otherwise refuses the
browser's CORS preflight, so every UI login silently does nothing) and `RATE_LIMIT_LOGIN_CAPACITY=1000` (the
suite makes more than the default 10 logins per 15 min and the tail of it fails with "Too many login attempts").

### Staging the installer

`powershell -ExecutionPolicy Bypass -File .\build-installer.ps1` stages jar → `resources/backend`, then the
runtimes, `next build` → `resources/web`, `electron:tsc`, then runs `electron-builder`; it is the only source of
truth for what gets staged where. **`pos-frontend/resources/` is gitignored** — everything in it is regenerated:
`build/stage-postgres.ps1` mirrors PostgreSQL **16** (server + `tools/` pg_dump/pg_restore, 77 MB) from the
build PC's `C:\Program Files\PostgreSQL\16` (keep that install patched; it refuses a different major or a
downgrade — tills hold 16 clusters), and `build/stage-jre.ps1` fetches the latest Temurin **17** JRE from
Adoptium with its SHA-256 checked (`JRE_ZIP` for offline). **Build PC needs:** PostgreSQL 16 (EDB), Node,
and internet for the JRE check. **electron-builder 26 silently drops `resources/web/node_modules`** (a
hard-coded root-`node_modules` exclusion in its copy filter): `build/after-pack.cjs` copies it back and fails
the build if `next` is missing — without it the till activates and then shows nothing. Upgrades: the
uninstaller's `customUnInit` stops the Postgres service before files are replaced (Windows locks running
programs), and `install-postgres.ps1` starts it on the new binaries. Reinstalling
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
- **Super-admin on desktop: only with a password the installer chose.** Flyway V25/V38 seed
  `superadmin@lumora.com` / `SuperAdmin@2024` (the hosted product needs it), but on desktop that default never
  works: `DesktopSuperAdminLockdown` disables any active super-admin still on it at every start, and 404s
  `/api/v1/super-admin/**` until that check ran and while none is active. The installer sets the real one in
  the first-run wizard ("Lumora support login", optional; `DesktopBootstrapRunner` applies it once) or later
  with Start menu → "StoreX Restaurant - Set super-admin password" (`set-superadmin-password.ps1`, Windows
  admin; runs `superadmin/tools/SetSuperAdminPassword` from the jar via `PropertiesLauncher`). Normal entry is
  the first-run wizard's tenant login.

## Flyway version reservation

Migrations live in `pos-backend/src/main/resources/db/migration/`. Reserve the next `V<n>__` number
before writing one — **backend CI hard-fails on duplicates**. **Highest on disk is `V71`**: V59
`products.track_stock`, V60 toppings, V61 `sale_items.parent_item_id` + `topping_id` + `sort_order` + `notes`, V62 `restaurant_areas`/`restaurant_tables` + the `RESTAURANT` backfill, V63 `restaurant_orders` +
`restaurant_order_items` + `restaurant_order_item_toppings` + `restaurant_order_counters`. Toppings landed
before tables — trust disk over the plan. V64 `kitchen_tickets` + `kitchen_ticket_items` + `kitchen_station`
columns, V65 ticket `notice`, V66 nullable `return_items.product_id`, V67 `split_from_id`,
V68 `sales.service_charge_*`, V69 `restaurant_tables.pos_x/pos_y` (floor map), V70 `restaurant_orders.released_course` (unused since courses were removed), V71 `restaurant_order_tables` (joined tables). Next free: **V72**.

V63's `uk_rest_order_open_table` (partial unique on `table_id WHERE status = 'OPEN'`) is what makes "one
table, one tab" true under a race, and `restaurant_order_counters` breaks house style on purpose — no `id`,
no audit block — because its composite PK is what the atomic `ON CONFLICT` allocation needs. V61's self-FK
**must** stay `DEFERRABLE INITIALLY DEFERRED`: parent and child are elements of one cascaded
`SaleEntity.items` collection and Hibernate guarantees no insert order within an entity type. Keep
`V55__license_keys.sql` though issuance was removed — deleting it breaks Flyway validation on provisioned DBs. Never edit an applied migration; fix forward.

House style (copy `V56__loyalty_ledger.sql`): `id UUID PRIMARY KEY` with **no DB default** (Hibernate
generates it), `tenant_id UUID NOT NULL` with no FK on newer tables, the audit block
(`created_at/updated_at/created_by/updated_by/version`), money `NUMERIC(12,2)`, enums as `VARCHAR(20)` with a
comment listing the values (never a Postgres ENUM), indexes `idx_<abbrev>_<cols>` leading with `tenant_id`, a prose `--` header explaining *why*.

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
