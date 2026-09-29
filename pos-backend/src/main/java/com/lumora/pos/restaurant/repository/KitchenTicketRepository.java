package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.KitchenTicketEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface KitchenTicketRepository extends JpaRepository<KitchenTicketEntity, UUID> {

    Optional<KitchenTicketEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<KitchenTicketEntity> findAllByTenantIdAndOrder_IdOrderByRoundNoAsc(UUID tenantId, UUID orderId);

    /**
     * What the till's red badge counts: every FAILED ticket, plus every PENDING
     * one older than {@code pendingBefore}.
     *
     * <p>A PENDING ticket is normally mid-print for a second or two, and flashing
     * the badge for that would train people to ignore it. Past the grace period,
     * PENDING means the till never reported back — browser closed, machine died —
     * and that is a failure the kitchen may not know about. Measured from the
     * last change, so a reprint gets the same grace as a first print.
     */
    @Query("""
            SELECT t FROM KitchenTicketEntity t
            WHERE t.tenantId = :tenantId
              AND (t.status = com.lumora.pos.restaurant.entity.KitchenTicketEntity.TicketStatus.FAILED
                   OR (t.status = com.lumora.pos.restaurant.entity.KitchenTicketEntity.TicketStatus.PENDING
                       AND COALESCE(t.updatedAt, t.createdAt) < :pendingBefore))
            ORDER BY t.createdAt ASC
            """)
    List<KitchenTicketEntity> findUnresolved(
            @Param("tenantId") UUID tenantId, @Param("pendingBefore") LocalDateTime pendingBefore);
}
