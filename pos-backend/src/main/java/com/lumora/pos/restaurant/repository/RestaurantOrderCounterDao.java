package com.lumora.pos.restaurant.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Allocates the next order number for a (tenant, branch, business date).
 *
 * <p>Raw JDBC on purpose — the precedent is {@code SuperAdminTenantService}'s
 * branch insert. One atomic statement, so two servers opening tabs in the same
 * second get 14 and 15 without either blocking and without the
 * {@code SELECT MAX(order_number) + 1} race that would hand both the same
 * number. {@code uk_rest_order_number} is the backstop if this is ever bypassed.
 */
@Repository
@RequiredArgsConstructor
public class RestaurantOrderCounterDao {

    private static final String ALLOCATE = """
            INSERT INTO restaurant_order_counters (tenant_id, branch_id, business_date, last_number)
            VALUES (?, ?, ?, 1)
            ON CONFLICT (tenant_id, branch_id, business_date)
            DO UPDATE SET last_number = restaurant_order_counters.last_number + 1
            RETURNING last_number
            """;

    private final JdbcTemplate jdbcTemplate;

    public int nextOrderNumber(UUID tenantId, UUID branchId, LocalDate businessDate) {
        Integer next = jdbcTemplate.queryForObject(
                ALLOCATE, Integer.class, tenantId, branchId, java.sql.Date.valueOf(businessDate));
        if (next == null) {
            throw new IllegalStateException("Order number allocation returned no row");
        }
        return next;
    }
}
