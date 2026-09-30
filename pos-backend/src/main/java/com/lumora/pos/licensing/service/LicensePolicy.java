package com.lumora.pos.licensing.service;

import java.time.Duration;
import java.time.Instant;

/**
 * When a license expires, and what the till says about it.
 *
 * <p>An expired license used to stop the till at its next start, with no warning
 * — a restaurant could open for lunch to a POS that would not start and tabs it
 * could not settle. Now the till warns for {@link #WARN_BEFORE} beforehand, and
 * keeps working for {@link #GRACE} after the date while it says, in red, exactly
 * when it will stop. Only after that does it refuse to start. The Electron
 * launcher applies the same grace ({@code LICENSE_GRACE_DAYS}); keep them equal.
 */
public final class LicensePolicy {

    public static final Duration GRACE = Duration.ofDays(7);
    public static final Duration WARN_BEFORE = Duration.ofDays(30);

    public enum State {
        /** Perpetual, or more than {@link #WARN_BEFORE} away. */
        OK,
        /** Within {@link #WARN_BEFORE} of expiring. */
        EXPIRING,
        /** Past the date, inside {@link #GRACE}: still works, loudly. */
        GRACE,
        /** Past the grace period: the till does not start. */
        EXPIRED
    }

    public record Status(State state, Instant expiresAt, Instant graceEndsAt, Long daysLeft,
                         String customer, String edition) {
    }

    private LicensePolicy() {
    }

    public static Instant graceEnds(Instant expiresAt) {
        return expiresAt.plus(GRACE);
    }

    public static State state(Instant expiresAt, Instant now) {
        if (expiresAt == null) return State.OK;
        if (now.isBefore(expiresAt)) {
            return now.isBefore(expiresAt.minus(WARN_BEFORE)) ? State.OK : State.EXPIRING;
        }
        return now.isBefore(graceEnds(expiresAt)) ? State.GRACE : State.EXPIRED;
    }

    /**
     * {@code daysLeft} counts to the expiry date while it is ahead, then to the end
     * of the grace period — the date the till will actually stop.
     */
    public static Status status(Instant expiresAt, Instant now, String customer, String edition) {
        State state = state(expiresAt, now);
        if (expiresAt == null) {
            return new Status(state, null, null, null, customer, edition);
        }
        Instant counting = state == State.GRACE || state == State.EXPIRED ? graceEnds(expiresAt) : expiresAt;
        long days = Math.max(0, (long) Math.ceil(Duration.between(now, counting).toHours() / 24.0));
        return new Status(state, expiresAt, graceEnds(expiresAt), days, customer, edition);
    }
}
