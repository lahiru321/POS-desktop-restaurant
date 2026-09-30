package com.lumora.pos.licensing.service;

import com.lumora.pos.licensing.config.LicenseProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jws;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.util.Date;

/**
 * Second, independent license enforcement layer for the desktop build.
 *
 * <p>Verifies the signed license at startup with the JAR-baked public key (see
 * {@link LicenseVerifier}) and confirms it is bound to this machine. Because the
 * check runs in {@code @PostConstruct}, throwing here aborts the Spring context
 * before the web server starts — so even if the Electron launcher's JavaScript
 * checks are patched out, the backend simply refuses to serve and the POS is
 * inert.</p>
 */
@Slf4j
@Component
@Profile("desktop")
@RequiredArgsConstructor
public class LicenseGuard {

    private final LicenseProperties properties;
    private final LicenseVerifier verifier;
    private final MachineFingerprint machineFingerprint;

    /** What was verified at startup, for {@link #status()}. */
    private volatile Instant expiresAt;
    private volatile String customer;
    private volatile String edition;

    @PostConstruct
    void enforce() {
        String token = properties.getToken();
        if (token == null || token.isBlank()) {
            fail("no license token was provided to the backend");
        }

        Claims claims;
        try {
            Jws<Claims> jws = verifier.verify(token);
            claims = jws.getPayload();
        } catch (ExpiredJwtException e) {
            // jjwt checks the signature before the expiry, so these claims are genuine.
            // Past its date but inside the grace period: start, and let the till warn.
            claims = e.getClaims();
            Instant expired = claims.getExpiration().toInstant();
            if (LicensePolicy.state(expired, Instant.now()) == LicensePolicy.State.EXPIRED) {
                fail("the license expired on " + expired.atZone(ZoneId.systemDefault()).toLocalDate()
                        + " and its " + LicensePolicy.GRACE.toDays() + "-day grace period has ended");
            }
            log.warn("License expired on {} — running in its grace period until {}.",
                    expired, LicensePolicy.graceEnds(expired));
        } catch (Exception e) {
            fail("the license signature is invalid");
            return; // unreachable
        }

        String licensedFingerprint = claims.get("fp", String.class);
        if (licensedFingerprint == null || licensedFingerprint.isBlank()) {
            fail("the license is missing its machine binding");
        }

        String actualFingerprint = machineFingerprint.compute();
        if (actualFingerprint != null) {
            // Normal path: the backend independently recomputed the fingerprint.
            if (!actualFingerprint.equals(licensedFingerprint)) {
                fail("the license is bound to a different machine");
            }
        } else {
            // Couldn't read the hardware id here — fall back to the launcher's value.
            // The signature was still independently verified above.
            String launcherFingerprint = properties.getMachineFingerprint();
            if (launcherFingerprint == null || !launcherFingerprint.equals(licensedFingerprint)) {
                fail("unable to confirm this machine's identity");
            }
        }

        Date exp = claims.getExpiration();
        this.expiresAt = exp == null ? null : exp.toInstant();
        this.customer = claims.get("customer", String.class);
        this.edition = claims.get("edition", String.class);
        log.info("Desktop license verified for '{}' (edition {}).", customer, edition);
    }

    /** The license as of now — days left keep counting while the till stays open. */
    public LicensePolicy.Status status() {
        return LicensePolicy.status(expiresAt, Instant.now(), customer, edition);
    }

    private void fail(String reason) {
        throw new IllegalStateException("Lumora POS cannot start — license check failed: " + reason);
    }
}
