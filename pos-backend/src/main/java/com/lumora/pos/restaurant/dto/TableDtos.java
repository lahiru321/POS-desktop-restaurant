package com.lumora.pos.restaurant.dto;

import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * Request/response shapes for floor areas and tables.
 *
 * <p>Grouped in one file because they are small and always used together.
 *
 * <p>No request carries {@code status}: a table becomes OCCUPIED because an
 * order was opened on it and AVAILABLE because that order was settled or
 * voided. Letting a client post the status would let the floor disagree with
 * the orders it is meant to reflect.
 */
public final class TableDtos {

    private TableDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AreaRequest {
        @NotBlank(message = "Area name is required")
        @Size(max = 100)
        private String name;

        private Integer sortOrder;

        @Builder.Default
        private boolean isActive = true;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TableRequest {
        @NotNull(message = "An area is required")
        private UUID areaId;

        @NotBlank(message = "Table name is required")
        @Size(max = 50)
        private String name;

        @Positive(message = "A table seats at least one")
        @Max(value = 99, message = "That is a hall, not a table")
        private Integer seats;

        private Integer sortOrder;

        @Builder.Default
        private boolean isActive = true;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TableResponse {
        private UUID id;
        private UUID areaId;
        private String areaName;
        private String name;
        private int seats;
        /** Server-owned; see the class javadoc. */
        private RestaurantTableEntity.TableStatus status;
        private int sortOrder;
        private boolean isActive;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AreaResponse {
        private UUID id;
        private String name;
        private int sortOrder;
        private boolean isActive;
        /** The area's tables, in floor order. Empty for a freshly created area. */
        private List<TableResponse> tables;
    }
}
