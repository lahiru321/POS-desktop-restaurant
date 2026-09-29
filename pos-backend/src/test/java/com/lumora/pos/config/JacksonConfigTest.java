package com.lumora.pos.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A LocalDateTime inside the JVM is wall-clock time in the JVM's zone, so it must
 * go out tagged with that zone's offset. Hard-coding "Z" put every timestamp on a
 * Colombo desktop 5h30m in the future — the till's shift clock ran negative.
 */
class JacksonConfigTest {

    private static String write(LocalDateTime value, ZoneId zone) throws Exception {
        ObjectMapper mapper = new ObjectMapper().registerModule(new SimpleModule()
                .addSerializer(LocalDateTime.class, new JacksonConfig.ZonedLocalDateTimeSerializer(zone)));
        return mapper.readValue(mapper.writeValueAsString(value), String.class);
    }

    @Test
    @DisplayName("On a Colombo till, 14:30 local goes out as +05:30 — the right instant")
    void shouldTagColomboWallClock() throws Exception {
        String json = write(LocalDateTime.of(2026, 9, 29, 14, 30), ZoneId.of("Asia/Colombo"));

        assertThat(json).isEqualTo("2026-09-29T14:30:00+05:30");
        assertThat(OffsetDateTime.parse(json).toInstant()).isEqualTo(Instant.parse("2026-09-29T09:00:00Z"));
    }

    @Test
    @DisplayName("On a UTC container nothing changes: still tagged Z")
    void shouldKeepUtcOnUtcJvm() throws Exception {
        assertThat(write(LocalDateTime.of(2026, 9, 29, 9, 0), ZoneId.of("UTC")))
                .isEqualTo("2026-09-29T09:00:00Z");
    }

    @Test
    @DisplayName("'Now' on the JVM clock reads as now, not hours away, in the JVM's own zone")
    void shouldRoundTripNow() throws Exception {
        ZoneId zone = ZoneId.of("Asia/Colombo");
        Instant before = Instant.now();
        String json = write(LocalDateTime.now(zone), zone);

        assertThat(OffsetDateTime.parse(json).toInstant())
                .isBetween(before.minusSeconds(1), Instant.now().plusSeconds(1));
    }
}
