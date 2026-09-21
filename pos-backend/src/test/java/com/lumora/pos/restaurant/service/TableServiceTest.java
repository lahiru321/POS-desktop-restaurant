package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.restaurant.dto.TableDtos;
import com.lumora.pos.restaurant.entity.RestaurantAreaEntity;
import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import com.lumora.pos.restaurant.repository.RestaurantAreaRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("TableService Unit Tests")
class TableServiceTest {

    @Mock
    private RestaurantAreaRepository areaRepository;

    @Mock
    private RestaurantTableRepository tableRepository;

    @Mock
    private AuditService auditService;

    @InjectMocks
    private TableService tableService;

    private UUID tenantId;
    private RestaurantAreaEntity area;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        area = RestaurantAreaEntity.builder().name("Balcony").build();
        area.setId(UUID.randomUUID());
        area.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ------------------------------------------------------------------
    // Tenant scoping — there is no automatic scoping, so every save must
    // stamp the tenant and every lookup must filter on it.
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Creating an area stamps the tenant from TenantContext")
    void shouldStampTenantOnArea() {
        when(areaRepository.save(any())).thenAnswer(inv -> {
            RestaurantAreaEntity saved = inv.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        tableService.createArea(TableDtos.AreaRequest.builder().name("Garden").build());

        ArgumentCaptor<RestaurantAreaEntity> captor = ArgumentCaptor.forClass(RestaurantAreaEntity.class);
        verify(areaRepository).save(captor.capture());
        assertThat(captor.getValue().getTenantId()).isEqualTo(tenantId);
        assertThat(captor.getValue().getName()).isEqualTo("Garden");
    }

    @Test
    @DisplayName("Creating a table stamps the tenant and defaults to AVAILABLE")
    void shouldStampTenantAndDefaultStatusOnTable() {
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        when(tableRepository.existsByTenantIdAndAreaIdAndNameIgnoreCase(tenantId, area.getId(), "T1"))
                .thenReturn(false);
        when(tableRepository.save(any())).thenAnswer(inv -> {
            RestaurantTableEntity saved = inv.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        TableDtos.TableResponse response = tableService.createTable(TableDtos.TableRequest.builder()
                .areaId(area.getId())
                .name("  T1  ")
                .seats(4)
                .build());

        ArgumentCaptor<RestaurantTableEntity> captor = ArgumentCaptor.forClass(RestaurantTableEntity.class);
        verify(tableRepository).save(captor.capture());
        assertThat(captor.getValue().getTenantId()).isEqualTo(tenantId);
        // Trimmed: " T1 " and "T1" must not become two tables.
        assertThat(captor.getValue().getName()).isEqualTo("T1");
        assertThat(captor.getValue().getSeats()).isEqualTo(4);
        assertThat(response.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
    }

    @Test
    @DisplayName("A table from another tenant is not found")
    void shouldNotFindForeignTable() {
        UUID foreignId = UUID.randomUUID();
        when(tableRepository.findByIdAndTenantId(foreignId, tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> tableService.deleteTable(foreignId))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Table not found");
    }

    // ------------------------------------------------------------------
    // Floor-plan invariants
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Two tables with the same name in one area are refused")
    void shouldRejectDuplicateTableNameInArea() {
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        // Case-insensitive on purpose: "t1" and "T1" on one balcony is a mis-click.
        when(tableRepository.existsByTenantIdAndAreaIdAndNameIgnoreCase(tenantId, area.getId(), "t1"))
                .thenReturn(true);

        assertThatThrownBy(() -> tableService.createTable(TableDtos.TableRequest.builder()
                .areaId(area.getId())
                .name("t1")
                .build()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("already has a table called");

        verify(tableRepository, never()).save(any());
    }

    @Test
    @DisplayName("The same table name in a different area is allowed")
    void shouldAllowSameNameInAnotherArea() {
        RestaurantAreaEntity garden = RestaurantAreaEntity.builder().name("Garden").build();
        garden.setId(UUID.randomUUID());
        garden.setTenantId(tenantId);

        when(areaRepository.findByIdAndTenantId(garden.getId(), tenantId)).thenReturn(Optional.of(garden));
        when(tableRepository.existsByTenantIdAndAreaIdAndNameIgnoreCase(tenantId, garden.getId(), "1"))
                .thenReturn(false);
        when(tableRepository.save(any())).thenAnswer(inv -> {
            RestaurantTableEntity saved = inv.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        TableDtos.TableResponse response = tableService.createTable(TableDtos.TableRequest.builder()
                .areaId(garden.getId())
                .name("1")
                .build());

        assertThat(response.getAreaName()).isEqualTo("Garden");
    }

    @Test
    @DisplayName("Renaming only the seats does not trip the duplicate check")
    void shouldNotCheckNameWhenOnlySeatsChange() {
        RestaurantTableEntity table = table("T1", RestaurantTableEntity.TableStatus.AVAILABLE);
        when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        when(tableRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tableService.updateTable(table.getId(), TableDtos.TableRequest.builder()
                .areaId(area.getId())
                .name("T1")
                .seats(6)
                .build());

        verify(tableRepository, never())
                .existsByTenantIdAndAreaIdAndNameIgnoreCase(any(), any(), any());
        assertThat(table.getSeats()).isEqualTo(6);
    }

    @Test
    @DisplayName("Editing a table never changes its status")
    void shouldLeaveStatusAloneOnUpdate() {
        RestaurantTableEntity table = table("T1", RestaurantTableEntity.TableStatus.OCCUPIED);
        when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        when(tableRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        TableDtos.TableResponse response = tableService.updateTable(table.getId(),
                TableDtos.TableRequest.builder()
                        .areaId(area.getId())
                        .name("T1")
                        .seats(2)
                        .build());

        // A table carried across the room mid-service is still occupied.
        assertThat(response.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.OCCUPIED);
    }

    @Test
    @DisplayName("Deleting an occupied table is refused")
    void shouldRefuseDeletingOccupiedTable() {
        RestaurantTableEntity table = table("T1", RestaurantTableEntity.TableStatus.OCCUPIED);
        when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));

        assertThatThrownBy(() -> tableService.deleteTable(table.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("open tab");

        verify(tableRepository, never()).delete(any());
    }

    @Test
    @DisplayName("Deleting an area that still holds tables is refused with a readable message")
    void shouldRefuseDeletingAreaWithTables() {
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        when(tableRepository.countByTenantIdAndAreaId(tenantId, area.getId())).thenReturn(3L);

        assertThatThrownBy(() -> tableService.deleteArea(area.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("3 table(s)");

        verify(areaRepository, never()).delete(any());
    }

    @Test
    @DisplayName("An empty area deletes cleanly")
    void shouldDeleteEmptyArea() {
        when(areaRepository.findByIdAndTenantId(area.getId(), tenantId)).thenReturn(Optional.of(area));
        when(tableRepository.countByTenantIdAndAreaId(tenantId, area.getId())).thenReturn(0L);

        tableService.deleteArea(area.getId());

        verify(areaRepository).delete(area);
    }

    private RestaurantTableEntity table(String name, RestaurantTableEntity.TableStatus status) {
        RestaurantTableEntity table = RestaurantTableEntity.builder()
                .area(area)
                .name(name)
                .seats(2)
                .status(status)
                .build();
        table.setId(UUID.randomUUID());
        table.setTenantId(tenantId);
        return table;
    }
}
