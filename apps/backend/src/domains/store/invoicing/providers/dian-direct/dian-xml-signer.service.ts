import { Injectable, Logger } from '@nestjs/common';
import { XadesEpesBuilder } from './xades/xades-epes-builder';

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
   * Signs an XML document using the provided .p12 certificate.
   *
   * @param xml_content - The unsigned UBL XML string
   * @param p12_buffer - The .p12 certificate file buffer
   * @param p12_password - The certificate password
   * @returns The signed XML string (XAdES-EPES)
   */
  async sign(
    xml_content: string,
    p12_buffer: Buffer,
    p12_password: string,
  ): Promise<string> {
    try {
      // Extract private key and certificate (PEM) from the .p12 container.
      const { private_key, certificate } = this.extractFromP12(
        p12_buffer,
        p12_password,
      );

      const signed_xml = this.xades_builder.sign(
        xml_content,
        private_key,
        certificate,
      );

      this.logger.debug('XML document signed successfully (XAdES-EPES)');
      return signed_xml;
    } catch (error) {
      this.logger.error(`XML signing failed: ${error.message}`);
      throw new Error(`Failed to sign XML document: ${error.message}`);
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
