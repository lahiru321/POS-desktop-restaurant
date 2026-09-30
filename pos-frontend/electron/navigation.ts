import { shell, type BrowserWindow } from 'electron';

/**
 * What a window may open or navigate to — the same rules for every window.
 *
 * `shell.openExternal` hands a URL to Windows, which will run whatever handles
 * its scheme: `file:` opens (or executes) a local path, `ms-*:` and custom
 * protocols start other programs. So only real web pages (https) ever leave the
 * app, and the window itself never navigates away from its own origin — an
 * injected link or redirect cannot replace the till with somebody else's page.
 */

/** A link that may be opened in the user's browser: https only, with a host. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * @param appOrigin the origin the window belongs to, e.g. "http://localhost:47817";
 *                  null for windows that load a local file and never navigate.
 * @param log       where refusals are recorded, for support.
 */
export function lockDownNavigation(win: BrowserWindow, appOrigin: string | null, log: (line: string) => void): void {
  const contents = win.webContents;

  // window.open / target=_blank: never a new Electron window.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      log(`[nav] refused to open ${url.slice(0, 200)}`);
    }
    return { action: 'deny' };
  });

  // Same-window navigation: stay on the app, send web links to the browser.
  contents.on('will-navigate', (event, url) => {
    let origin: string | null = null;
    try {
      origin = new URL(url).origin;
    } catch {
      // unparseable: refuse below
    }
    if (appOrigin && origin === appOrigin) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      log(`[nav] refused to navigate to ${url.slice(0, 200)}`);
    }
  });

  // No <webview> tags: nothing embeds a second browser inside the till.
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
