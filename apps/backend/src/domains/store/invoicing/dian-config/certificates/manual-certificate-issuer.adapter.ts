import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CertificateIssuerAdapter,
  CertificateValidationResult,
} from './certificate-issuer.interface';

@Injectable()
export class ManualCertificateIssuerAdapter implements CertificateIssuerAdapter {
  readonly provider = 'manual_upload_validated' as const;

  async validateCertificate(params: {
    p12_buffer: Buffer;
    password: string;
    expected_tax_id?: string | null;
  }): Promise<CertificateValidationResult> {
    try {
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(
        params.p12_buffer.toString('binary'),
      );
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, params.password);
      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];

      if (!cert_bag?.cert) {
        return { valid: false, error: 'No certificate found in file' };
      }

      const cert = cert_bag.cert;
      const expires = cert.validity.notAfter;
      if (expires <= new Date()) {
        return this.result(forge, cert, false, 'Certificate expired');
      }

      const result = this.result(forge, cert, true);
      const expectedTaxId = this.onlyDigits(params.expected_tax_id);
      if (expectedTaxId && !result.tax_id) {
        return {
          ...result,
          valid: false,
          error: 'Certificate tax identifier could not be verified',
        };
      }
      if (expectedTaxId && result.tax_id && result.tax_id !== expectedTaxId) {
        return {
          ...result,
          valid: false,
          error: 'Certificate tax identifier does not match the fiscal entity',
        };
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }

  private result(
    forge: any,
    cert: any,
    valid: boolean,
    error?: string,
  ): CertificateValidationResult {
    const subject = this.attributesToText(cert.subject?.attributes ?? []);
    const issuer = this.attributesToText(cert.issuer?.attributes ?? []);
    const der_bytes = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const fingerprint = createHash('sha256')
      .update(Buffer.from(der_bytes, 'binary'))
      .digest('hex');

    return {
      valid,
      subject,
      issuer,
      expires: cert.validity?.notAfter,
      serial_number: cert.serialNumber,
      fingerprint,
      tax_id: this.extractTaxId(subject),
      error,
    };
  }

  private attributesToText(attributes: Array<Record<string, any>>): string {
    return attributes
      .map((attr) => {
        const key = attr.shortName || attr.name || attr.type;
        return `${key}=${attr.value}`;
      })
      .join(', ');
  }

  private extractTaxId(value?: string): string | undefined {
    if (!value) return undefined;
    const matches = value.match(/\d{6,12}/g);
    return matches?.map((item) => this.onlyDigits(item)).find(Boolean);
  }

  private onlyDigits(value?: string | null): string | undefined {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits || undefined;
  }
}
