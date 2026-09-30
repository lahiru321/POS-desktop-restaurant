package com.lumora.pos.licensing.service;

import com.lumora.pos.licensing.config.LicenseProperties;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("License expiry: warning, grace, stop")
class LicenseGuardTest {

    private KeyPair keys;
    private LicenseProperties properties;
    private MachineFingerprint fingerprint;

    @BeforeEach
    void setUp() throws Exception {
        keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        properties = new LicenseProperties();
        properties.getSigning().setPublicKey(Base64.getEncoder().encodeToString(keys.getPublic().getEncoded()));
        fingerprint = mock(MachineFingerprint.class);
        when(fingerprint.compute()).thenReturn("fp-this-till");
    }

    /** A real signed license, expiring {@code fromNow} from now (negative = in the past). */
    private String license(Duration fromNow) {
        return Jwts.builder()
                .claim("fp", "fp-this-till")
                .claim("customer", "Cafe Lanka")
                .claim("edition", "RESTAURANT")
                .expiration(Date.from(Instant.now().plus(fromNow)))
                .signWith(keys.getPrivate())
                .compact();
    }

    private LicenseGuard guard(String token) {
        properties.setToken(token);
        return new LicenseGuard(properties, new LicenseVerifier(properties), fingerprint);
    }

    @Test
    @DisplayName("A license well in date starts quietly")
    void shouldStartQuietly() {
        LicenseGuard g = guard(license(Duration.ofDays(200)));
        g.enforce();
        assertThat(g.status().state()).isEqualTo(LicensePolicy.State.OK);
        assertThat(g.status().customer()).isEqualTo("Cafe Lanka");
    }

    @Test
    @DisplayName("Within 30 days of expiry it starts and warns, counting the days")
    void shouldWarnBeforeExpiry() {
        LicenseGuard g = guard(license(Duration.ofDays(12).minusHours(1)));
        g.enforce();
        assertThat(g.status().state()).isEqualTo(LicensePolicy.State.EXPIRING);
        assertThat(g.status().daysLeft()).isEqualTo(12);
    }

    @Test
    @DisplayName("Expired but inside the 7-day grace: still starts, counting down to the stop")
    void shouldStartInGrace() {
        LicenseGuard g = guard(license(Duration.ofDays(-2)));
        g.enforce();
        assertThat(g.status().state()).isEqualTo(LicensePolicy.State.GRACE);
        assertThat(g.status().daysLeft()).isEqualTo(5);
    }

    @Test
    @DisplayName("Past the grace period it refuses to start, and says when it expired")
    void shouldStopAfterGrace() {
        LicenseGuard g = guard(license(Duration.ofDays(-8)));
        assertThatThrownBy(g::enforce)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("grace period has ended");
    }

    @Test
    @DisplayName("Grace never rescues a forged license")
    void shouldRejectForgedExpiredLicense() throws Exception {
        KeyPair other = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        String forged = Jwts.builder().claim("fp", "fp-this-till")
                .expiration(Date.from(Instant.now().minus(Duration.ofDays(1))))
                .signWith(other.getPrivate()).compact();
        assertThatThrownBy(() -> guard(forged).enforce())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("signature is invalid");
    }

    @Test
    @DisplayName("A perpetual license never warns")
    void shouldTreatNoExpiryAsPerpetual() {
        String perpetual = Jwts.builder().claim("fp", "fp-this-till").signWith(keys.getPrivate()).compact();
        LicenseGuard g = guard(perpetual);
        g.enforce();
        assertThat(g.status().state()).isEqualTo(LicensePolicy.State.OK);
        assertThat(g.status().daysLeft()).isNull();
    }
}
