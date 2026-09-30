package com.lumora.pos.hardware.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class QzSigningServiceTest {

    @Test
    void isUnconfiguredWhenNoKeyProvided() {
        QzSigningService svc = new QzSigningService("", "");
        assertThat(svc.isConfigured()).isFalse();
    }

    @Test
    void isUnconfiguredWhenKeyIsGarbage() {
        QzSigningService svc = new QzSigningService("cert", "not-a-real-key");
        assertThat(svc.isConfigured()).isFalse();
    }

    @Test
    void signsWithAKeytoolKeystoreAndServesItsCertificateAsPem(@TempDir Path dir) throws Exception {
        // Exactly what setup-qz-signing.ps1 runs on a till.
        Path keystore = dir.resolve("qz-signing.p12");
        String keytool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
        Process p = new ProcessBuilder(keytool, "-genkeypair", "-alias", "qz", "-keyalg", "RSA",
                "-keysize", "2048", "-validity", "30", "-dname", "CN=StoreX Restaurant test",
                "-storetype", "PKCS12", "-keystore", keystore.toString(),
                "-storepass", "s3cret-pass", "-keypass", "s3cret-pass")
                .redirectErrorStream(true).start();
        assertThat(p.waitFor()).isZero();

        QzSigningService svc = new QzSigningService("", "", keystore.toString(), "s3cret-pass");
        assertThat(svc.isConfigured()).isTrue();
        assertThat(svc.getCertificate()).startsWith("-----BEGIN CERTIFICATE-----\n")
                .endsWith("-----END CERTIFICATE-----\n");

        // The signature verifies against the certificate QZ Tray is handed.
        X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(svc.getCertificate().getBytes(StandardCharsets.US_ASCII)));
        assertThat(cert.getSubjectX500Principal().getName()).isEqualTo("CN=StoreX Restaurant test");
        Signature verifier = Signature.getInstance("SHA512withRSA");
        verifier.initVerify(cert.getPublicKey());
        verifier.update("qz-request".getBytes(StandardCharsets.UTF_8));
        assertThat(verifier.verify(Base64.getDecoder().decode(svc.sign("qz-request")))).isTrue();
    }

    @Test
    void staysUnsignedWhenTheKeystoreIsMissingOrTheWrongPassword(@TempDir Path dir) {
        assertThat(new QzSigningService("", "", dir.resolve("nope.p12").toString(), "x").isConfigured()).isFalse();
        assertThat(new QzSigningService("", "", "", "").isConfigured()).isFalse();
    }

    @Test
    void signsPayloadVerifiableWithPublicKey() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair kp = gen.generateKeyPair();

        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(kp.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----";

        QzSigningService svc = new QzSigningService("dummy-cert", pem);
        assertThat(svc.isConfigured()).isTrue();
        assertThat(svc.getCertificate()).isEqualTo("dummy-cert");

        String data = "qz-request-payload";
        byte[] signature = Base64.getDecoder().decode(svc.sign(data));

        Signature verifier = Signature.getInstance("SHA512withRSA");
        verifier.initVerify(kp.getPublic());
        verifier.update(data.getBytes(StandardCharsets.UTF_8));
        assertThat(verifier.verify(signature)).isTrue();
    }
}
