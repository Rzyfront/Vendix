import { DianEventsService } from './dian-events.service';
import {
  DIAN_ENDORSEMENT_LIST_IDS,
  DIAN_EVENT_CODES,
  DIAN_NEGOTIATION_FIELDS,
} from '../providers/dian-direct/constants/dian-endpoints';
import { DianDirectProvider } from '../providers/dian-direct/dian-direct.provider';

/**
 * These tests are about ONE property: an event that the annex would reject never
 * leaves Vendix.
 *
 * A rejected RADIAN event is not a retryable no-op — it is reported against an
 * event consecutive already spent, and the DIAN answers with an XPath rather than
 * with the field a merchant can fill. So every legally required value is checked
 * BEFORE the row is written and before the provider is called.
 */
describe('DianEventsService', () => {
  const acceptedInvoice = {
    id: 55,
    organization_id: 1,
    store_id: 2,
    invoice_number: 'FE100',
    status: 'accepted',
    cufe: 'b'.repeat(96),
    issue_date: new Date('2026-08-01T12:00:00Z'),
    customer_name: 'Adquiriente SAS',
    customer_tax_id: '800987654',
    supplier: {
      name: 'Adquiriente SAS',
      tax_id: '800987654',
      document_type: '31',
      verification_digit: '3',
    },
  };

  const endorsee = {
    document_type: '31',
    document_number: '901555444',
    document_dv: '7',
    legal_name: 'Factoring SAS',
  };

  function createService(overrides: any = {}) {
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(acceptedInvoice),
      },
      dian_document_events: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 7 }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 7, ...data })),
      },
      ...overrides.prisma,
    };

    // A real DianDirectProvider instance is required by the `instanceof` gate, but
    // nothing of it is exercised: only sendDocumentEvent is called.
    const provider = Object.create(
      DianDirectProvider.prototype,
    ) as DianDirectProvider;
    const sendDocumentEvent = jest.fn().mockResolvedValue({
      success: true,
      event_code: '030',
      dian_configuration_id: 3,
      cude: 'c'.repeat(96),
      request_xml: '<xml/>',
      errors: [],
    });
    (provider as any).sendDocumentEvent = sendDocumentEvent;

    const resolver = { resolve: jest.fn().mockResolvedValue(provider) };

    return {
      service: new DianEventsService(prisma as any, resolver as any),
      prisma,
      sendDocumentEvent,
    };
  }

  it('registers a reception event without any negotiation data', async () => {
    const { service, sendDocumentEvent } = createService();

    await service.register(55, {
      event_code: DIAN_EVENT_CODES.ACKNOWLEDGEMENT,
    });

    const sent = sendDocumentEvent.mock.calls[0][0];
    expect(sent.event_code).toBe('030');
    // Single-operation event: the annex reuses the event code as CustomizationID.
    expect(sent.operation_code).toBe('030');
    expect(sent.details).toBeUndefined();
    // 030 is an act of the BUYER, so it travels adquiriente → emisor.
    expect(sent.generated_by).toBe('customer');
  });

  it('sends 034 from the issuer side', async () => {
    const { service, sendDocumentEvent } = createService();

    await service.register(55, {
      event_code: DIAN_EVENT_CODES.TACIT_ACCEPTANCE,
    });

    // The emisor counts the 3 business days and declares the silence.
    expect(sendDocumentEvent.mock.calls[0][0].generated_by).toBe('issuer');
  });

  /**
   * 051's responsable is the "adquiriente/deudor/aceptante" (numeral 14.2.1), the
   * only event of the 035–051 family that does NOT travel from the holder's side.
   */
  it('sends 051 from the customer side', async () => {
    const { service, sendDocumentEvent } = createService();

    await service.register(55, {
      event_code: DIAN_EVENT_CODES.ECONOMIC_RIGHTS_TRANSFER_PAYMENT,
      operation_code: '512',
      negotiation_info: {
        [DIAN_NEGOTIATION_FIELDS.CURRENT_VALUE]: '1500000.00',
      },
    });

    expect(sendDocumentEvent.mock.calls[0][0].generated_by).toBe('customer');
  });

  describe('operation type (numeral 14.1.2)', () => {
    it('demands one when the event has several, listing the options', async () => {
      const { service, prisma, sendDocumentEvent } = createService();

      await expect(
        service.register(55, {
          event_code: DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP,
        }),
      ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_005' });

      // Nothing was written and no consecutive was spent.
      expect(prisma.dian_document_events.create).not.toHaveBeenCalled();
      expect(sendDocumentEvent).not.toHaveBeenCalled();
    });

    it('rejects an operation type that belongs to another event', async () => {
      const { service } = createService();

      await expect(
        service.register(55, {
          event_code: DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP,
          // 451 is a payment operation, not an endorsement one.
          operation_code: '451',
          endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.BLANK,
          negotiation_info: {
            [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '1500000.00',
            [DIAN_NEGOTIATION_FIELDS.PRICE_TO_PAY]: '1425000.00',
            [DIAN_NEGOTIATION_FIELDS.DISCOUNT_RATE]: '0.05',
            [DIAN_NEGOTIATION_FIELDS.PAYMENT_MEANS]: '31',
          },
        }),
      ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_005' });
    });

    it('accepts a valid variant and forwards it as the CustomizationID', async () => {
      const { service, sendDocumentEvent } = createService();

      await service.register(55, {
        event_code: DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP,
        operation_code: '372',
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.COMPLETE,
        issuer_party: endorsee,
        negotiation_info: {
          [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '1500000.00',
          [DIAN_NEGOTIATION_FIELDS.PRICE_TO_PAY]: '1425000.00',
          [DIAN_NEGOTIATION_FIELDS.DISCOUNT_RATE]: '0.05',
          [DIAN_NEGOTIATION_FIELDS.PAYMENT_MEANS]: '31',
        },
      });

      const sent = sendDocumentEvent.mock.calls[0][0];
      expect(sent.operation_code).toBe('372');
      expect(sent.details.issuer_party).toEqual(endorsee);
      expect(sent.details.endorsement_list_id).toBe('1');
      expect(sent.details.negotiation_info).toEqual(
        expect.arrayContaining([
          { name: 'ValorTotalEndoso', value: '1500000.00' },
          { name: 'TasaDescuento', value: '0.05' },
        ]),
      );
    });
  });

  describe('required negotiation data', () => {
    it('names the missing fields instead of transmitting', async () => {
      const { service, sendDocumentEvent } = createService();

      const promise = service.register(55, {
        event_code: DIAN_EVENT_CODES.ENDORSEMENT_OWNERSHIP,
        operation_code: '371',
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.BLANK,
        negotiation_info: {
          [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '1500000.00',
        },
      });

      await expect(promise).rejects.toMatchObject({
        errorCode: 'DIAN_EVENT_005',
      });
      // The merchant must read WHICH values are missing, not an XPath.
      await expect(promise).rejects.toThrow(/PrecioPagarseFEV/);
      expect(sendDocumentEvent).not.toHaveBeenCalled();
    });

    it('treats a blank string as missing', async () => {
      const { service } = createService();

      await expect(
        service.register(55, {
          event_code: DIAN_EVENT_CODES.GUARANTEE,
          negotiation_info: { [DIAN_NEGOTIATION_FIELDS.GUARANTEED_VALUE]: '  ' },
        }),
      ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_005' });
    });

    it('requires only what the annex states for the event', async () => {
      const { service, sendDocumentEvent } = createService();

      // 038 (endoso en garantía) requires the total only — no price, no rate.
      await service.register(55, {
        event_code: DIAN_EVENT_CODES.ENDORSEMENT_COLLATERAL,
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.BLANK,
        negotiation_info: {
          [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '900000.00',
        },
      });

      expect(sendDocumentEvent).toHaveBeenCalled();
    });
  });

  describe('endorsement listID (numeral 14.2.3)', () => {
    it('demands the endorsement type on an endorsement event', async () => {
      const { service } = createService();

      await expect(
        service.register(55, {
          event_code: DIAN_EVENT_CODES.ENDORSEMENT_PROXY,
          negotiation_info: {
            [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '900000.00',
          },
        }),
      ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_005' });
    });

    /**
     * Art. 654 C.Co. allows an endorsement signed in blank, so demanding the
     * endorsee on every endorsement would block a form the Código de Comercio
     * expressly permits.
     */
    it('requires the endorsee only when the endorsement is COMPLETE', async () => {
      const { service, sendDocumentEvent } = createService();

      await expect(
        service.register(55, {
          event_code: DIAN_EVENT_CODES.ENDORSEMENT_PROXY,
          endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.COMPLETE,
          negotiation_info: {
            [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '900000.00',
          },
        }),
      ).rejects.toThrow(/endosatario/);

      await service.register(55, {
        event_code: DIAN_EVENT_CODES.ENDORSEMENT_PROXY,
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.BLANK,
        negotiation_info: {
          [DIAN_NEGOTIATION_FIELDS.TOTAL_ENDORSEMENT]: '900000.00',
        },
      });

      expect(sendDocumentEvent).toHaveBeenCalledTimes(1);
    });

    it('does not attach a listID to a non-endorsement event', async () => {
      const { service, sendDocumentEvent } = createService();

      await service.register(55, {
        event_code: DIAN_EVENT_CODES.MANDATE,
        operation_code: '432',
        // Passed by a careless caller; must not reach the XML.
        endorsement_list_id: DIAN_ENDORSEMENT_LIST_IDS.COMPLETE,
      });

      // The stray listID is dropped, and with nothing else to carry the event goes
      // out with no details block at all — which is what a mandate needs.
      expect(sendDocumentEvent.mock.calls[0][0].details).toBeUndefined();
    });
  });

  it('rejects an unsupported event code before touching the database', async () => {
    const { service, prisma } = createService();

    await expect(
      service.register(55, { event_code: '999' }),
    ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_002' });
    expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to register an event on an invoice DIAN has not accepted', async () => {
    const { service } = createService({
      prisma: {
        invoices: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...acceptedInvoice, status: 'validated' }),
        },
      },
    });

    await expect(
      service.register(55, { event_code: DIAN_EVENT_CODES.ACKNOWLEDGEMENT }),
    ).rejects.toMatchObject({ errorCode: 'DIAN_EVENT_001' });
  });
});
