"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, DatabaseBackup, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QK } from "@/lib/queryKeys";
import { getApiErrorMessage } from "@/lib/utils";
import { backupService } from "@/services/backupService";

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings → Backups. The till keeps the only copy of the restaurant's sales, so
 * it backs itself up once a day and keeps the last two weeks; this screen shows
 * them, makes one on demand, and saves one elsewhere. Restoring is deliberately
 * not a button — it replaces everything, so it is done with the app closed.
 */
export function BackupSettings() {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: QK.backups,
    queryFn: backupService.getStatus,
    refetchInterval: 60_000,
  });

  const backUp = useMutation({
    mutationFn: backupService.backUpNow,
    onSuccess: (file) => {
      toast.success("Backup complete", { description: `${file.name} (${size(file.sizeBytes)})` });
      queryClient.invalidateQueries({ queryKey: QK.backups });
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorMessage(e, "The backup failed"));
      queryClient.invalidateQueries({ queryKey: QK.backups });
    },
  });

  const download = async (name: string) => {
    setDownloading(name);
    try {
      await backupService.download(name);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Could not download the backup"));
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} /> Loading backups...
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <Card className="bg-background border-border">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Backups run on the installed StoreX Restaurant app. They are not available here.
        </CardContent>
      </Card>
    );
  }

  const newest = status.backups[0];
  const stale = !newest || Date.now() - Date.parse(newest.createdAt) > 36 * 60 * 60 * 1000;

  return (
    <div className="space-y-4">
      <Card className="bg-background border-border">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold text-foreground">
              {newest
                ? `Last backup ${formatDistanceToNow(new Date(newest.createdAt), { addSuffix: true })}`
                : "No backup yet"}
            </CardTitle>
            <CardDescription>
              The till backs itself up once a day while it is on and keeps the last 14. Copy one to a
              USB stick now and then — a backup on the same disk does not survive the disk.
            </CardDescription>
          </div>
          <Button onClick={() => backUp.mutate()} disabled={backUp.isPending} className="gap-2">
            {backUp.isPending ? <Loader2 size={16} className="animate-spin" /> : <DatabaseBackup size={16} />}
            Back up now
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(status.lastError || stale) && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {status.lastError
                ? `The last backup failed: ${status.lastError}`
                : "There is no backup from the last day and a half. Press Back up now."}
            </p>
          )}

          {status.backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {status.backups.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">
                      {format(new Date(b.createdAt), "EEE d MMM yyyy, HH:mm")}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {b.name} · {size(b.sizeBytes)}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => download(b.name)}
                    disabled={downloading === b.name}
                    aria-label={`Download backup from ${format(new Date(b.createdAt), "d MMM yyyy HH:mm")}`}
                  >
                    {downloading === b.name ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-muted-foreground">
            Stored in <span className="font-mono">{status.directory}</span>. To restore one, close StoreX
            Restaurant and run <span className="font-mono">restore-backup.ps1</span> from the install folder
            (it saves the current data first).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
