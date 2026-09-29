package com.lumora.pos.audit;

/**
 * Defines all trackable actions for the audit log.
 * Each action maps directly to the `action` VARCHAR(50) column in the
 * `audit_log` table.
 *
 * Organized by module for clarity:
 * - General CRUD: CREATE, UPDATE, DELETE
 * - Authentication: LOGIN, LOGIN_PIN, LOGOUT, LOGIN_FAILED
 * - Sales: SALE_CREATE, SALE_VOID, SALE_REFUND
 * - Inventory: STOCK_ADJUST
 * - Customer: LOYALTY_ADJUST
 */
public enum AuditAction {

    // --- General CRUD ---
    CREATE("CREATE"),
    UPDATE("UPDATE"),
    DELETE("DELETE"),

    // --- Authentication ---
    LOGIN("LOGIN"),
    LOGIN_PIN("LOGIN_PIN"),
    LOGIN_FAILED("LOGIN_FAILED"),
    LOGOUT("LOGOUT"),
    PASSWORD_CHANGED("PASSWORD_CHANGED"),
    PASSWORD_RESET("PASSWORD_RESET"),

    // --- Sales / Financial ---
    SALE_CREATE("SALE_CREATE"),
    SALE_VOID("SALE_VOID"),
    SALE_REFUND("SALE_REFUND"),
    SALE_PAYMENT_CORRECT("SALE_PAYMENT_CORRECT"),

    // --- Inventory ---
    STOCK_ADJUST("STOCK_ADJUST"),

    // --- Customer / Loyalty ---
    LOYALTY_ADJUST("LOYALTY_ADJUST"),

    // --- Operations / Hardware ---
    OPEN_DRAWER("OPEN_DRAWER"),

    // --- Restaurant kitchen ---
    KITCHEN_TICKET_FIRE("KITCHEN_TICKET_FIRE"),
    KITCHEN_TICKET_VOID("KITCHEN_TICKET_VOID"),
    KITCHEN_TICKET_REPRINT("KITCHEN_TICKET_REPRINT"),
    KITCHEN_PRINT_FAILED("KITCHEN_PRINT_FAILED"),
    KITCHEN_PRINT_HANDLED("KITCHEN_PRINT_HANDLED"),

    // --- Super Admin (platform plane) ---
    SUPER_ADMIN_LOGIN("SUPER_ADMIN_LOGIN"),
    SUPER_ADMIN_LOGIN_FAILED("SUPER_ADMIN_LOGIN_FAILED"),
    SUPER_ADMIN_LOGIN_LOCKED("SUPER_ADMIN_LOGIN_LOCKED"),
    SUPER_ADMIN_LOGOUT("SUPER_ADMIN_LOGOUT"),
    SUPER_ADMIN_PASSWORD_CHANGED("SUPER_ADMIN_PASSWORD_CHANGED"),
    TENANT_PROVISIONED("TENANT_PROVISIONED"),
    TENANT_SUSPENDED("TENANT_SUSPENDED"),
    TENANT_REACTIVATED("TENANT_REACTIVATED"),
    TENANT_CONFIG_UPDATED("TENANT_CONFIG_UPDATED"),
    TENANT_USER_PASSWORD_RESET("TENANT_USER_PASSWORD_RESET");

    private final String value;

    AuditAction(String value) {
        this.value = value;
    }

    /**
     * Returns the string value stored in the database.
     */
    public String getValue() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
