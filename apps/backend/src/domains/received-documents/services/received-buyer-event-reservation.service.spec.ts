import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ReceivedBuyerEventReservationService } from './received-buyer-event-reservation.service';
import { ReceivedDocumentsContext } from '../received-documents.service';

const context: ReceivedDocumentsContext = {
  organization_id: 5, accounting_entity_id: 7, store_id: 11, actor_id: 13, is_organization: false,
};
const validDocument = {
  id: 42,
  document_type: 'invoice',
  document_key: 'a'.repeat(96),
  invoice_number: 'SUP-2026-01',
  issue_date: new Date('2026-01-20T00:00:00.000Z'),
  issuer_tax_id: '900111222-3',
  issuer_name: 'Supplier SAS',
  receiver_tax_id: '900123456-8',
  receiver_name: 'Buyer SAS',
  validation_status: 'valid',
  review_status: 'reviewed',
  version: 6,
};

function harness(options: {
  events?: any[];
  document?: any;
  receipt?: any;
} = {}) {
  const tx = {
    $queryRaw: jest.fn((query: any) => Promise.resolve(
      query.sql?.includes('received_buyer_event_enablements')
        ? [{ id: 3, status: 'verified', version: 4, dian_configuration_id: 21 }]
        : [{ id: 42 }],
    )),
    accounting_entities: { findFirst: jest.fn().mockResolvedValue({ tax_id: '900123456-8', store_id: null }) },
    received_documents: { findFirst: jest.fn().mockResolvedValue(options.document ?? validDocument) },
    received_document_events: {
      findMany: jest.fn().mockResolvedValue(options.events ?? []),
      create: jest.fn().mockResolvedValue({ id: 77 }),
      update: jest.fn().mockResolvedValue({ id: 77 }),
    },
    received_document_match_allocations: { findFirst: jest.fn().mockResolvedValue(options.receipt ?? null) },
  };
  const prisma = { $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
  const documents = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const enablement = {
    getReadiness: jest.fn().mockResolvedValue({ ready: true, blockers: [], status: 'verified', event_codes: ['030', '031', '032', '033'] }),
    getStatus: jest.fn().mockResolvedValue({ status: 'verified', version: 4, dian_configuration_id: 21 }),
  };
  const service = new ReceivedBuyerEventReservationService(prisma as any, documents as any, enablement as any);
  return { service, prisma, tx, documents, enablement };
}

describe('ReceivedBuyerEventReservationService', () => {
  it('reserves a policy-ready event using a stable row-derived number', async () => {
    const h = harness();
    h.enablement.getStatus.mockResolvedValue({ status: 'suspended', version: 99, dian_configuration_id: 88 });

    await expect(h.service.reserve(context, 42, {
      event_code: '030', idempotency_key: 'mobile-req-1',
    })).resolves.toEqual({
      event_id: 77, event_number: 'RD77', duplicate: false, status: 'preparing',
      dian_configuration_id: 21, activation_version: 4,
    });
    expect(h.documents.assertContext).toHaveBeenCalledWith(context);
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(h.enablement.getStatus).not.toHaveBeenCalled();
    expect(h.tx.received_document_events.create.mock.calls[0][0].data.result).toEqual({
      description: null, claim_concept_code: null, document_version: 6,
      referenced_cufe: 'a'.repeat(96), activation_version: 4, dian_configuration_id: 21,
    });
    expect(h.tx.received_document_events.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        event_type: 'BUYER_DIAN_EVENT', event_code: '030', idempotency_key: 'buyer:mobile-req-1',
        status: 'preparing', actor_id: 13,
      }),
    }));
    expect(h.tx.received_document_events.update).toHaveBeenCalledWith({ where: { id: 77 }, data: { event_number: 'RD77' } });
  });

  it('returns the existing reservation for the same idempotency key and action without creating or sending another event', async () => {
    const h = harness({ events: [{
      id: 77, event_code: '030', idempotency_key: 'buyer:mobile-req-1', status: 'unknown', event_number: 'RD77',
      result: { description: null, claim_concept_code: null, dian_configuration_id: 19, activation_version: 2 },
    }] });

    await expect(h.service.reserve(context, 42, { event_code: '030', idempotency_key: 'mobile-req-1' })).resolves.toEqual({
      event_id: 77, event_number: 'RD77', duplicate: true, status: 'unknown',
      dian_configuration_id: 19, activation_version: 2,
    });
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('conflicts for an existing accepted or uncertain event, even with a new client key', async () => {
    const h = harness({ events: [{
      id: 70, event_code: '030', idempotency_key: 'buyer:old', status: 'unknown', event_number: 'RD70', result: {},
    }] });

    await expect(h.service.reserve(context, 42, { event_code: '032', idempotency_key: 'new' })).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('returns an existing unknown reservation after activation is suspended but blocks new reservations', async () => {
    const existing = {
      id: 77, event_code: '030', idempotency_key: 'buyer:mobile-req-1', status: 'unknown', event_number: 'RD77',
      result: { description: null, claim_concept_code: null, dian_configuration_id: 19, activation_version: 2 },
    };
    const replay = harness({ events: [existing] });
    replay.enablement.getReadiness.mockResolvedValue({ ready: false, blockers: ['suspended'] });
    replay.enablement.getStatus.mockResolvedValue({ status: 'suspended', version: 3, dian_configuration_id: 19 });

    await expect(replay.service.reserve(context, 42, { event_code: '030', idempotency_key: 'mobile-req-1' })).resolves.toMatchObject({
      duplicate: true, status: 'unknown', dian_configuration_id: 19, activation_version: 2,
    });
    expect(replay.enablement.getReadiness).not.toHaveBeenCalled();
    expect(replay.tx.received_document_events.create).not.toHaveBeenCalled();

    const fresh = harness();
    fresh.enablement.getReadiness.mockResolvedValue({ ready: false, blockers: ['suspended'] });
    await expect(fresh.service.reserve(context, 42, { event_code: '030', idempotency_key: 'new' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(fresh.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('requires an accepted prior acknowledgement and qualifying active reception allocation for 032', async () => {
    const h = harness({ receipt: { id: 88 } });

    await expect(h.service.reserve(context, 42, { event_code: '032', idempotency_key: 'goods' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();

    const acknowledged = harness({
      receipt: { id: 88 },
      events: [{ id: 69, event_code: '030', status: 'accepted', event_type: 'BUYER_DIAN_EVENT', idempotency_key: 'buyer:ack', result: {} }],
    });
    await expect(acknowledged.service.reserve(context, 42, { event_code: '032', idempotency_key: 'goods' })).resolves.toMatchObject({ duplicate: false, event_number: 'RD77' });
  });

  it('requires and persists the 031 claim concept code after accepted 030 and 032', async () => {
    const acceptedPredecessors = [
      { id: 69, event_code: '030', status: 'accepted', event_type: 'BUYER_DIAN_EVENT', idempotency_key: 'buyer:ack', result: {} },
      { id: 70, event_code: '032', status: 'accepted', event_type: 'BUYER_DIAN_EVENT', idempotency_key: 'buyer:goods', result: {} },
    ];
    const missingCode = harness({ events: acceptedPredecessors });
    await expect(missingCode.service.reserve(context, 42, {
      event_code: '031', idempotency_key: 'claim-missing', description: 'Quantity differs',
    })).rejects.toThrow('concepto de reclamo válido');
    expect(missingCode.prisma.$transaction).not.toHaveBeenCalled();

    const invalidCode = harness({ events: acceptedPredecessors });
    await expect(invalidCode.service.reserve(context, 42, {
      event_code: '031', idempotency_key: 'claim-invalid', description: 'Quantity differs',
      claim_concept_code: '05' as any,
    })).rejects.toThrow('concepto de reclamo válido');
    expect(invalidCode.prisma.$transaction).not.toHaveBeenCalled();

    const valid = harness({ events: acceptedPredecessors });
    await expect(valid.service.reserve(context, 42, {
      event_code: '031', idempotency_key: 'claim-valid', description: 'Internal note: quantity differs',
      claim_concept_code: '02',
    })).resolves.toMatchObject({ duplicate: false, event_number: 'RD77' });
    expect(valid.tx.received_document_events.create.mock.calls[0][0].data.result).toEqual({
      description: 'Internal note: quantity differs', claim_concept_code: '02',
      document_version: 6, referenced_cufe: 'a'.repeat(96),
      activation_version: 4, dian_configuration_id: 21,
    });
  });

  it('rejects a same-key replay when the claim concept code changes', async () => {
    const h = harness({ events: [{
      id: 77, event_code: '031', idempotency_key: 'buyer:claim', status: 'unknown', event_number: 'RD77',
      result: { description: 'Quantity differs', claim_concept_code: '01', dian_configuration_id: 19, activation_version: 2 },
    }] });
    await expect(h.service.reserve(context, 42, {
      event_code: '031', idempotency_key: 'claim', description: 'Quantity differs', claim_concept_code: '02',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('fails closed on malformed CUFE and does not reserve a row', async () => {
    const h = harness({ document: { ...validDocument, document_key: 'not-a-cufe' } });

    await expect(h.service.reserve(context, 42, { event_code: '030', idempotency_key: 'bad-key' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('rejects invalid ids, unsafe idempotency keys, and missing 031 reasons before database work', async () => {
    const h = harness();

    await expect(h.service.reserve(context, 0, { event_code: '030', idempotency_key: 'valid' })).rejects.toThrow();
    await expect(h.service.reserve(context, 42, { event_code: '030', idempotency_key: 'bad key' })).rejects.toThrow();
    await expect(h.service.reserve(context, 42, { event_code: '031', idempotency_key: 'valid' })).rejects.toThrow();
    await expect(h.service.reserve(context, 42, { event_code: '031', idempotency_key: 'valid', description: 'Reason', claim_concept_code: '05' as any })).rejects.toThrow();
    await expect(h.service.reserve(context, 42, { event_code: '030', idempotency_key: 'valid', claim_concept_code: '01' })).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
