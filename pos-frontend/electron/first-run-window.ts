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
      height: 660,
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
      submitted = true;
      cleanup();
      win.close();
      resolve({
        tenantName: input.tenantName.trim(),
        adminEmail: input.adminEmail.trim(),
        adminPassword: input.adminPassword,
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

    void win.loadFile(join(__dirname, "first-run.html"));
  });
}
