import { UnprocessableEntityException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedBuyerEventPayloadService } from './received-buyer-event-payload.service';

const context: ReceivedDocumentsContext = { organization_id: 5, accounting_entity_id: 7, store_id: null, actor_id: 9, is_organization: true };
const baseEvent = () => ({
  id: 41, event_code: '030', event_number: 'RD41', actor_id: 9,
  result: { document_version: 3, referenced_cufe: 'a'.repeat(96), activation_version: 2, dian_configuration_id: 18, claim_concept_code: null },
  document: { id: 30, organization_id: 5, accounting_entity_id: 7, store_id: null, version: 3, document_key: 'a'.repeat(96), invoice_number: 'INV-1', issue_date: new Date('2025-01-01T00:00:00.000Z'), issuer_tax_id: '800123456', issuer_name: 'Supplier SAS', receiver_tax_id: '900123456' },
});

function setup(code = '030') {
  const event = baseEvent(); event.event_code = code;
  const delegates = {
    accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 7, organization_id: 5, store_id: null, tax_id: '900123456', legal_name: 'Buyer SAS' }) },
    received_document_events: { findFirst: jest.fn().mockResolvedValue(event) },
    received_buyer_event_enablements: { findFirst: jest.fn().mockResolvedValue({ status: 'verified', version: 2, dian_configuration_id: 18 }) },
    users: { findFirst: jest.fn().mockResolvedValue({ document_type: 'CC', document_number: '12345678', verification_digit: null, first_name: 'Ana', last_name: 'Pérez' }) },
    received_document_match_allocations: { findMany: jest.fn().mockResolvedValue([{ reception: { received_by_user_id: 22 } }]) },
    store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new ReceivedBuyerEventPayloadService(
    { withoutScope: jest.fn().mockReturnValue(delegates) } as unknown as GlobalPrismaService,
    { assertContext: jest.fn().mockResolvedValue(undefined) } as unknown as ReceivedDocumentsService,
  );
  return { service, event, ...delegates };
}

describe('ReceivedBuyerEventPayloadService', () => {
  it('builds a 030 customer party, receipt person and civil document date safely', async () => {
    const h = setup();
    const result = await h.service.build(context, 41);
    expect(result.request).toMatchObject({
      event_code: '030', generated_by: 'customer', referenced_document_date: '2025-01-01',
      customer: { document_type: '31', document_number: '900123456', legal_name: 'Buyer SAS' },
      referenced_issuer: { document_type: '31', document_number: '800123456', legal_name: 'Supplier SAS' },
      details: { receipt_person: { document_type: '13', document_number: '12345678', first_name: 'Ana', family_name: 'Pérez' } },
    });
    expect(result.selection).toEqual({ configuration_id: 18, accounting_entity_id: 7, store_id: null });
    expect(result.source).toEqual({ document_id: 30, document_version: 3, referenced_cufe: 'a'.repeat(96), activation_version: 2 });
  });

  it('preserves non-NIT legal identity characters instead of stripping them', async () => {
    const h = setup();
    h.users.findFirst.mockResolvedValue({ document_type: 'PA', document_number: 'A123-BC9', verification_digit: null, first_name: 'Ana', last_name: 'Pérez' });
    const result = await h.service.build(context, 41);
    expect(result.request.details?.receipt_person).toMatchObject({ document_type: '41', document_number: 'A123-BC9' });
  });

  it('sends only the DIAN claim concept for 031, never the free-form user description', async () => {
    const h = setup('031');
    Object.assign(h.event.result, { claim_concept_code: '02', description: 'Do not send this description' });
    const result = await h.service.build(context, 41);
    expect(result.request.details).toEqual({ claim_concept_code: '02' });
    expect(result.request.description).toBeUndefined();
  });

  it('uses the receiver captured on active reception allocations for 032, not the actor', async () => {
    const h = setup('032');
    h.users.findFirst.mockResolvedValue({ document_type: 'CC', document_number: '87654321', verification_digit: null, first_name: 'Luis', last_name: 'Rojas' });
    const result = await h.service.build(context, 41);
    expect(h.received_document_match_allocations.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ document_id: 30, organization_id: 5, accounting_entity_id: 7, status: 'active', reception_id: { not: null }, reception_item_id: { not: null } }) }));
    expect(result.request.details?.receipt_person).toMatchObject({ document_number: '87654321', first_name: 'Luis' });
  });

  it.each(['missing person', 'ambiguous receiver'])('blocks 032 when there is a %s', async (reason) => {
    const h = setup('032');
    if (reason === 'missing person') h.received_document_match_allocations.findMany.mockResolvedValue([]);
    else h.received_document_match_allocations.findMany.mockResolvedValue([{ reception: { received_by_user_id: 22 } }, { reception: { received_by_user_id: 23 } }]);
    await expect(h.service.build(context, 41)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it.each([null, 0, '22'])('blocks 032 when a qualifying allocation has invalid receiver id %s', async (receiverId) => {
    const h = setup('032');
    h.received_document_match_allocations.findMany.mockResolvedValue([
      { reception: { received_by_user_id: 22 } },
      { reception: { received_by_user_id: receiverId } },
    ]);
    await expect(h.service.build(context, 41)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it.each([
    ['foreign document', (h: ReturnType<typeof setup>) => { h.event.document.organization_id = 88; }],
    ['non-preparing event', (h: ReturnType<typeof setup>) => { h.received_document_events.findFirst.mockResolvedValue(null); }],
    ['version drift', (h: ReturnType<typeof setup>) => { h.event.document.version++; }],
    ['CUFE drift', (h: ReturnType<typeof setup>) => { h.event.document.document_key = 'b'.repeat(96); }],
    ['activation drift', (h: ReturnType<typeof setup>) => { h.received_buyer_event_enablements.findFirst.mockResolvedValue({ status: 'verified', version: 3, dian_configuration_id: 18 }); }],
    ['noncanonical event number', (h: ReturnType<typeof setup>) => { h.event.event_number = 'RD999'; }],
    ['nonpositive configuration snapshot', (h: ReturnType<typeof setup>) => { h.event.result.dian_configuration_id = 0; }],
    ['malformed snapshot CUFE', (h: ReturnType<typeof setup>) => { h.event.result.referenced_cufe = 'not-a-cufe'; }],
  ])('rejects %s before returning a request', async (_name, mutate) => {
    const h = setup(); mutate(h);
    await expect(h.service.build(context, 41)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('uses one tenant-local clock instant for date and offset-bearing issue time at the timezone boundary', async () => {
    const h = setup();
    const resolveOrganizationTimezone = jest.requireActual('../../../common/utils/store-timezone.util').resolveOrganizationTimezone;
    h.store_settings.findFirst.mockResolvedValue({ settings: { general: { timezone: 'America/Bogota' } }, stores: { timezone: null } });
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T04:05:06.000Z'));
    try {
      const result = await h.service.build(context, 41);
      expect(result.request.issue_date).toBe('2024-12-31');
      expect(result.request.issue_time).toBe('23:05:06-05:00');
      expect(resolveOrganizationTimezone).toBeDefined();
    } finally { jest.useRealTimers(); }
  });
});
