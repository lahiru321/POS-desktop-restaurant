package com.lumora.pos.hardware.service;

import com.lumora.pos.common.exception.BusinessException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Key;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Collections;

/**
 * Signs QZ Tray print requests so the cashier's QZ Tray app trusts this site and
 * prints silently (no per-job confirmation prompt).
 *
 * <p>Two ways to supply the signing material, never committed:
 * <ul>
 *   <li><b>A PKCS12 keystore</b> ({@code app.qz.keystore} + {@code keystore-password})
 *       — the desktop install. {@code setup-qz-signing.ps1} generates one per machine
 *       with the bundled JRE's keytool and tells that machine's QZ Tray to trust its
 *       certificate; the launcher passes the path in. Per machine on purpose: one
 *       key shared by every install would let anyone who unpacked the installer
 *       sign print jobs for every customer's QZ Tray from any web page.</li>
 *   <li><b>PEM strings</b> ({@code app.qz.certificate} + {@code private-key}) — a
 *       hosted deployment with a commercial QZ certificate. Wins if both are set.</li>
 * </ul>
 * With neither, {@link #isConfigured()} is false and the frontend prints unsigned
 * (QZ asks the cashier to allow the site).
 */
@Slf4j
@Service
public class QzSigningService {

    private final String certificate;
    private final PrivateKey privateKey;

    /** PEM only — kept for callers and tests that have no keystore. */
    public QzSigningService(String certificate, String privateKeyPem) {
        this(certificate, privateKeyPem, "", "");
    }

    @Autowired
    public QzSigningService(
            @Value("${app.qz.certificate:}") String certificate,
            @Value("${app.qz.private-key:}") String privateKeyPem,
            @Value("${app.qz.keystore:}") String keystorePath,
            @Value("${app.qz.keystore-password:}") String keystorePassword) {
        String pemCert = certificate == null ? "" : certificate.trim();
        PrivateKey pemKey = parseKey(privateKeyPem);
        if (!pemCert.isBlank() && pemKey != null) {
            this.certificate = pemCert;
            this.privateKey = pemKey;
            log.info("QZ signing enabled from PEM configuration");
            return;
        }

        Material fromKeystore = loadKeystore(keystorePath, keystorePassword);
        this.certificate = fromKeystore != null ? fromKeystore.certificatePem() : pemCert;
        this.privateKey = fromKeystore != null ? fromKeystore.key() : pemKey;
    }

    public boolean isConfigured() {
        return !certificate.isBlank() && privateKey != null;
    }

    public String getCertificate() {
        return certificate;
    }

    /** Signs the QZ request payload, returning a base64 signature (SHA512withRSA). */
    public String sign(String data) {
        if (privateKey == null) {
            throw new BusinessException("QZ signing is not configured");
        }
        try {
            Signature signer = Signature.getInstance("SHA512withRSA");
            signer.initSign(privateKey);
            signer.update(data.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(signer.sign());
        } catch (Exception e) {
            log.error("Failed to sign QZ request", e);
            throw new BusinessException("Failed to sign QZ request");
        }
    }

    private record Material(String certificatePem, PrivateKey key) {
    }

    /**
     * The first key entry in a PKCS12 keystore and its certificate, as PEM. A
     * missing or unreadable keystore is logged and treated as "unsigned" — a
     * printing convenience must never stop the till from starting.
     */
    private Material loadKeystore(String path, String password) {
        if (path == null || path.isBlank()) return null;
        Path file = Path.of(path.trim());
        if (!Files.isRegularFile(file)) {
            log.warn("QZ keystore not found at {} — printing unsigned", file);
            return null;
        }
        char[] pass = password == null ? new char[0] : password.toCharArray();
        try (InputStream in = Files.newInputStream(file)) {
            KeyStore store = KeyStore.getInstance("PKCS12");
            store.load(in, pass);
            for (String alias : Collections.list(store.aliases())) {
                if (!store.isKeyEntry(alias)) continue;
                Key key = store.getKey(alias, pass);
                Certificate cert = store.getCertificate(alias);
                if (key instanceof PrivateKey privateKey && cert != null) {
                    String subject = cert instanceof X509Certificate x509
                            ? x509.getSubjectX500Principal().getName() : alias;
                    log.info("QZ signing enabled from keystore {} ({})", file, subject);
                    return new Material(toPem(cert), privateKey);
                }
            }
            log.warn("QZ keystore {} holds no private key — printing unsigned", file);
        } catch (Exception e) {
            log.warn("Could not read QZ keystore {} — printing unsigned: {}", file, e.getMessage());
        }
        return null;
    }

    private static String toPem(Certificate cert) throws Exception {
        String body = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(cert.getEncoded());
        return "-----BEGIN CERTIFICATE-----\n" + body + "\n-----END CERTIFICATE-----\n";
    }

    private PrivateKey parseKey(String pem) {
        if (pem == null || pem.isBlank()) return null;
        try {
            String normalized = pem
                    .replace("\\n", "\n")            // tolerate escaped newlines from env vars
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] der = Base64.getDecoder().decode(normalized);
            KeyFactory kf = KeyFactory.getInstance("RSA");
            return kf.generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            log.warn("Could not parse QZ private key — silent printing disabled: {}", e.getMessage());
            return null;
        }
    }
}
