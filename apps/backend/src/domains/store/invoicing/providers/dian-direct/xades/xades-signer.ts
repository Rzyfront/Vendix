import * as crypto from 'crypto';

/**
 * The one cryptographic operation an XAdES-EPES signature needs: produce an
 * RSASSA-PKCS1-v1_5 signature over SHA-256 of the canonical `ds:SignedInfo`.
 *
 * ## Why this is an interface and not a PEM string
 *
 * The whole point of keeping the private key in an HSM is that it is
 * **non-exportable**: there is no PEM to hand to `crypto.createSign`. The only
 * way to sign with such a key is to send the bytes to the device and get the
 * signature back — which is asynchronous and remote.
 *
 * Modelling that as an interface (rather than branching inside the builder) keeps
 * the XAdES construction identical in both custodies. That matters more than it
 * looks: the signature covers three digests over canonicalized node-sets, and a
 * second code path through that construction is a second chance to canonicalize
 * differently and produce a signature the DIAN cannot verify. There is one
 * construction; only the last step differs.
 */
export interface XadesSigner {
  /**
   * Signs `data` with RSASSA-PKCS1-v1_5 / SHA-256 and returns base64.
   *
   * Implementations receive the **raw bytes** (the canonical `SignedInfo`), not a
   * digest, so each one is free to hash locally or delegate the hashing —
   * whichever its backend requires.
   */
  sign(data: Buffer): Promise<string>;

  /**
   * True when the private key can leave the process (a PEM in memory). Drives the
   * production-readiness posture check: an exportable key is not a defect, but it
   * is a weaker custody than an HSM and the merchant is entitled to know.
   */
  readonly is_exportable: boolean;
}

/**
 * Signs with a PEM private key held in process memory — the custody Vendix has
 * used since the beginning (a `.p12` downloaded from S3 and opened with its
 * password).
 */
export class LocalPemSigner implements XadesSigner {
  readonly is_exportable = true;

  constructor(private readonly private_key_pem: string) {}

  async sign(data: Buffer): Promise<string> {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(data);
    return signer.sign(this.private_key_pem, 'base64');
  }
}

/**
 * Minimal structural contract of the AWS KMS client this signer needs.
 *
 * Declared structurally instead of importing `KMSClient`'s types so that the
 * signer stays unit-testable with a plain object and the module does not have to
 * be resolvable at typecheck time.
 */
export interface KmsSignPort {
  send(command: any): Promise<{ Signature?: Uint8Array }>;
}

/**
 * Signs inside AWS KMS with an asymmetric RSA key whose private half **never
 * leaves the HSM** (`Origin: AWS_KMS`, `KeyUsage: SIGN_VERIFY`,
 * `KeySpec: RSA_2048` or larger).
 *
 * Two details that are easy to get wrong:
 *
 * 1. **`MessageType: 'DIGEST'`.** KMS refuses raw messages over 4096 bytes. A
 *    `SignedInfo` is ~1 KB today, so `RAW` would work — until an extra reference
 *    or a longer certificate chain pushes it over, and then production breaks on
 *    a document size nobody tested. Sending the SHA-256 digest yields the
 *    identical signature and has no size ceiling.
 * 2. **The digest must match the algorithm's hash.** `RSASSA_PKCS1_V1_5_SHA_256`
 *    expects SHA-256; handing it any other digest produces a signature that
 *    verifies against nothing.
 *
 * The certificate itself is NOT secret and keeps coming from S3 — only the
 * signing operation moves. That is what makes this drop-in: the XAdES
 * `KeyInfo`/`SigningCertificate` blocks are unchanged.
 */
export class KmsAsymmetricSigner implements XadesSigner {
  readonly is_exportable = false;

  constructor(
    private readonly kms: KmsSignPort,
    private readonly key_id: string,
    /** Constructor of the KMS `SignCommand`, injected so tests need no SDK. */
    private readonly sign_command: new (input: Record<string, unknown>) => any,
  ) {}

  async sign(data: Buffer): Promise<string> {
    const digest = crypto.createHash('sha256').update(data).digest();

    const response = await this.kms.send(
      new this.sign_command({
        KeyId: this.key_id,
        Message: digest,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      }),
    );

    if (!response?.Signature?.length) {
      // Never fall back to a local key here: silently signing with the exportable
      // custody would defeat the whole reason the HSM was configured, and the
      // document would go out looking HSM-signed.
      throw new Error(
        `KMS did not return a signature for key ${this.key_id}; refusing to sign with a weaker custody.`,
      );
    }

    return Buffer.from(response.Signature).toString('base64');
  }
}

/** Normalizes the two accepted forms into a signer. */
export function toXadesSigner(signer: XadesSigner | string): XadesSigner {
  return typeof signer === 'string' ? new LocalPemSigner(signer) : signer;
}
