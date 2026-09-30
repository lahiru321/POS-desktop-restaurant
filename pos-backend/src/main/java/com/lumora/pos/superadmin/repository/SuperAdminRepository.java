package com.lumora.pos.superadmin.repository;

import com.lumora.pos.superadmin.entity.SuperAdminEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for SuperAdminEntity.
 * Queries the platform-level `super_admins` table.
 * No tenant scoping — operates across all tenants.
 */
@Repository
public interface SuperAdminRepository extends JpaRepository<SuperAdminEntity, UUID> {

    Optional<SuperAdminEntity> findByEmail(String email);

    Optional<SuperAdminEntity> findByEmailAndIsActive(String email, boolean isActive);

    boolean existsByEmail(String email);

    /** True when some super-admin can log in — the desktop console opens only then. */
    boolean existsByIsActiveTrue();
}
