package com.lumora.pos.inventory.service;

import java.util.Locale;

/**
 * The one spelling of a kitchen station name.
 *
 * <p>A station is a free-text code ({@code BAR}, {@code GRILL}) matched by
 * string equality twice: when a round is split into one ticket per station, and
 * on each till, where {@code kitchenStationTargets} maps it to a printer. So
 * "bar", "Bar " and "BAR" must be the same station, or a dish silently prints on
 * the default kitchen printer. Everything that stores a station goes through
 * {@link #normalize}.
 */
public final class KitchenStations {

    /** Where a dish prints when neither it nor its category names a station. */
    public static final String DEFAULT = "KITCHEN";

    /** Mirrors the {@code VARCHAR(20)} columns from V64. */
    public static final int MAX_LENGTH = 20;

    /** Letters, digits, space, underscore and hyphen — what fits a ticket header. */
    public static final String PATTERN = "^[A-Za-z0-9 _-]*$";

    private KitchenStations() {
    }

    /** Trimmed, inner spaces collapsed, upper-cased; blank becomes {@code null} ("inherit"). */
    public static String normalize(String station) {
        if (station == null) {
            return null;
        }
        String s = station.trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
        return s.isEmpty() ? null : s;
    }
}
