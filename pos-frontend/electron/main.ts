import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';

import { ensureActivated, type ActivatedLicense } from './activation-window';
import { runFirstRunWizard } from './first-run-window';
import { needsFirstRun, writeTenantSeed } from './services/tenantSeed';
import { computeFingerprint } from './services/fingerprint';

// StoreX Restaurant desktop entry point. This is a product in its own right,
// not a second copy of retail StoreX: its own appId, install directory, Windows
// service, data directory and ports, so both can sit on one machine and even run
// at the same time. The bundled PostgreSQL runs as a Windows service
// ("StoreXRestaurantPostgres") that is registered + started by the NSIS
// installer (build/install-postgres.ps1), so we don't manage its lifecycle
// here. On launch we: (1) gate on product activation, (2) spawn the JVM
// against the local DB, (3) spawn the Next.js standalone server, then open a
// Chromium window pointing at the local frontend.

// Fixes %APPDATA%\StoreX Restaurant as the user-data root rather than letting it
// fall out of package.json's `name` ("frontend"), which retail StoreX also uses —
// sharing that folder would mean sharing logs, uploads and the first-run tenant
// seed between two different products.
app.setName('StoreX Restaurant');

const isDev = !app.isPackaged;
// The frontend's API client bakes its backend URL at BUILD time
// (NEXT_PUBLIC_API_URL ?? http://localhost:8082), so the backend MUST stay on
// 8082 for the packaged client to reach it — change this and you must change
// pos-frontend/.env and the fallbacks in services/api.ts + superAdminApi.ts in the
// same commit, then rebuild. 8082, not retail StoreX's 8081, so the two products
// don't fight over the port. The window/frontend port has no such constraint, so
// the packaged app moves it off the conventional 3000 to a less common port —
// that's what collided with the local Lumora License Server — and off retail's
// 47816 for the same reason. Dev keeps 3000 so `npm run electron:dev` lines up
// with `next dev`. assertPortAvailable (below) still fails loudly if anything
// else is already holding either port.
const BACKEND_PORT = 8082;
const FRONTEND_PORT = isDev ? 3000 : 47817;
const BACKEND_HEALTH_TIMEOUT_MS = 120_000;
const FRONTEND_READY_TIMEOUT_MS = 60_000;

// Cloud activation endpoint — the License Console that holds the Ed25519 PRIVATE
// signing key. Override per-channel with LUMORA_ACTIVATION_URL (e.g. for staging).
const ACTIVATION_URL =
  process.env.LUMORA_ACTIVATION_URL || 'https://lumora-k-ten.vercel.app';

const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const DB_PROPERTIES = path.join(PROGRAM_DATA, 'StoreX Restaurant', 'db.properties');

let backendProc: ChildProcess | null = null;
let frontendProc: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function resourcesDir(): string {
  return isDev
    ? path.join(__dirname, '..', '..', 'resources')
    : process.resourcesPath;
}

function userDataDir(): string {
  return app.getPath('userData');
}

function logFile(): string {
  const logsDir = path.join(userDataDir(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, `lumora-${new Date().toISOString().slice(0, 10)}.log`);
}

function appendLog(line: string): void {
  try {
    fs.appendFileSync(logFile(), line.endsWith('\n') ? line : line + '\n');
  } catch {
    // best-effort
  }
}

interface DbConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  jwtSecret: string;
}

function loadDbConfig(): DbConfig {
  if (!fs.existsSync(DB_PROPERTIES)) {
    throw new Error(
      `Database configuration not found at ${DB_PROPERTIES}.\n` +
      `Reinstall StoreX Restaurant to provision the database.`
    );
  }
  const text = fs.readFileSync(DB_PROPERTIES, 'utf8');
  const cfg: Partial<DbConfig> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    (cfg as Record<string, string>)[key] = value;
  }
  for (const k of ['host', 'port', 'user', 'password', 'database', 'jwtSecret'] as const) {
    if (!cfg[k]) throw new Error(`db.properties is missing key: ${k}`);
  }
  return cfg as DbConfig;
}

/**
 * Resolve only if `port` is free; reject with a clear message if anything else
 * holds it. This is what stops the launcher from silently attaching to a foreign
 * server: without it, the readiness probe (waitForUrl) is satisfied by ANY server
 * answering on the port — which is exactly how the local License Server on 3000
 * ended up loaded inside the POS window.
 */
function assertPortAvailable(port: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        reject(new Error(
          `Port ${port} (needed for the ${label}) is already in use. Close whatever ` +
          `is using it — for example a local dev server or the Lumora License Server ` +
          `— then start StoreX Restaurant again.`));
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => tester.close(() => resolve()));
    tester.listen(port, '127.0.0.1');
  });
}

async function startBackend(db: DbConfig, license: ActivatedLicense): Promise<void> {
  await assertPortAvailable(BACKEND_PORT, 'StoreX Restaurant backend');
  const resources = resourcesDir();
  const javaExe = path.join(resources, 'jre', 'bin', 'java.exe');
  const jarPath = path.join(resources, 'backend', 'pos-backend.jar');

  if (!fs.existsSync(javaExe)) throw new Error(`Bundled JRE missing at ${javaExe}`);
  if (!fs.existsSync(jarPath)) throw new Error(`Backend jar missing at ${jarPath}`);

  // Copy(3)'s backend runs the 'prod' profile (DATABASE_URL/DB_USERNAME/DB_PASSWORD/
  // JWT_SECRET) overlaid with 'desktop' (loopback bind, cookie-secure off, license
  // gate, shutdown actuator). Translate db.properties into that env contract.
  const databaseUrl = `jdbc:postgresql://${db.host}:${db.port}/${db.database}`;
  const uploadDir = path.join(userDataDir(), 'uploads', 'logos');
  const seedFile = path.join(userDataDir(), 'config', 'tenant-seed.json');

  appendLog(`[main] spawning backend: ${javaExe} -jar ${jarPath}`);

  backendProc = spawn(
    javaExe,
    [
      '-Xmx512m',
      '-jar',
      jarPath,
      '--spring.profiles.active=prod,desktop',
      `--server.port=${BACKEND_PORT}`,
    ],
    {
      env: {
        ...process.env,
        APP_DATA_DIR: userDataDir(),
        // Datasource (prod profile)
        DATABASE_URL: databaseUrl,
        DB_USERNAME: db.user,
        DB_PASSWORD: db.password,
        // Security (prod profile)
        JWT_SECRET: db.jwtSecret,
        ALLOWED_ORIGINS: `http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}`,
        // Uploads + first-run tenant seed (desktop profile)
        APP_UPLOAD_DIR: uploadDir,
        APP_TENANT_SEED_FILE: seedFile,
        // Product activation (desktop LicenseGuard verifies the token against its
        // JAR-baked public key and aborts startup if it's missing/invalid).
        APP_LICENSE_TOKEN: license.token,
        APP_MACHINE_FINGERPRINT: computeFingerprint(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  backendProc.stdout?.on('data', d => appendLog('[backend] ' + d.toString().trimEnd()));
  backendProc.stderr?.on('data', d => appendLog('[backend!] ' + d.toString().trimEnd()));
  backendProc.on('exit', code => {
    appendLog(`[backend] exited with code ${code}`);
    backendProc = null;
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox(
        'Backend stopped',
        'The StoreX Restaurant backend stopped unexpectedly. Check logs in ' + path.dirname(logFile())
      );
    }
  });

  return waitForUrl(`http://127.0.0.1:${BACKEND_PORT}/actuator/health`, BACKEND_HEALTH_TIMEOUT_MS, 'backend');
}

async function startFrontend(): Promise<void> {
  await assertPortAvailable(FRONTEND_PORT, 'StoreX Restaurant app window');
  const resources = resourcesDir();
  const serverJs = path.join(resources, 'web', 'server.js');
  if (!fs.existsSync(serverJs)) throw new Error(`Next.js server.js missing at ${serverJs}`);

  appendLog(`[main] spawning frontend: ${serverJs}`);

  frontendProc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(FRONTEND_PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: `http://localhost:${BACKEND_PORT}`,
    },
    cwd: path.dirname(serverJs),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  frontendProc.stdout?.on('data', d => appendLog('[web] ' + d.toString().trimEnd()));
  frontendProc.stderr?.on('data', d => appendLog('[web!] ' + d.toString().trimEnd()));
  frontendProc.on('exit', code => {
    appendLog(`[web] exited with code ${code}`);
    frontendProc = null;
  });

  return waitForUrl(`http://127.0.0.1:${FRONTEND_PORT}`, FRONTEND_READY_TIMEOUT_MS, 'frontend');
}

function waitForUrl(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          appendLog(`[main] ${label} ready (${url})`);
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error(`Timeout waiting for ${label} at ${url}`));
        } else {
          setTimeout(tick, 1000);
        }
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timeout waiting for ${label} at ${url}`));
        } else {
          setTimeout(tick, 1000);
        }
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b0b0e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function killChild(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      // taskkill sweeps the process tree; child_process.kill on Windows only
      // sends to the immediate process and orphans grandchildren.
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (err) {
    appendLog('[main] killChild error: ' + (err as Error).message);
  }
}

function cleanup(): void {
  isQuitting = true;
  // We do NOT touch the Postgres service — it's a Windows service that lives
  // independently of this app and will be cleaned up by the NSIS uninstaller.
  killChild(frontendProc); frontendProc = null;
  killChild(backendProc); backendProc = null;
}

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);
app.on('quit', cleanup);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      if (!isDev) {
        // 1. Product activation gate. Returns instantly if a valid license is
        //    already sealed on this machine; otherwise opens the activation
        //    window and blocks until the customer redeems their key. A cancel
        //    quits the app from inside ensureActivated — the POS must not run
        //    unlicensed.
        const license = await ensureActivated(ACTIVATION_URL);
        // 2. First-run setup wizard (once per machine). Collects business +
        //    admin credentials, bcrypt-hashes the password, and writes
        //    tenant-seed.json for the backend's DesktopBootstrapRunner.
        if (needsFirstRun(userDataDir())) {
          const input = await runFirstRunWizard();
          writeTenantSeed(userDataDir(), input);
          appendLog('[main] first-run tenant seed written');
        }
        // 3. Bring up the local services against the bundled DB.
        const db = loadDbConfig();
        await startBackend(db, license);
        await startFrontend();
      } else {
        await waitForUrl(`http://127.0.0.1:${FRONTEND_PORT}`, FRONTEND_READY_TIMEOUT_MS, 'dev frontend');
      }
      await createWindow();
    } catch (err) {
      const msg = (err as Error).message;
      appendLog('[main] startup failed: ' + msg);
      // A cancelled activation/setup is a deliberate user action, not a crash —
      // quit quietly without the scary error box.
      if (/cancelled/i.test(msg)) {
        cleanup();
        app.exit(0);
        return;
      }
      dialog.showErrorBox('StoreX Restaurant failed to start', msg + '\n\nLogs: ' + path.dirname(logFile()));
      cleanup();
      app.exit(1);
    }
  });
}
