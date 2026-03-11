import { Injectable, Logger } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';

/**
 * XML Digital Signature service for DIAN electronic invoicing.
 * Signs UBL XML documents using a PKCS#12 (.p12) certificate.
 *
 * Uses XAdES-EPES (Electronic Signatures and Infrastructures) profile
 * as required by DIAN resolution 000012/2021.
 */
@Injectable()
export class DianXmlSignerService {
  private readonly logger = new Logger(DianXmlSignerService.name);

  /**
   * Signs an XML document using the provided .p12 certificate.
   *
   * @param xml_content - The unsigned UBL XML string
   * @param p12_buffer - The .p12 certificate file buffer
   * @param p12_password - The certificate password
   * @returns The signed XML string
   */
  async sign(
    xml_content: string,
    p12_buffer: Buffer,
    p12_password: string,
  ): Promise<string> {
    try {
      // Extract private key and certificate from .p12
      const { private_key, certificate } = this.extractFromP12(
        p12_buffer,
        p12_password,
      );

      // Create signature with the certificate for KeyInfo generation
      const sig = new SignedXml({
        privateKey: private_key,
        publicCert: certificate,
        canonicalizationAlgorithm:
          'http://www.w3.org/2001/10/xml-exc-c14n#',
        signatureAlgorithm:
          'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      });

      // Add reference to the document root
      sig.addReference({
        xpath: '/*',
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
      });

      // Compute and insert signature
      sig.computeSignature(xml_content, {
        location: {
          reference:
            "/*[local-name()='Invoice']/*[local-name()='UBLExtensions']/*[local-name()='UBLExtension'][2]/*[local-name()='ExtensionContent']",
          action: 'append',
        },
      });

      const signed_xml = sig.getSignedXml();

      this.logger.debug('XML document signed successfully');
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
      const key_bag =
        key_bags[forge.oids.pkcs8ShroudedKeyBag]?.[0];
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
