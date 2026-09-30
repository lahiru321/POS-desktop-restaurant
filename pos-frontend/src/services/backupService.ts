import api from "./api";
import { ApiResponse } from "@/types/common";

export interface BackupFile {
  /** "storex-20260930-131500.dump" */
  name: string;
  sizeBytes: number;
  /** ISO-8601 */
  createdAt: string;
}

export interface BackupStatus {
  /** False where the app has no bundled pg_dump (dev, the hosted product). */
  enabled: boolean;
  /** Where the files are, on the till. */
  directory: string;
  /** Newest first. */
  backups: BackupFile[];
  lastAttemptAt?: string | null;
  /** Why the last attempt failed; null once one succeeds. */
  lastError?: string | null;
}

export const backupService = {
  getStatus: () =>
    api.get<ApiResponse<BackupStatus>>("/system/backups").then((res) => res.data.data),

  /** Runs pg_dump now; resolves once the file is complete. */
  backUpNow: () =>
    api.post<ApiResponse<BackupFile>>("/system/backups").then((res) => res.data.data),

  /**
   * Fetches a backup with the session's auth and hands it to the browser as a
   * download — in the desktop app, Windows' save dialog, so it can go straight to
   * a USB stick.
   */
  download: async (name: string) => {
    const res = await api.get<Blob>(`/system/backups/${encodeURIComponent(name)}`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  },
};
