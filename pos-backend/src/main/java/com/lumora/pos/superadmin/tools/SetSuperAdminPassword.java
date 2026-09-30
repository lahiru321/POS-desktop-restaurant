package com.lumora.pos.superadmin.tools;

import com.lumora.pos.superadmin.service.DesktopSuperAdminLockdown;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * "StoreX Restaurant - Set super-admin password": sets the Lumora support login
 * on an installed till, for installs set up before the wizard asked for one, or
 * when the password is lost.
 *
 * <p>Run by {@code set-superadmin-password.ps1} as a Windows administrator, which
 * reads the database credentials from {@code db.properties} and runs this class
 * out of the backend jar with the bundled JRE. No Spring context — plain JDBC.
 * Everything comes in through environment variables, never the command line,
 * where other processes could read the password.
 *
 * <p>Takes over the migration-seeded account (or the one with this email) rather
 * than adding another, and makes it usable at once: active, unlocked, no forced
 * change. The running backend picks it up on the next request.
 */
public final class SetSuperAdminPassword {

    private SetSuperAdminPassword() {
    }

    public static void main(String[] args) {
        String url = System.getenv("DB_URL");
        String user = System.getenv("DB_USER");
        String dbPassword = System.getenv("DB_PASSWORD");
        String email = System.getenv("SUPERADMIN_EMAIL");
        String password = System.getenv("SUPERADMIN_PASSWORD");
        if (url == null || user == null) {
            System.err.println("DB_URL and DB_USER are required.");
            System.exit(2);
        }
        String problem = check(email, password);
        if (problem != null) {
            System.err.println(problem);
            System.exit(2);
        }
        try (Connection c = DriverManager.getConnection(url, user, dbPassword)) {
            String action = apply(c, email, password, new BCryptPasswordEncoder());
            System.out.println("Super-admin " + normalize(email) + " " + action + ".");
        } catch (SQLException e) {
            System.err.println("Could not update the database: " + e.getMessage());
            System.exit(1);
        }
    }

    /** Why these credentials cannot be used, or null. */
    public static String check(String email, String password) {
        if (email == null || !normalize(email).matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            return "Enter a valid email address.";
        }
        if (password == null || password.length() < 8) {
            return "The password must be at least 8 characters.";
        }
        if (password.equals(DesktopSuperAdminLockdown.PUBLISHED_DEFAULT_PASSWORD)) {
            return "That is the published default password - choose your own.";
        }
        return null;
    }

    /**
     * Sets the super-admin in one transaction.
     *
     * @return "updated", "took over the default account" or "created"
     */
    public static String apply(Connection c, String email, String password, PasswordEncoder encoder)
            throws SQLException {
        String problem = check(email, password);
        if (problem != null) {
            throw new IllegalArgumentException(problem);
        }
        String normalized = normalize(email);
        String hash = encoder.encode(password);
        boolean autoCommit = c.getAutoCommit();
        c.setAutoCommit(false);
        try {
            String set = "SET email = ?, password_hash = ?, is_active = TRUE, password_change_required = FALSE, "
                    + "failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() ";
            String action;
            if (update(c, "UPDATE super_admins " + set + "WHERE lower(email) = ?", normalized, hash, normalized) > 0) {
                action = "updated";
            } else if (update(c, "UPDATE super_admins " + set + "WHERE lower(email) = ?", normalized, hash,
                    DesktopSuperAdminLockdown.SEEDED_EMAIL) > 0) {
                action = "took over the default account";
            } else {
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO super_admins (email, password_hash, first_name, last_name, is_active, "
                                + "password_change_required) VALUES (?, ?, 'Lumora', 'Support', TRUE, FALSE)")) {
                    ps.setString(1, normalized);
                    ps.setString(2, hash);
                    ps.executeUpdate();
                }
                action = "created";
            }
            c.commit();
            return action;
        } catch (SQLException | RuntimeException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(autoCommit);
        }
    }

    private static int update(Connection c, String sql, String email, String hash, String where) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, email);
            ps.setString(2, hash);
            ps.setString(3, where);
            return ps.executeUpdate();
        }
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }
}
