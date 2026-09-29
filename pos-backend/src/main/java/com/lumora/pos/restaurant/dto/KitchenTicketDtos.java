package com.lumora.pos.restaurant.dto;

import com.lumora.pos.restaurant.entity.KitchenTicketEntity;
import com.lumora.pos.restaurant.entity.RestaurantOrderEntity;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Kitchen tickets as the till prints them.
 *
 * <p>There is no price anywhere in these shapes, deliberately: a price on a
 * kitchen ticket is a bug, and the client builder never has one to print.
 */
public final class KitchenTicketDtos {

    private KitchenTicketDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class KitchenTicketResponse {
        private UUID id;
        private UUID orderId;
        private int orderNumber;
        /** "#0042-R2" / "#0042-R3-VOID". */
        private String label;
        private KitchenTicketEntity.TicketType ticketType;
        private int roundNo;
        private String station;
        private KitchenTicketEntity.TicketStatus status;
        private RestaurantOrderEntity.OrderType orderType;
        private String tableName;
        private int covers;
        private String serverName;
        private int printAttempts;
        private String lastError;
        /** MOVE tickets only: "MOVED FROM T4". */
        private String notice;
        /** When the ticket was fired — the time printed on the sheet. */
        private LocalDateTime firedAt;
        private LocalDateTime printedAt;
        private List<KitchenTicketItemResponse> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class KitchenTicketItemResponse {
        private String itemName;
        /** The delta for this sheet, not the line's running total. */
        private BigDecimal quantity;
        /** Add-ons, one per entry, as printed. */
        private List<String> modifiers;
        private String notes;
        private int courseNo;
    }

    /**
     * What happened when the till tried to print.
     *
     * <ul>
     *   <li>{@code PRINTED} — the printer accepted the job.</li>
     *   <li>{@code FAILED} — it did not; {@code note} carries the printer error.</li>
     *   <li>{@code HANDLED} — it did not, and a person took responsibility
     *       ("told the kitchen verbally"). Resolves the ticket, and {@code note}
     *       is required so the audit says who decided what.</li>
     * </ul>
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AckRequest {
        @NotNull(message = "outcome is required")
        private AckOutcome outcome;

        @Size(max = 400, message = "note must be 400 characters or fewer")
        private String note;

        @AssertTrue(message = "Say how the kitchen was told before marking a ticket handled")
        public boolean isNoteGivenWhenHandled() {
            return outcome != AckOutcome.HANDLED || (note != null && !note.isBlank());
        }
    }

    public enum AckOutcome {
        PRINTED,
        FAILED,
        HANDLED
    }
}
