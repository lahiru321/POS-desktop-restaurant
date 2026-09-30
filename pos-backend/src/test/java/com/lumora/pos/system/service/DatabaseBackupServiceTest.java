package com.lumora.pos.system.service;

import com.lumora.pos.common.exception.BusinessException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("DatabaseBackupService")
class DatabaseBackupServiceTest {

    private static final String URL = "jdbc:postgresql://localhost:5440/postgres";

    private DatabaseBackupService service(Path pgDump, Path dir, int keep) {
        return new DatabaseBackupService(pgDump == null ? "" : pgDump.toString(), dir.toString(), keep, URL, "u", "p");
    }

    @Test
    @DisplayName("Off unless the launcher gives it a real pg_dump and a Postgres datasource")
    void shouldBeOffWithoutPgDump(@TempDir Path dir) throws Exception {
        assertThat(service(null, dir, 14).isEnabled()).isFalse();
        assertThat(service(dir.resolve("missing.exe"), dir, 14).isEnabled()).isFalse();
        Path tool = Files.createFile(dir.resolve("pg_dump.exe"));
        assertThat(new DatabaseBackupService(tool.toString(), dir.toString(), 14, "jdbc:h2:mem:x", "u", "p")
                .isEnabled()).isFalse();
        assertThat(service(tool, dir, 14).isEnabled()).isTrue();

        assertThatThrownBy(() -> service(null, dir, 14).backUpNow())
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not set up");
    }

    @Test
    @DisplayName("Lists only its own files, newest first, and prunes to the newest N")
    void shouldListAndPrune(@TempDir Path dir) throws Exception {
        Path tool = Files.createFile(dir.resolve("pg_dump.exe"));
        Path backups = Files.createDirectory(dir.resolve("backups"));
        for (String name : new String[]{"storex-20260901-100000.dump", "storex-20260902-100000.dump",
                "storex-20260903-100000.dump", "storex-pre-restore-20260901-090000.dump", "notes.txt"}) {
            Files.writeString(backups.resolve(name), "x");
        }
        DatabaseBackupService svc = service(tool, backups, 2);

        assertThat(svc.list()).extracting(DatabaseBackupService.BackupFile::name)
                .containsExactly("storex-20260903-100000.dump", "storex-20260902-100000.dump", "storex-20260901-100000.dump");

        svc.prune();

        assertThat(svc.list()).extracting(DatabaseBackupService.BackupFile::name)
                .containsExactly("storex-20260903-100000.dump", "storex-20260902-100000.dump");
        // A restore's safety copy is never the scheduler's to delete.
        assertThat(backups.resolve("storex-pre-restore-20260901-090000.dump")).exists();
    }

    @Test
    @DisplayName("Serves only its own file names — no path tricks")
    void shouldResolveOnlyOwnNames(@TempDir Path dir) throws Exception {
        Path tool = Files.createFile(dir.resolve("pg_dump.exe"));
        Files.writeString(dir.resolve("storex-20260903-100000.dump"), "x");
        DatabaseBackupService svc = service(tool, dir, 14);

        assertThat(svc.resolve("storex-20260903-100000.dump")).exists();
        for (String bad : new String[]{"../db.properties", "..\\db.properties", "pg_dump.exe",
                "storex-20260903-100000.dump/../../x", "storex-20260904-100000.dump"}) {
            assertThatThrownBy(() -> svc.resolve(bad)).as(bad).isInstanceOf(BusinessException.class);
        }
    }
}
