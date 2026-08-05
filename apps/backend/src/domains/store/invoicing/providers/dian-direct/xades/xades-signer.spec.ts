import * as crypto from 'crypto';
import {
  KmsAsymmetricSigner,
  LocalPemSigner,
  toXadesSigner,
} from './xades-signer';

/**
 * The point of this suite is not that KMS is called — it is that the KMS path
 * produces the SAME signature bytes an in-process PEM would. If it did not, every
 * document signed under HSM custody would be rejected by the DIAN, and the failure
 * would only appear in production, after the certificate had been migrated.
 */
describe('XadesSigner', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const private_key_pem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  const canonical_signed_info = Buffer.from(
    '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"></ds:SignedInfo>',
    'utf8',
  );

  describe('LocalPemSigner', () => {
    it('produces a verifiable RSA-SHA256 signature', async () => {
      const signature = await new LocalPemSigner(private_key_pem).sign(
        canonical_signed_info,
      );

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(canonical_signed_info);
      expect(verifier.verify(publicKey, Buffer.from(signature, 'base64'))).toBe(
        true,
      );
    });

    it('declares the key exportable', () => {
      expect(new LocalPemSigner(private_key_pem).is_exportable).toBe(true);
    });
  });

  describe('KmsAsymmetricSigner', () => {
    class FakeSignCommand {
      constructor(public readonly input: Record<string, unknown>) {}
    }

    /**
     * DER prefix of a PKCS#1 `DigestInfo` announcing SHA-256. RSASSA-PKCS1-v1_5 is
     * defined as an RSA private-key operation over `DigestInfo || digest`, so
     * prepending this and calling `privateEncrypt` with PKCS#1 padding reproduces
     * exactly what AWS KMS does for `RSASSA_PKCS1_V1_5_SHA_256` + `DIGEST`.
     */
    const DIGEST_INFO_SHA256 = Buffer.from(
      '3031300d060960864801650304020105000420',
      'hex',
    );

    /** Stands in for KMS: signs the digest it receives with the same RSA key. */
    const fakeKms = (captured: Record<string, unknown>[]) => ({
      send: async (command: any) => {
        captured.push(command.input);
        const signature = crypto.privateEncrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          Buffer.concat([
            DIGEST_INFO_SHA256,
            command.input.Message as Buffer,
          ]),
        );
        return { Signature: new Uint8Array(signature) };
      },
    });

    /**
     * THE load-bearing test. If the HSM path produced different bytes, every
     * document signed after migrating a certificate to KMS would be rejected — and
     * only in production, since dev signs with the local `.p12`.
     */
    it('produces byte-identical signatures to the in-process PEM path', async () => {
      const kms_signature = await new KmsAsymmetricSigner(
        fakeKms([]) as any,
        'k',
        FakeSignCommand as any,
      ).sign(canonical_signed_info);

      const pem_signature = await new LocalPemSigner(private_key_pem).sign(
        canonical_signed_info,
      );

      expect(kms_signature).toBe(pem_signature);

      // And it verifies against the certificate the XML publishes.
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(canonical_signed_info);
      expect(
        verifier.verify(publicKey, Buffer.from(kms_signature, 'base64')),
      ).toBe(true);
    });

    it('sends the SHA-256 DIGEST, not the raw message', async () => {
      const captured: Record<string, unknown>[] = [];
      await new KmsAsymmetricSigner(
        fakeKms(captured) as any,
        'arn:aws:kms:us-east-1:1:key/abc',
        FakeSignCommand as any,
      ).sign(canonical_signed_info);

      expect(captured).toHaveLength(1);
      expect(captured[0].MessageType).toBe('DIGEST');
      expect(captured[0].SigningAlgorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');
      expect(captured[0].KeyId).toBe('arn:aws:kms:us-east-1:1:key/abc');
      // The digest, not the message: KMS refuses raw messages over 4096 bytes, so
      // a growing SignedInfo would start failing in production if this regressed.
      expect(captured[0].Message).toEqual(
        crypto.createHash('sha256').update(canonical_signed_info).digest(),
      );
      expect(captured[0].Message).not.toEqual(canonical_signed_info);
    });

    it('declares the key non-exportable', () => {
      expect(
        new KmsAsymmetricSigner({} as any, 'k', FakeSignCommand as any)
          .is_exportable,
      ).toBe(false);
    });

    /**
     * The failure mode this guards against is the dangerous one: quietly signing
     * with the exportable key would emit a document that LOOKS HSM-signed while
     * the private key was in process memory after all.
     */
    it('refuses to sign when KMS returns no signature', async () => {
      const emptyKms = { send: async () => ({}) };

      await expect(
        new KmsAsymmetricSigner(
          emptyKms as any,
          'arn:aws:kms:us-east-1:1:key/abc',
          FakeSignCommand as any,
        ).sign(canonical_signed_info),
      ).rejects.toThrow(/refusing to sign with a weaker custody/);
    });

    it('surfaces a KMS error instead of falling back', async () => {
      const failingKms = {
        send: async () => {
          throw new Error('AccessDeniedException');
        },
      };

      await expect(
        new KmsAsymmetricSigner(
          failingKms as any,
          'k',
          FakeSignCommand as any,
        ).sign(canonical_signed_info),
      ).rejects.toThrow('AccessDeniedException');
    });
  });

  describe('toXadesSigner', () => {
    it('wraps a PEM string so existing callers keep working', () => {
      expect(toXadesSigner(private_key_pem)).toBeInstanceOf(LocalPemSigner);
    });

    it('passes an XadesSigner through untouched', () => {
      const signer = new LocalPemSigner(private_key_pem);
      expect(toXadesSigner(signer)).toBe(signer);
    });
  });
});
