package com.lumora.pos.system.service;

import com.lumora.pos.common.exception.BusinessException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Local backups of the till's database — the only copy of the restaurant's
 * sales there is.
 *
 * <p>A desktop install keeps everything in one PostgreSQL on one disk. A dead
 * disk or a reinstalled Windows would lose it all, so this runs the bundled
 * {@code pg_dump} (custom format, compressed) into a backups folder outside the
 * install directory, keeps the newest {@link #keep} files, and lets an admin run
 * one now or download one to a USB stick (Settings → Backups). Restoring is
 * {@code restore-backup.ps1}, with the app closed.
 *
 * <p>When: an hourly check that backs up if the newest file is over a day old.
 * A till is usually switched off overnight, so a fixed 3 a.m. job would rarely
 * run; this catches up within minutes of the next start instead.
 *
 * <p>On only when the launcher passes {@code PG_DUMP_PATH} and
 * {@code APP_BACKUP_DIR}; everywhere else {@link #isEnabled()} is false and
 * nothing runs.
 */
@Slf4j
@Service
public class DatabaseBackupService {

    /** Every file this service writes, and the only names it will serve or delete. */
    static final Pattern FILE_NAME = Pattern.compile("^storex-\\d{8}-\\d{6}\\.dump$");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final Duration MAX_AGE = Duration.ofHours(24);
    private static final long TIMEOUT_MINUTES = 15;

    private final String pgDump;
    private final String backupDir;
    private final int keep;
    private final String datasourceUrl;
    private final String dbUser;
    private final String dbPassword;
    private final ReentrantLock running = new ReentrantLock();

    private volatile String lastError;
    private volatile Instant lastAttemptAt;

    public record BackupFile(String name, long sizeBytes, Instant createdAt) {
    }

    public record BackupStatus(boolean enabled, String directory, List<BackupFile> backups,
                               Instant lastAttemptAt, String lastError) {
    }

    public DatabaseBackupService(
            @Value("${app.backup.pg-dump:}") String pgDump,
            @Value("${app.backup.dir:}") String backupDir,
            @Value("${app.backup.keep:14}") int keep,
            @Value("${spring.datasource.url:}") String datasourceUrl,
            @Value("${spring.datasource.username:}") String dbUser,
            @Value("${spring.datasource.password:}") String dbPassword) {
        this.pgDump = pgDump == null ? "" : pgDump.trim();
        this.backupDir = backupDir == null ? "" : backupDir.trim();
        this.keep = Math.max(1, keep);
        this.datasourceUrl = datasourceUrl;
        this.dbUser = dbUser;
        this.dbPassword = dbPassword;
    }

    public boolean isEnabled() {
        return !pgDump.isBlank() && !backupDir.isBlank() && Files.isRegularFile(Path.of(pgDump))
                && datasourceUrl != null && datasourceUrl.startsWith("jdbc:postgresql:");
    }

    public BackupStatus status() {
        return new BackupStatus(isEnabled(), backupDir, isEnabled() ? list() : List.of(), lastAttemptAt, lastError);
    }

    /** The hourly check: back up if the newest backup is more than a day old (or there is none). */
    @Scheduled(initialDelayString = "PT2M", fixedDelayString = "PT1H")
    public void backUpIfDue() {
        if (!isEnabled()) {
            return;
        }
        List<BackupFile> existing = list();
        boolean due = existing.isEmpty()
                || existing.get(0).createdAt().isBefore(Instant.now().minus(MAX_AGE));
        if (!due) {
            return;
        }
        try {
            backUpNow();
        } catch (RuntimeException e) {
            log.error("Scheduled database backup failed: {}", e.getMessage());
        }
    }

    /** Runs pg_dump now. One at a time; a second request while one runs is refused. */
    public BackupFile backUpNow() {
        if (!isEnabled()) {
            throw new BusinessException("Backups are not set up on this installation");
        }
        if (!running.tryLock()) {
            throw new BusinessException("A backup is already running");
        }
        lastAttemptAt = Instant.now();
        Path dir = Path.of(backupDir);
        Path target = dir.resolve("storex-" + LocalDateTime.now().format(STAMP) + ".dump");
        Path partial = dir.resolve(target.getFileName() + ".partial");
        Path output = null;
        try {
            Files.createDirectories(dir);
            output = Files.createTempFile("pg_dump", ".log");
            URI db = URI.create(datasourceUrl.substring("jdbc:".length()));
            ProcessBuilder pb = new ProcessBuilder(
                    pgDump,
                    "--host", db.getHost(),
                    "--port", String.valueOf(db.getPort() > 0 ? db.getPort() : 5432),
                    "--username", dbUser,
                    "--dbname", db.getPath().replaceFirst("^/", ""),
                    "--format", "custom",
                    "--no-password",
                    "--file", partial.toString())
                    .redirectErrorStream(true)
                    .redirectOutput(output.toFile());
            // Never on the command line, where any process can read it.
            pb.environment().put("PGPASSWORD", dbPassword == null ? "" : dbPassword);

            Process process = pb.start();
            if (!process.waitFor(TIMEOUT_MINUTES, TimeUnit.MINUTES)) {
                process.destroyForcibly();
                throw new BusinessException("The backup took longer than " + TIMEOUT_MINUTES + " minutes and was stopped");
            }
            if (process.exitValue() != 0 || !Files.isRegularFile(partial) || Files.size(partial) == 0) {
                throw new BusinessException("pg_dump failed (exit " + process.exitValue() + "): " + tail(output));
            }
            // Only a complete dump ever carries the final name.
            Files.move(partial, target, StandardCopyOption.ATOMIC_MOVE);
            prune();
            lastError = null;
            BackupFile made = describe(target);
            log.info("Database backed up to {} ({} bytes)", target, made.sizeBytes());
            return made;
        } catch (BusinessException e) {
            lastError = e.getMessage();
            throw e;
        } catch (IOException e) {
            lastError = "Could not write the backup: " + e.getMessage();
            throw new BusinessException(lastError);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            lastError = "The backup was interrupted";
            throw new BusinessException(lastError);
        } finally {
            deleteQuietly(partial);
            deleteQuietly(output);
            running.unlock();
        }
    }

    /** Newest first. */
    public List<BackupFile> list() {
        Path dir = Path.of(backupDir);
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(dir)) {
            List<BackupFile> out = new ArrayList<>();
            for (Path p : files.filter(p -> FILE_NAME.matcher(p.getFileName().toString()).matches()).toList()) {
                out.add(describe(p));
            }
            out.sort(Comparator.comparing(BackupFile::name).reversed());
            return out;
        } catch (IOException e) {
            log.warn("Could not list backups in {}: {}", dir, e.getMessage());
            return List.of();
        }
    }

    /**
     * The file behind a backup name, for download. Only names this service
     * writes are accepted, so nothing outside the backups folder can be asked for.
     */
    public Path resolve(String name) {
        if (!isEnabled() || name == null || !FILE_NAME.matcher(name).matches()) {
            throw new BusinessException("Backup not found");
        }
        Path file = Path.of(backupDir).resolve(name);
        if (!Files.isRegularFile(file)) {
            throw new BusinessException("Backup not found");
        }
        return file;
    }

    /** Keeps the newest {@link #keep}; package-private for tests. */
    void prune() throws IOException {
        List<BackupFile> all = list();
        for (BackupFile old : all.subList(Math.min(keep, all.size()), all.size())) {
            Files.deleteIfExists(Path.of(backupDir).resolve(old.name()));
            log.info("Removed old backup {}", old.name());
        }
    }

    private static BackupFile describe(Path p) throws IOException {
        return new BackupFile(p.getFileName().toString(), Files.size(p), Files.getLastModifiedTime(p).toInstant());
    }

    private static String tail(Path log) {
        try {
            List<String> lines = Files.readAllLines(log, StandardCharsets.UTF_8);
            String text = String.join(" ", lines.subList(Math.max(0, lines.size() - 3), lines.size())).trim();
            return text.isEmpty() ? "no output" : text;
        } catch (IOException e) {
            return "no output";
        }
    }

    private static void deleteQuietly(Path p) {
        if (p == null) return;
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // best effort
        }
    }
}
