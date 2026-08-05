import {
  DIAN_ENDORSEMENT_LIST_IDS,
  DIAN_EVENT_CODES,
  DIAN_NEGOTIATION_FIELDS,
  DianEventCode,
} from '../constants/dian-endpoints';
import {
  DianEventParty,
  UblApplicationResponseBuilder,
} from './ubl-application-response.builder';

/**
 * The RADIAN `ApplicationResponse` is validated by XSD and by the annex's own
 * rejection rules, so these tests pin the parts a rejection would point at:
 * the ProfileID literal, the operation type vs the response code, the endorsement
 * `@listID`, and element ORDER (UBL is sequence-validated — an element in the
 * wrong position is a failure, not a warning).
 */
describe('UblApplicationResponseBuilder', () => {
  const sender: DianEventParty = {
    document_type: '31',
    document_number: '900123456',
    document_dv: '1',
    legal_name: 'Tienda Demo SAS',
  };

  const receiver: DianEventParty = {
    document_type: '31',
    document_number: '800987654',
    document_dv: '3',
    legal_name: 'Adquiriente SAS',
  };

  const endorsee: DianEventParty = {
    document_type: '31',
    document_number: '901555444',
    document_dv: '7',
    legal_name: 'Factoring SAS',
  };

  function build(
    event_code: DianEventCode,
    overrides: Record<string, unknown> = {},
  ): string {
    return UblApplicationResponseBuilder.build({
      event_number: '77',
      event_code,
      cude: 'a'.repeat(96),
      issue_date: '2026-08-04',
      issue_time: '10:15:00-05:00',
      sender,
      receiver,
      referenced_document_number: 'SETP990000001',
      referenced_document_key: 'b'.repeat(96),
      referenced_document_date: '2026-08-01',
      software_security: {
        software_id: 'guid-software',
        software_security_code: 'c'.repeat(96),
        provider_nit: '900123456',
        provider_nit_dv: '1',
      } as any,
      environment: 'test',
      ...overrides,
    });
  }

  /**
   * Rule AAD03 is a hard rejection: the literal must match exactly, and the annex
   * pins its length at 61 characters. Both are asserted because the plausible
   * variant ("de **la** Factura") is 64 and would fail silently at the DIAN.
   */
  it('carries the exact ProfileID literal the annex demands', () => {
    const xml = build(DIAN_EVENT_CODES.ACKNOWLEDGEMENT);
    const literal =
      'DIAN 2.1: ApplicationResponse de Factura Electrónica de Venta';

    expect(literal).toHaveLength(61);
    expect(xml).toContain(`<cbc:ProfileID>${literal}</cbc:ProfileID>`);
    expect(xml).not.toContain('Nodo Radian');
  });

  it('uses the event code as CustomizationID for a single-operation event', () => {
    const xml = build(DIAN_EVENT_CODES.ACKNOWLEDGEMENT);
    expect(xml).toContain('<cbc:CustomizationID>030</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:ResponseCode>030</cbc:ResponseCode>');
  });

  /**
   * The distinction that separates 035–051 from the reception family:
   * `CustomizationID` says WHICH variant of the act it is, while `ResponseCode`
   * stays the event. Collapsing them registers a different legal act.
   */
  it('separates the operation type from the response code on an endorsement', () => {
    const xml = build(DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP, {
      // 372 = endoso SIN responsabilidad del endosante.
      operation_code: '372',
      details: {
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.COMPLETE,
        issuer_party: endorsee,
        negotiation_info: [
          { name: DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT, value: '1500000.00' },
        ],
      },
    });

    expect(xml).toContain('<cbc:CustomizationID>372</cbc:CustomizationID>');
    expect(xml).toContain('listID="1"');
    expect(xml).toMatch(/<cbc:ResponseCode listID="1">037<\/cbc:ResponseCode>/);
  });

  it('omits the endorsement listID when the event does not carry one', () => {
    const xml = build(DIAN_EVENT_CODES.ACKNOWLEDGEMENT);
    // An empty listID is not "no endorsement type", it is an invalid code.
    expect(xml).not.toContain('listID=');
  });

  it('emits InformacionNegociacion as its own extension, before the signature slot', () => {
    const xml = build(DIAN_EVENT_CODES.ENDORSEMENT_COLLATERAL, {
      operation_code: '038',
      details: {
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.BLANK,
        negotiation_info: [
          { name: DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT, value: '900000.00' },
        ],
      },
    });

    expect(xml).toContain('<CustomTagGeneral');
    expect(xml).toContain('<InformacionNegociacion>');
    expect(xml).toContain('<Name>ValorTotalEndoso</Name>');
    expect(xml).toContain('<Value>900000.00</Value>');

    // The signer replaces the LAST empty ExtensionContent, so the negotiation block
    // must come before it — otherwise the block travels unsigned.
    const negotiation_at = xml.indexOf('InformacionNegociacion');
    const last_extension_at = xml.lastIndexOf('<ext:ExtensionContent');
    expect(negotiation_at).toBeLessThan(last_extension_at);
  });

  /**
   * UBL sequences DocumentResponse as Response → DocumentReference → IssuerParty.
   * Emitting IssuerParty earlier passes every string assertion and fails the XSD.
   */
  it('places IssuerParty after the DocumentReference', () => {
    const xml = build(DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP, {
      operation_code: '371',
      details: {
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.COMPLETE,
        issuer_party: endorsee,
      },
    });

    expect(xml).toContain('901555444');
    expect(xml.indexOf('<cac:DocumentReference>')).toBeLessThan(
      xml.indexOf('<cac:IssuerParty>'),
    );
  });

  it('omits the mandate validity period entirely when no dates are given', () => {
    const xml = build(DIAN_EVENT_CODES.MANDATE, { operation_code: '432' });
    // 432 = mandato por tiempo ILIMITADO: an absent period is what states that, so
    // emitting empty dates would assert a bounded mandate with no bounds.
    expect(xml).not.toContain('ValidityPeriod');
  });

  it('emits the mandate validity period when the mandate is time-limited', () => {
    const xml = build(DIAN_EVENT_CODES.MANDATE, {
      operation_code: '431',
      details: {
        validity_start_date: '2026-08-04',
        validity_end_date: '2027-08-03',
      },
    });

    expect(xml).toContain('<cbc:StartDate>2026-08-04</cbc:StartDate>');
    expect(xml).toContain('<cbc:EndDate>2027-08-03</cbc:EndDate>');
  });
});
