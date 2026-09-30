package com.lumora.pos.inventory.dto;

import com.lumora.pos.inventory.service.KitchenStations;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CategoryRequest {

    @NotBlank(message = "Category name is required")
    private String name;

    private String description;

    private String slug;

    private UUID parentId;

    private UUID taxRateId;

    /**
     * Which kitchen printer this goes to ({@code BAR}, {@code GRILL}). Blank means
     * {@code KITCHEN}. Normalized to upper case on save.
     */
    @Size(max = KitchenStations.MAX_LENGTH, message = "Kitchen station must be 20 characters or fewer")
    @Pattern(regexp = KitchenStations.PATTERN,
            message = "Kitchen station may only contain letters, numbers, spaces, '-' and '_'")
    private String kitchenStation;
}
