package com.lumora.pos.restaurant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Lombok turns {@code boolean isActive} into {@code isActive()}/{@code setActive()},
 * which Jackson names {@code active}. The client sends and reads {@code isActive},
 * so without {@code @JsonProperty("isActive")} every table and topping reads as
 * hidden on the floor and the Hide/Active toggle is silently dropped. (Jackson
 * still also emits the getter-derived {@code active}; the client ignores it.)
 */
class RestaurantDtoJsonTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("Table and area responses serialise isActive")
    void tableResponsesUseIsActive() {
        JsonNode area = mapper.valueToTree(TableDtos.AreaResponse.builder()
                .isActive(true)
                .tables(java.util.List.of(TableDtos.TableResponse.builder().isActive(true).build()))
                .build());

        assertThat(area.get("isActive").asBoolean()).isTrue();
        assertThat(area.get("tables").get(0).get("isActive").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("Table and area requests honour isActive=false from the client")
    void tableRequestsReadIsActive() throws Exception {
        TableDtos.AreaRequest area = mapper.readValue(
                "{\"name\":\"Patio\",\"isActive\":false}", TableDtos.AreaRequest.class);
        TableDtos.TableRequest table = mapper.readValue(
                "{\"name\":\"T1\",\"isActive\":false}", TableDtos.TableRequest.class);

        assertThat(area.isActive()).isFalse();
        assertThat(table.isActive()).isFalse();
    }

    @Test
    @DisplayName("Topping DTOs use isActive both ways")
    void toppingDtosUseIsActive() throws Exception {
        JsonNode topping = mapper.valueToTree(ToppingDtos.ToppingResponse.builder().isActive(true).build());
        JsonNode group = mapper.valueToTree(ToppingDtos.GroupResponse.builder().isActive(true).build());
        assertThat(topping.get("isActive").asBoolean()).isTrue();
        assertThat(group.get("isActive").asBoolean()).isTrue();

        ToppingDtos.ToppingUpsertRequest toppingReq = mapper.readValue(
                "{\"isActive\":false}", ToppingDtos.ToppingUpsertRequest.class);
        ToppingDtos.GroupRequest groupReq = mapper.readValue(
                "{\"isActive\":false}", ToppingDtos.GroupRequest.class);
        assertThat(toppingReq.isActive()).isFalse();
        assertThat(groupReq.isActive()).isFalse();
    }
}
