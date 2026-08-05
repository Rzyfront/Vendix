import { Injectable, Logger } from '@nestjs/common';
import { XadesEpesBuilder } from './xades/xades-epes-builder';
import {
  KmsAsymmetricSigner,
  KmsSignPort,
  LocalPemSigner,
  XadesSigner,
} from './xades/xades-signer';

/**
 * XML Digital Signature service for DIAN electronic invoicing.
 * Signs UBL XML documents using a PKCS#12 (.p12) certificate.
 *
 * Produces an XAdES-EPES (Electronic Signature with Explicit Policy) signature
 * as required by DIAN resolution 000012/2021 and the Anexo Técnico (v1.8/1.9):
 * an enveloped `ds:Signature` inside the second
 * `ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent`, with a
 * `xades:QualifyingProperties/xades:SignedProperties` block carrying SigningTime,
 * SigningCertificate and the DIAN SignaturePolicyIdentifier.
 *
 * @see XadesEpesBuilder for the signature construction details.
 */
@Injectable()
export class DianXmlSignerService {
  private readonly logger = new Logger(DianXmlSignerService.name);
  private readonly xades_builder = new XadesEpesBuilder();

  /**
   * Lazily-built KMS client. Built on first HSM signature so a deployment that
   * never configures KMS pays nothing (no client, no credential resolution).
   */
  private kms_client?: KmsSignPort;
  private kms_sign_command?: new (input: Record<string, unknown>) => any;

  /**
   * Signs an XML document.
   *
   * @param xml_content - The unsigned UBL XML string
   * @param p12_buffer - The .p12 certificate file buffer. Always required: the
   *   **certificate** is public material and lives here even when the private key
   *   does not (`kms_key_id` set), because XAdES must publish it in
   *   `KeyInfo`/`SigningCertificate`.
   * @param p12_password - The certificate password. May be empty when signing via
   *   KMS with a `.p12`/`.cer` that carries no private key.
   * @param kms_key_id - When present, the RSA signature is produced **inside AWS
   *   KMS** by a key whose private half never leaves the HSM. The `.p12` private
   *   key, if any, is then never touched.
   * @returns The signed XML string (XAdES-EPES)
   */
  async sign(
    xml_content: string,
    p12_buffer: Buffer,
    p12_password: string,
    kms_key_id?: string | null,
  ): Promise<string> {
    try {
      const signer = kms_key_id
        ? this.buildKmsSigner(kms_key_id)
        : new LocalPemSigner(
            this.extractFromP12(p12_buffer, p12_password).private_key,
          );

      // The certificate is read the same way in both custodies. When the key lives
      // in KMS the container may legitimately hold no private key, so it is read
      // with a certificate-only extraction that does not demand a key bag.
      const certificate = kms_key_id
        ? this.extractCertificateOnly(p12_buffer, p12_password)
        : this.extractFromP12(p12_buffer, p12_password).certificate;

      const signed_xml = await this.xades_builder.sign(
        xml_content,
        signer,
        certificate,
      );

      this.logger.debug(
        `XML document signed successfully (XAdES-EPES, ${
          kms_key_id ? 'KMS non-exportable key' : 'in-process PEM key'
        })`,
      );
      return signed_xml;
    } catch (error) {
      this.logger.error(`XML signing failed: ${error.message}`);
      throw new Error(`Failed to sign XML document: ${error.message}`);
    }
  }

  /**
   * Builds the KMS-backed signer, resolving the SDK lazily.
   *
   * `require` rather than a top-level import for the same reason `node-forge` is
   * required here: the module is only needed on the code path that uses it, and a
   * deployment signing with a local `.p12` should not fail to boot over an SDK it
   * never calls.
   */
  private buildKmsSigner(kms_key_id: string): XadesSigner {
    if (!this.kms_client || !this.kms_sign_command) {
      let sdk: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sdk = require('@aws-sdk/client-kms');
      } catch {
        throw new Error(
          'Signing with a KMS key requires @aws-sdk/client-kms to be installed.',
        );
      }
      this.kms_client = new sdk.KMSClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
      this.kms_sign_command = sdk.SignCommand;
    }

    const client = this.kms_client;
    const command = this.kms_sign_command;
    if (!client || !command) {
      throw new Error('Failed to initialize the AWS KMS signing client.');
    }

    return new KmsAsymmetricSigner(client, kms_key_id, command);
  }

  /**
   * Reads only the certificate out of the container.
   *
   * Separate from `extractFromP12` because that one fails when no private key bag
   * exists — which is precisely the shape of a container built for HSM custody,
   * where the private key is deliberately absent.
   */
  private extractCertificateOnly(p12_buffer: Buffer, password: string): string {
    try {
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(p12_buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, password);

      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];
      if (!cert_bag?.cert) {
        throw new Error('No certificate found in .p12 file');
      }
      return forge.pki.certificateToPem(cert_bag.cert);
    } catch (error) {
      if (
        error.message.includes('Invalid password') ||
        error.message.includes('PKCS#12 MAC could not be verified')
      ) {
        throw new Error('Invalid certificate password');
      }
      throw error;
    }
  }

  /**
   * Extracts private key and certificate from a PKCS#12 file.
   * Uses Node.js native crypto for .p12 parsing.
   */
  private extractFromP12(
    p12_buffer: Buffer,
    password: string,
  ): { private_key: string; certificate: string } {
    try {
      // Use node-forge for PKCS#12 parsing
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(p12_buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, password);

      // Extract private key
      const key_bags = p12.getBags({ bagType: forge.oids.pkcs8ShroudedKeyBag });
      const key_bag = key_bags[forge.oids.pkcs8ShroudedKeyBag]?.[0];
      if (!key_bag) {
        throw new Error('No private key found in .p12 file');
      }
      const private_key = forge.pki.privateKeyToPem(key_bag.key);

      // Extract certificate
      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];
      if (!cert_bag) {
        throw new Error('No certificate found in .p12 file');
      }
      const certificate = forge.pki.certificateToPem(cert_bag.cert);

      return { private_key, certificate };
    } catch (error) {
      if (
        error.message.includes('Invalid password') ||
        error.message.includes('PKCS#12 MAC could not be verified')
      ) {
        throw new Error('Invalid certificate password');
      }
      throw error;
    }
  }

  /**
   * Builds the WS-Security material the SOAP transport needs.
   *
   * ## Why the transport needs this too
   *
   * DIAN's WCF binding signs the SOAP envelope with the SAME certificate that
   * signs the document. So moving only the XAdES signature into the HSM would be
   * cosmetic: the private key would still have to exist in this process to sign
   * the envelope, which is exactly the exposure the HSM was meant to remove.
   * Routing both through an `XadesSigner` is what makes the custody real.
   *
   * The `BinarySecurityToken` carries the DER certificate — public material,
   * unchanged in either custody.
   */
  buildWsCredentials(
    p12_buffer: Buffer,
    password: string,
    kms_key_id?: string | null,
  ): { signer: XadesSigner; certificate_der_base64: string } {
    if (kms_key_id) {
      return {
        signer: this.buildKmsSigner(kms_key_id),
        certificate_der_base64: this.extractCertificateDerBase64(
          p12_buffer,
          password,
        ),
      };
    }

    const creds = this.extractCredentials(p12_buffer, password);
    return {
      signer: new LocalPemSigner(creds.private_key_pem),
      certificate_der_base64: creds.certificate_der_base64,
    };
  }

  /**
   * DER-encoded base64 certificate, read without requiring a private key bag —
   * the shape of a container provisioned for HSM custody.
   */
  private extractCertificateDerBase64(
    p12_buffer: Buffer,
    password: string,
  ): string {
    const forge = require('node-forge');
    const certificate_pem = this.extractCertificateOnly(p12_buffer, password);
    const cert = forge.pki.certificateFromPem(certificate_pem);
    const cert_der_bytes = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    return Buffer.from(cert_der_bytes, 'binary').toString('base64');
  }

  /**
   * Extracts credentials from a .p12 certificate file.
   * Returns PEM private key, PEM certificate, and DER-encoded base64 certificate
   * (needed for WS-Security BinarySecurityToken).
   */
  extractCredentials(
    p12_buffer: Buffer,
    password: string,
  ): {
    private_key_pem: string;
    certificate_pem: string;
    certificate_der_base64: string;
  } {
    try {
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(p12_buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, password);

      // Extract private key
      const key_bags = p12.getBags({
        bagType: forge.oids.pkcs8ShroudedKeyBag,
      });
      const key_bag = key_bags[forge.oids.pkcs8ShroudedKeyBag]?.[0];
      if (!key_bag) {
        throw new Error('No private key found in .p12 file');
      }
      const private_key_pem = forge.pki.privateKeyToPem(key_bag.key);

      // Extract certificate
      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];
      if (!cert_bag?.cert) {
        throw new Error('No certificate found in .p12 file');
      }
      const certificate_pem = forge.pki.certificateToPem(cert_bag.cert);

      // Convert certificate to DER-encoded base64 (for WS-Security BinarySecurityToken)
      const cert_asn1 = forge.pki.certificateToAsn1(cert_bag.cert);
      const cert_der_bytes = forge.asn1.toDer(cert_asn1).getBytes();
      const certificate_der_base64 = Buffer.from(
        cert_der_bytes,
        'binary',
      ).toString('base64');

      return { private_key_pem, certificate_pem, certificate_der_base64 };
    } catch (error) {
      if (
        error.message.includes('Invalid password') ||
        error.message.includes('PKCS#12 MAC could not be verified')
      ) {
        throw new Error('Invalid certificate password');
      }
      throw error;
    }
  }

  /**
   * Validates that a .p12 file can be read with the given password
   * and that the certificate is not expired.
   */
  async validateCertificate(
    p12_buffer: Buffer,
    password: string,
  ): Promise<{
    valid: boolean;
    subject?: string;
    issuer?: string;
    expires?: Date;
    error?: string;
  }> {
    try {
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(p12_buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, password);

      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];

      if (!cert_bag?.cert) {
        return { valid: false, error: 'No certificate found in file' };
      }

      const cert = cert_bag.cert;
      const expires = cert.validity.notAfter;
      const now = new Date();

      if (expires < now) {
        return {
          valid: false,
          subject: cert.subject.getField('CN')?.value,
          issuer: cert.issuer.getField('CN')?.value,
          expires,
          error: 'Certificate expired',
        };
      }

      return {
        valid: true,
        subject: cert.subject.getField('CN')?.value,
        issuer: cert.issuer.getField('CN')?.value,
        expires,
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
