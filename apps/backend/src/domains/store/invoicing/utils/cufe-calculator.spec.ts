import { Prisma } from '@prisma/client';
import { CufeCalculator, CufeParams } from './cufe-calculator';
import { dianAmount } from './dian-money.util';

/**
 * Regression suite for the CUFE scale/sanitization defect.
 *
 * The DIAN recomputes this hash from the XML it receives, so the hash Vendix
 * signs must be derivable from the values the XML publishes. Two divergences
 * used to break that:
 *
 * 1. Amounts arrived as `Prisma.Decimal.toString()` (`'1000'`) while the XML
 *    emitted `'1000.00'`.
 * 2. The acquirer's document arrived punctuated (`'900.123.456-7'`) while the
 *    Anexo requires bare digits.
 *
 * Both are now normalized inside `CufeCalculator.generate`, so these tests pin
 * the invariant "differently-formatted equivalent inputs produce ONE hash".
 */
describe('CufeCalculator', () => {
  const base: CufeParams = {
    invoice_number: 'SETP990000001',
    issue_date: '2026-08-04',
    issue_time: '10:15:30-05:00',
    total_before_tax: '1000.00',
    tax_iva: '190.00',
    tax_inc: '0.00',
    tax_ica: '0.00',
    total_amount: '1190.00',
    issuer_nit: '900123456',
    customer_nit: '1020304050',
    technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    environment: '2',
  };

  describe('monetary scale normalization', () => {
    it('produces the same CUFE for an unscaled Decimal and its padded string', () => {
      // The exact production path: invoice_flow handed over `.toString()`.
      const unscaled = new Prisma.Decimal('1000.00').toString();
      expect(unscaled).toBe('1000');

      const from_unscaled = CufeCalculator.generate({
        ...base,
        total_before_tax: unscaled,
      });
      const from_padded = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000.00',
      });

      expect(from_unscaled).toBe(from_padded);
    });

    it('normalizes every monetary field, not only the subtotal', () => {
      const unscaled = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000',
        tax_iva: '190',
        tax_inc: '0',
        tax_ica: '0',
        total_amount: '1190',
      });
      expect(unscaled).toBe(CufeCalculator.generate(base));
    });

    it('treats an absent optional tax as 0.00', () => {
      const omitted = CufeCalculator.generate({
        ...base,
        tax_inc: undefined,
        tax_ica: undefined,
      });
      expect(omitted).toBe(CufeCalculator.generate(base));
    });

    it('truncates a sub-cent amount instead of rounding it up', () => {
      const truncated = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000.009',
      });
      expect(truncated).toBe(
        CufeCalculator.generate({ ...base, total_before_tax: '1000.00' }),
      );
    });
  });

  describe('NIT sanitization (Anexo §11.2)', () => {
    it('produces the same CUFE for a punctuated and a bare acquirer NIT', () => {
      const punctuated = CufeCalculator.generate({
        ...base,
        customer_nit: '1.020.304.050',
      });
      expect(punctuated).toBe(CufeCalculator.generate(base));
    });

    it('strips the issuer NIT separators too', () => {
      const punctuated = CufeCalculator.generate({
        ...base,
        issuer_nit: '900.123.456',
      });
      expect(punctuated).toBe(CufeCalculator.generate(base));
    });
  });

  describe('hash contract', () => {
    it('is a 96-char lowercase hex SHA-384 digest', () => {
      expect(CufeCalculator.generate(base)).toMatch(/^[0-9a-f]{96}$/);
    });

    it('changes when the environment changes', () => {
      const test_env = CufeCalculator.generate({ ...base, environment: '2' });
      const prod_env = CufeCalculator.generate({ ...base, environment: '1' });
      expect(test_env).not.toBe(prod_env);
    });

    it('changes when the technical key changes', () => {
      const other = CufeCalculator.generate({
        ...base,
        technical_key: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      expect(other).not.toBe(CufeCalculator.generate(base));
    });

    it('reproduces the hash a verifier recomputes from XML-published values', () => {
      // Mirrors what an auditor does: read the 15 fields off the XML (already
      // DIAN-formatted) and hash them. If generate() normalized differently from
      // the XML builders, this would diverge.
      const from_xml_values = CufeCalculator.generate({
        ...base,
        total_before_tax: dianAmount('1000'),
        tax_iva: dianAmount('190'),
        tax_inc: dianAmount('0'),
        tax_ica: dianAmount('0'),
        total_amount: dianAmount('1190'),
      });
      expect(from_xml_values).toBe(CufeCalculator.generate(base));
    });
  });

  describe('generateQrUrl', () => {
    it('embeds the document key in the DIAN catalog URL', () => {
      const cufe = CufeCalculator.generate(base);
      expect(CufeCalculator.generateQrUrl(cufe)).toBe(
        `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
      );
    });
  });

  /**
   * The strongest verification available for a hash contract: the annex publishes a
   * worked example, so the assertion is the DIAN's own output rather than our
   * reading of a field list.
   *
   * Source: Anexo Técnico de documento equivalente electrónico v1.0
   * (Res. 000165/2023), numerales 14.1.7 (field list) and 14.1.8 (this vector).
   */
  describe('generateEventCude — official vector', () => {
    const OFFICIAL_VECTOR = {
      event_number: '1',
      issue_date: '2019-04-30',
      issue_time: '19:48:50-05:00',
      issuer_nit: '99998888',
      customer_nit: '800197268',
      event_code: '030',
      referenced_document_number: 'FE123',
      referenced_document_type_code: '01',
      software_pin: '11111',
    };

    const OFFICIAL_CUDE =
      '0d91ba25b01f5e7dbda870a11b274501d3a62a73e91932c473c86c93f12a142a2ac45876efcde3e679024a01c0be41f9';

    it('reproduces the CUDE published by the annex', () => {
      expect(CufeCalculator.generateEventCude(OFFICIAL_VECTOR)).toBe(
        OFFICIAL_CUDE,
      );
    });

    /**
     * Each of these was a real defect in the shipped implementation, and any ONE of
     * them yields a key the DIAN cannot reproduce — i.e. every RADIAN event Vendix
     * transmitted was rejected. Pinned individually so a future refactor cannot
     * reintroduce one of them while the happy path still passes.
     */
    it('places the event code AFTER both identifications', () => {
      // The old order hashed the code right after the time.
      const wrong_order = [
        '1',
        '2019-04-30',
        '19:48:50-05:00',
        '030',
        '99998888',
        '800197268',
        'FE123',
        '01',
        '11111',
      ].join('');
      expect(OFFICIAL_CUDE).not.toBe(
        require('crypto').createHash('sha384').update(wrong_order).digest('hex'),
      );
    });

    it('binds the referenced document number and type', () => {
      const other_document = CufeCalculator.generateEventCude({
        ...OFFICIAL_VECTOR,
        referenced_document_number: 'FE124',
      });
      expect(other_document).not.toBe(OFFICIAL_CUDE);

      const other_type = CufeCalculator.generateEventCude({
        ...OFFICIAL_VECTOR,
        referenced_document_type_code: '02',
      });
      expect(other_type).not.toBe(OFFICIAL_CUDE);
    });

    it('defaults the referenced document type to 01 (FEV)', () => {
      const { referenced_document_type_code, ...without_type } =
        OFFICIAL_VECTOR;
      expect(referenced_document_type_code).toBe('01');
      expect(CufeCalculator.generateEventCude(without_type)).toBe(
        OFFICIAL_CUDE,
      );
    });

    it('ends the chain at the Software-PIN, with no environment digit', () => {
      // The old implementation appended TipoAmbiente ('1'/'2') after the PIN.
      const with_environment = require('crypto')
        .createHash('sha384')
        .update(
          '12019-04-3019:48:50-05:0099998888800197268030FE1230111111' + '2',
        )
        .digest('hex');
      expect(OFFICIAL_CUDE).not.toBe(with_environment);
    });

    /**
     * `onlyDigits` removes dots and dashes, NOT the verification digit — the annex
     * asks for both, and stripping a trailing digit blindly would mutilate a
     * cédula. Callers must hand over the identification already without its DV, the
     * same contract the invoice CUFE path has.
     */
    it('strips punctuation from both identifications', () => {
      expect(
        CufeCalculator.generateEventCude({
          ...OFFICIAL_VECTOR,
          issuer_nit: '99.998.888',
          customer_nit: '800.197.268',
        }),
      ).toBe(OFFICIAL_CUDE);
    });

    it('does NOT silently drop a verification digit the caller left in', () => {
      // Would be a wrong key rather than a corrected one, so it must differ —
      // the DV belongs in `@schemeID`, never in the hashed identification.
      expect(
        CufeCalculator.generateEventCude({
          ...OFFICIAL_VECTOR,
          customer_nit: '800197268-4',
        }),
      ).not.toBe(OFFICIAL_CUDE);
    });
  });

  /**
   * The equivalent document (POS ticket) reuses the 15-field invoice shape with the
   * Software-PIN in the ClTec position — Res. 000165/2023 Anexo DE §14.1.2.
   */
  describe('generateEquivalentDocumentCude', () => {
    it('substitutes the Software-PIN for the technical key', () => {
      const { technical_key, ...without_key } = base;
      expect(technical_key).toBeDefined();

      const cude = CufeCalculator.generateEquivalentDocumentCude({
        ...without_key,
        software_pin: '11111',
      });

      expect(cude).toBe(
        CufeCalculator.generate({ ...without_key, technical_key: '11111' }),
      );
      // And it must NOT coincide with the invoice CUFE of the same document.
      expect(cude).not.toBe(CufeCalculator.generate(base));
    });

    it('applies the same money and NIT normalization as the CUFE', () => {
      const padded = CufeCalculator.generateEquivalentDocumentCude({
        ...base,
        total_before_tax: '1000',
        customer_nit: '10.203.040-50',
        software_pin: '11111',
      });
      const normalized = CufeCalculator.generateEquivalentDocumentCude({
        ...base,
        total_before_tax: '1000.00',
        customer_nit: '1020304050',
        software_pin: '11111',
      });
      expect(padded).toBe(normalized);
    });
  });
});
