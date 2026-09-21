import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "path";

import {
  activate,
  defaultMachineName,
  verifyLocalLicense,
  type RuntimeLicenseInfo,
  type VerifyFailureReason,
} from "./services/license";
import { fingerprintShortCode } from "./services/fingerprint";

export interface ActivatedLicense {
  token: string;
  info: RuntimeLicenseInfo;
}

/** Friendly first-screen message per failure reason. */
function reasonMessage(reason: VerifyFailureReason): string {
  switch (reason) {
    case "NOT_ACTIVATED":
      return "Enter the license key that came with your purchase to activate StoreX Restaurant on this computer.";
    case "MACHINE_MISMATCH":
      return "This license belongs to a different computer. To move it here, contact StoreX Restaurant support to release it, then re-activate.";
    case "EXPIRED":
      return "Your license has expired. Contact StoreX Restaurant support to renew, then enter your key again.";
    case "SEAL_UNREADABLE":
      return "Your saved license couldn't be read. Please re-enter your license key.";
    case "SIGNATURE_INVALID":
    default:
      return "Your saved license is no longer valid. Please re-enter your license key.";
  }
}

/**
 * The activation gate. Returns immediately if a valid license is already sealed
 * on this machine; otherwise opens the activation window and resolves once the
 * user activates successfully. Rejects if they close the window without activating
 * (the caller should then quit — the POS must not run unlicensed).
 */
export async function ensureActivated(apiBaseUrl: string): Promise<ActivatedLicense> {
  const local = verifyLocalLicense();
  if (local.ok) {
    return { token: local.token, info: local.info };
  }
  return runActivationWindow(apiBaseUrl, reasonMessage(local.reason));
}

function runActivationWindow(apiBaseUrl: string, message: string): Promise<ActivatedLicense> {
  return new Promise<ActivatedLicense>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 600,
      resizable: false,
      fullscreenable: false,
      title: "Activate StoreX Restaurant",
      webPreferences: {
        preload: join(__dirname, "activation-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenuBarVisibility(false);

    let activated = false;

    const handleGetInfo = () => ({
      machineName: defaultMachineName(),
      shortCode: fingerprintShortCode(),
      message,
    });

    const handleSubmit = async (
      _e: IpcMainInvokeEvent,
      args: { key: string; machineName: string },
    ): Promise<RuntimeLicenseInfo> => {
      // Throwing here surfaces the message to the renderer via the rejected invoke.
      const info = await activate({
        apiBaseUrl,
        key: args.key,
        machineName: args.machineName,
      });
      activated = true;
      const verified = verifyLocalLicense();
      cleanup();
      win.close();
      if (verified.ok) {
        resolve({ token: verified.token, info: verified.info });
      } else {
        // Should never happen — we just sealed a token we verified.
        reject(new Error("Activation succeeded but the license failed local verification."));
      }
      return info;
    };

    const handleQuit = () => {
      cleanup();
      win.close();
      app.quit();
    };

    function cleanup() {
      ipcMain.removeHandler("activation:get-info");
      ipcMain.removeHandler("activation:submit");
      ipcMain.removeHandler("activation:quit");
    }

    ipcMain.handle("activation:get-info", handleGetInfo);
    ipcMain.handle("activation:submit", handleSubmit);
    ipcMain.handle("activation:quit", handleQuit);

    win.on("closed", () => {
      cleanup();
      if (!activated) {
        reject(new Error("Activation cancelled."));
      }
    });

    void win.loadFile(join(__dirname, "activation.html"));
  });
}
