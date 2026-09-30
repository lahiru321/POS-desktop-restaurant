package com.lumora.pos.system.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.system.service.DatabaseBackupService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;

/**
 * Settings → Backups. ADMIN only: a backup holds every sale, customer and
 * user hash in the business, so downloading one is the same trust as owning it.
 */
@RestController
@RequestMapping("/api/v1/system/backups")
@RequiredArgsConstructor
public class BackupController {

    private final DatabaseBackupService backupService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<DatabaseBackupService.BackupStatus>> status() {
        return ResponseEntity.ok(ApiResponse.<DatabaseBackupService.BackupStatus>builder()
                .success(true)
                .message("Backups")
                .data(backupService.status())
                .build());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<DatabaseBackupService.BackupFile>> backUpNow() {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<DatabaseBackupService.BackupFile>builder()
                        .success(true)
                        .message("Backup complete")
                        .data(backupService.backUpNow())
                        .build());
    }

    /** The dump itself, to save somewhere else — a USB stick, another PC. */
    @GetMapping("/{name}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        Path file = backupService.resolve(name);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(name).build().toString())
                .body(new FileSystemResource(file));
    }
}
