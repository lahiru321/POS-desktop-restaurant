package com.lumora.pos.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Global Jackson customization for timestamp serialization.
 *
 * Entities hold instants as {@link LocalDateTime}. The database stores them in UTC
 * ({@code hibernate.jdbc.time_zone: UTC}), but Hibernate converts on the way in and
 * out, so inside the JVM every {@code LocalDateTime} — read from the database or made
 * by {@code LocalDateTime.now()} — is wall-clock time in the <em>JVM's</em> zone.
 *
 * The default jsr310 serializer writes that as a naive string with no zone marker,
 * which a browser reads as its own local time. So each value is written with the
 * JVM zone's offset: {@code 2026-05-28T09:00:00Z} on a UTC container,
 * {@code 2026-05-28T14:30:00+05:30} on a Colombo desktop. Both are the same instant,
 * and the client converts either to its own zone correctly.
 *
 * This used to hard-code {@code Z}. That was right only on a UTC JVM: the desktop
 * build runs on the till's own zone, so every timestamp reached the browser 5h30m in
 * the future and the till's shift clock counted down into negative time.
 *
 * Note: a small number of request-side {@code LocalDateTime} fields are user-entered
 * wall-clock dates (PurchaseOrderRequest.expectedDate, TenantConfigurationRequest
 * .subscriptionEnd). They are typically midnight date-picker values and are not
 * affected by how responses are serialized.
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer localDateTimeOffsetCustomizer() {
        return builder -> builder.serializerByType(LocalDateTime.class, new ZonedLocalDateTimeSerializer());
    }

    static class ZonedLocalDateTimeSerializer extends JsonSerializer<LocalDateTime> {
        private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

        private final ZoneId zone;

        ZonedLocalDateTimeSerializer() {
            this(ZoneId.systemDefault());
        }

        /** For tests: the zone the JVM would otherwise supply. */
        ZonedLocalDateTimeSerializer(ZoneId zone) {
            this.zone = zone;
        }

        @Override
        public void serialize(LocalDateTime value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
            // atZone, not atOffset: the offset is looked up for that moment, so a
            // zone with daylight saving gets the right one either side of a change.
            gen.writeString(value.atZone(zone).toOffsetDateTime().format(FORMATTER));
        }
    }
}
