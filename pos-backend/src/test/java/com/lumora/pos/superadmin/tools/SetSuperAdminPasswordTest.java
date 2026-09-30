package com.lumora.pos.superadmin.tools;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

/** On the real schema: every migration applied to an embedded PostgreSQL. */
@DisplayName("Set super-admin password tool")
class SetSuperAdminPasswordTest {

    private static EmbeddedPostgres postgres;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);

    @BeforeAll
    static void migrate() throws Exception {
        postgres = EmbeddedPostgres.builder()
                .setLocaleConfig("encoding", "UTF8")
                .setLocaleConfig("locale", "C")
                .start();
        Flyway.configure().dataSource(postgres.getPostgresDatabase())
                .locations("classpath:db/migration").load().migrate();
    }

    @AfterAll
    static void stop() throws Exception {
        postgres.close();
    }

    @Test
    @DisplayName("Takes over the seeded account, then updates it; the new password works at once")
    void shouldTakeOverThenUpdate() throws Exception {
        try (Connection c = postgres.getPostgresDatabase().getConnection()) {
            assertThat(SetSuperAdminPassword.apply(c, "Support@Lumora.lk", "first-Pass-123", encoder))
                    .isEqualTo("took over the default account");
            assertThat(SetSuperAdminPassword.apply(c, "support@lumora.lk", "second-Pass-456", encoder))
                    .isEqualTo("updated");

            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery("SELECT email, password_hash, is_active, password_change_required, "
                         + "failed_login_attempts, (SELECT count(*) FROM super_admins) AS n FROM super_admins")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("email")).isEqualTo("support@lumora.lk");
                assertThat(encoder.matches("second-Pass-456", rs.getString("password_hash"))).isTrue();
                assertThat(rs.getBoolean("is_active")).isTrue();
                assertThat(rs.getBoolean("password_change_required")).isFalse();
                assertThat(rs.getInt("failed_login_attempts")).isZero();
                assertThat(rs.getInt("n")).as("one support login, not two").isEqualTo(1);
            }
        }
    }

    @Test
    @DisplayName("Refuses a bad email, a short password, and the published default")
    void shouldRefuseBadInput() {
        assertThat(SetSuperAdminPassword.check("not-an-email", "long-enough-1")).contains("email");
        assertThat(SetSuperAdminPassword.check("a@b.lk", "short")).contains("8 characters");
        assertThat(SetSuperAdminPassword.check("a@b.lk", "SuperAdmin@2024")).contains("published default");
        assertThat(SetSuperAdminPassword.check("a@b.lk", "long-enough-1")).isNull();
    }
}
