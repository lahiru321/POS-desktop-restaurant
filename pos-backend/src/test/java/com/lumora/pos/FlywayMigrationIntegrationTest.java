package com.lumora.pos;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationState;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The check the rest of the suite cannot give: every migration, on a real
 * PostgreSQL, followed by Hibernate refusing to start on any entity/DDL drift.
 *
 * <p>Everything else runs on H2 with {@code ddl-auto: create-drop} and Flyway
 * off, so a migration that fails on Postgres, or an entity field with no column,
 * used to surface only on a real install — the one place it is hardest to fix.
 * If this context starts, Flyway applied the whole chain and
 * {@code ddl-auto=validate} agreed with it.
 *
 * <p>Embedded PostgreSQL 14 (zonky) — no Docker. The installed product runs 16;
 * the migrations use nothing newer than 14. Initialised UTF-8 / C locale on
 * purpose: a Windows-default WIN1252 cluster fails V16's box-drawing comments.
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("Flyway migrations on real PostgreSQL")
class FlywayMigrationIntegrationTest {

    private static EmbeddedPostgres postgres;

    @DynamicPropertySource
    static void realPostgres(DynamicPropertyRegistry registry) throws IOException {
        postgres = EmbeddedPostgres.builder()
                .setLocaleConfig("encoding", "UTF8")
                .setLocaleConfig("locale", "C")
                .start();
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "");
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        // Schema only, exactly as prod: no demo seeds.
        registry.add("spring.flyway.locations", () -> "classpath:db/migration");
    }

    @AfterAll
    static void stop() throws IOException {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Autowired
    private Flyway flyway;

    @Test
    @DisplayName("Applies every migration on disk, and Hibernate validates against the result")
    void appliesEveryMigration() throws IOException {
        MigrationInfo[] all = flyway.info().all();

        assertThat(all).as("migrations found").isNotEmpty();
        assertThat(Arrays.stream(all).map(MigrationInfo::getState))
                .as("every migration applied, none pending or failed")
                .allMatch(state -> state == MigrationState.SUCCESS);
        assertThat(flyway.info().current().getVersion().getVersion())
                .as("the database is at the newest migration on disk")
                .isEqualTo(String.valueOf(highestVersionOnDisk()));
    }

    /** The largest V&lt;n&gt; under db/migration — read from the files, not hard-coded. */
    private static int highestVersionOnDisk() throws IOException {
        Pattern version = Pattern.compile("^V(\\d+)__.*\\.sql$");
        int highest = 0;
        for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/*.sql")) {
            Matcher m = version.matcher(r.getFilename() == null ? "" : r.getFilename());
            if (m.matches()) {
                highest = Math.max(highest, Integer.parseInt(m.group(1)));
            }
        }
        return highest;
    }
}
