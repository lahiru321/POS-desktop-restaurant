import { lockDownNavigation } from "./navigation";
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "path";

import { type FirstRunInput } from "./services/tenantSeed";

/**
 * First-run setup wizard. Shown once, after activation, when no tenant-seed.json
 * exists yet. Collects the business name + admin credentials and resolves them to
 * the caller (main.ts), which bcrypt-hashes and writes the seed. Rejects with
 * "Setup cancelled." if the window is closed without finishing — the caller then
 * quits.
 */
export function runFirstRunWizard(): Promise<FirstRunInput> {
  return new Promise<FirstRunInput>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 820,
      resizable: false,
      fullscreenable: false,
      title: "Set up StoreX Restaurant",
      webPreferences: {
        preload: join(__dirname, "first-run-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenuBarVisibility(false);

    let submitted = false;

    const handleSubmit = async (
      _e: IpcMainInvokeEvent,
      input: FirstRunInput,
    ): Promise<void> => {
      // Throwing surfaces the message to the renderer via the rejected invoke.
      if (!input?.tenantName?.trim()) throw new Error("Please enter your business name.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail?.trim() ?? "")) {
        throw new Error("Please enter a valid email address.");
      }
      if (!input.adminPassword || input.adminPassword.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      // The Lumora support login is optional; when given, the same rules as the
      // "Set super-admin password" tool (SetSuperAdminPassword.check).
      const saPassword = input.superAdminPassword ?? "";
      const saEmail = (input.superAdminEmail ?? "").trim();
      if (saPassword) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(saEmail)) throw new Error("Please enter a valid super-admin email.");
        if (saPassword.length < 8) throw new Error("The super-admin password must be at least 8 characters.");
        if (saPassword === "SuperAdmin@2024") throw new Error("That is the published default password - choose your own.");
      }
      submitted = true;
      cleanup();
      win.close();
      resolve({
        tenantName: input.tenantName.trim(),
        adminEmail: input.adminEmail.trim(),
        adminPassword: input.adminPassword,
        superAdminEmail: saPassword ? saEmail : undefined,
        superAdminPassword: saPassword || undefined,
      });
    };

    const handleQuit = () => {
      cleanup();
      win.close();
      app.quit();
    };

    function cleanup() {
      ipcMain.removeHandler("first-run:submit");
      ipcMain.removeHandler("first-run:quit");
    }

    ipcMain.handle("first-run:submit", handleSubmit);
    ipcMain.handle("first-run:quit", handleQuit);

    win.on("closed", () => {
      cleanup();
      if (!submitted) reject(new Error("Setup cancelled."));
    });

    // A local page: it never navigates, and opens nothing but https links.

    lockDownNavigation(win, null, () => undefined);

    void win.loadFile(join(__dirname, "first-run.html"));
  });
}
