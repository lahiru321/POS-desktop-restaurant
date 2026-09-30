import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload for the first-run wizard. Minimal audited surface to first-run.html —
 * no Node access leaks to the renderer.
 */
contextBridge.exposeInMainWorld("firstRun", {
  /** Submit setup; resolves on success, rejects with a user-facing message. */
  submit: (input: {
    tenantName: string;
    adminEmail: string;
    adminPassword: string;
    /** Optional Lumora support login; empty password = none. */
    superAdminEmail?: string;
    superAdminPassword?: string;
  }) =>
    ipcRenderer.invoke("first-run:submit", input),
  /** Quit the app from the setup screen. */
  quit: () => ipcRenderer.invoke("first-run:quit"),
});
