package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.restaurant.dto.TableDtos;
import com.lumora.pos.restaurant.entity.RestaurantAreaEntity;
import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import com.lumora.pos.restaurant.repository.RestaurantAreaRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Authoring of the floor plan: areas and the tables in them.
 *
 * <p>This service owns the layout, never the service state. A table's
 * {@code status} changes only as a side effect of the order lifecycle, so
 * nothing here sets it — see {@link RestaurantTableEntity}.
 */
@Service
@RequiredArgsConstructor
public class TableService {

    private final RestaurantAreaRepository areaRepository;
    private final RestaurantTableRepository tableRepository;
    private final AuditService auditService;

    // ------------------------------------------------------------------
    // Areas
    // ------------------------------------------------------------------

    /** The floor read: every area with its tables nested, in floor order. */
    @Transactional(readOnly = true)
    public List<TableDtos.AreaResponse> listAreas() {
        UUID tenantId = TenantContext.getTenantId();
        Map<UUID, List<RestaurantTableEntity>> byArea =
                tableRepository.findAllByTenantIdOrderBySortOrderAscNameAsc(tenantId).stream()
                        .collect(Collectors.groupingBy(t -> t.getArea().getId()));

        return areaRepository.findAllByTenantIdOrderBySortOrderAscNameAsc(tenantId).stream()
                .map(area -> toResponse(area, byArea.getOrDefault(area.getId(), List.of())))
                .toList();
    }

    @Transactional
    public TableDtos.AreaResponse createArea(TableDtos.AreaRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        RestaurantAreaEntity area = RestaurantAreaEntity.builder()
                .name(request.getName().trim())
                .sortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0)
                .isActive(request.isActive())
                .build();
        area.setTenantId(tenantId);

        RestaurantAreaEntity saved = areaRepository.save(area);
        TableDtos.AreaResponse response = toResponse(saved, List.of());
        auditService.logCreate("RESTAURANT_AREA", saved.getId(), response);
        return response;
    }

    @Transactional
    public TableDtos.AreaResponse updateArea(UUID id, TableDtos.AreaRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantAreaEntity area = areaRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Area not found"));

        area.setName(request.getName().trim());
        if (request.getSortOrder() != null) {
            area.setSortOrder(request.getSortOrder());
        }
        area.setActive(request.isActive());

        RestaurantAreaEntity saved = areaRepository.save(area);
        List<RestaurantTableEntity> tables =
                tableRepository.findAllByTenantIdAndAreaIdOrderBySortOrderAscNameAsc(tenantId, id);
        TableDtos.AreaResponse response = toResponse(saved, tables);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_AREA", id, null, response);
        return response;
    }

    /**
     * Refuses while the area still holds tables.
     *
     * <p>The database would refuse anyway — {@code restaurant_tables.area_id} has
     * no cascade — but a foreign-key error reaches the user as "could not
     * execute statement". Deactivating is almost always what was meant: it keeps
     * the tables, and with them every order ever taken on them.
     */
    @Transactional
    public void deleteArea(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantAreaEntity area = areaRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Area not found"));

        long tables = tableRepository.countByTenantIdAndAreaId(tenantId, id);
        if (tables > 0) {
            throw new BusinessException("This area still has " + tables
                    + " table(s). Move or delete them first, or deactivate the area instead.");
        }

        areaRepository.delete(area);
        auditService.log(AuditAction.DELETE, "RESTAURANT_AREA", id, Map.of("name", area.getName()), null);
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<TableDtos.TableResponse> listTables(UUID areaId) {
        UUID tenantId = TenantContext.getTenantId();
        List<RestaurantTableEntity> tables = areaId != null
                ? tableRepository.findAllByTenantIdAndAreaIdOrderBySortOrderAscNameAsc(tenantId, areaId)
                : tableRepository.findAllByTenantIdOrderBySortOrderAscNameAsc(tenantId);
        return tables.stream().map(this::toResponse).toList();
    }

    @Transactional
    public TableDtos.TableResponse createTable(TableDtos.TableRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantAreaEntity area = areaRepository.findByIdAndTenantId(request.getAreaId(), tenantId)
                .orElseThrow(() -> new BusinessException("Area not found"));

        String name = request.getName().trim();
        requireNameFree(tenantId, area.getId(), name);

        RestaurantTableEntity table = RestaurantTableEntity.builder()
                .area(area)
                .name(name)
                .seats(request.getSeats() != null ? request.getSeats() : 2)
                .status(RestaurantTableEntity.TableStatus.AVAILABLE)
                .sortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0)
                .isActive(request.isActive())
                .build();
        table.setTenantId(tenantId);

        RestaurantTableEntity saved = tableRepository.save(table);
        TableDtos.TableResponse response = toResponse(saved);
        auditService.logCreate("RESTAURANT_TABLE", saved.getId(), response);
        return response;
    }

    /**
     * Renaming or moving a table leaves its status alone: a table being carried
     * from the Balcony to the Garden mid-service is still occupied.
     */
    @Transactional
    public TableDtos.TableResponse updateTable(UUID id, TableDtos.TableRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantTableEntity table = tableRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));
        RestaurantAreaEntity area = areaRepository.findByIdAndTenantId(request.getAreaId(), tenantId)
                .orElseThrow(() -> new BusinessException("Area not found"));

        String name = request.getName().trim();
        boolean moved = !area.getId().equals(table.getArea().getId());
        boolean renamed = !name.equalsIgnoreCase(table.getName());
        if (moved || renamed) {
            requireNameFree(tenantId, area.getId(), name);
        }

        table.setArea(area);
        table.setName(name);
        if (request.getSeats() != null) {
            table.setSeats(request.getSeats());
        }
        if (request.getSortOrder() != null) {
            table.setSortOrder(request.getSortOrder());
        }
        table.setActive(request.isActive());

        RestaurantTableEntity saved = tableRepository.save(table);
        TableDtos.TableResponse response = toResponse(saved);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_TABLE", id, null, response);
        return response;
    }

    /**
     * Refuses an occupied table — deleting one out from under an open tab would
     * strand the order its server is still adding rounds to.
     *
     * <p>Once orders exist (V63) this also needs to keep tables that carry
     * settled history, or the floor loses the link from a past sale to where it
     * was eaten. Deactivating covers that case today.
     */
    @Transactional
    public void deleteTable(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantTableEntity table = tableRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));

        if (table.getStatus() == RestaurantTableEntity.TableStatus.OCCUPIED) {
            throw new BusinessException("This table has an open tab. Settle or void it first.");
        }

        tableRepository.delete(table);
        auditService.log(AuditAction.DELETE, "RESTAURANT_TABLE", id, Map.of("name", table.getName()), null);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Callers check only when the name or the area actually changed, so any row
     * found here belongs to a different table — the clash is always real.
     */
    private void requireNameFree(UUID tenantId, UUID areaId, String name) {
        if (tableRepository.existsByTenantIdAndAreaIdAndNameIgnoreCase(tenantId, areaId, name)) {
            throw new BusinessException("This area already has a table called \"" + name + "\"");
        }
    }

    private TableDtos.AreaResponse toResponse(RestaurantAreaEntity area, List<RestaurantTableEntity> tables) {
        return TableDtos.AreaResponse.builder()
                .id(area.getId())
                .name(area.getName())
                .sortOrder(area.getSortOrder())
                .isActive(area.isActive())
                .tables(tables.stream().map(this::toResponse).toList())
                .build();
    }

    private TableDtos.TableResponse toResponse(RestaurantTableEntity table) {
        return TableDtos.TableResponse.builder()
                .id(table.getId())
                .areaId(table.getArea().getId())
                .areaName(table.getArea().getName())
                .name(table.getName())
                .seats(table.getSeats())
                .status(table.getStatus())
                .sortOrder(table.getSortOrder())
                .isActive(table.isActive())
                .build();
    }
}
