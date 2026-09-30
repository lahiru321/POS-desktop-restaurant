package com.lumora.pos.inventory.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CategoryResponse {

    private UUID id;
    private String name;
    private String slug;
    private String description;
    private UUID parentId;
    private UUID taxRateId;
    private String taxRateName;
    private String kitchenStation;
    private LocalDateTime createdAt;
}
