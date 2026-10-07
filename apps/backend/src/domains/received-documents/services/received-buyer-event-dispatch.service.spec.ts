import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { DianDirectProvider } from '../../store/invoicing/providers/dian-direct/dian-direct.provider';
import { ReceivedBuyerEventPayloadService } from './received-buyer-event-payload.service';
import { ReceivedBuyerEventReservationService } from './received-buyer-event-reservation.service';
import { ReceivedBuyerEventDispatchService } from './received-buyer-event-dispatch.service';
import { ReceivedDocumentsContext } from '../received-documents.service';

const context: ReceivedDocumentsContext = { organization_id: 5, accounting_entity_id: 7, store_id: 11, actor_id: 9, is_organization: false };
const source = { document_id: 30, document_version: 4, referenced_cufe: 'a'.repeat(96), activation_version: 2 };
const reservedResult = { description: 'original explanation', claim_concept_code: '02', dian_configuration_id: 18, activation_version: 2, document_version: 4, referenced_cufe: source.referenced_cufe };
const prepared = {
  event_code: '030' as const, event_number: 'RD41', dian_configuration_id: 18, accounting_entity_id: 7, store_id: 11,
  environment: 'production' as const, cude: 'b'.repeat(96), signed_xml: '<ApplicationResponse/>', signed_xml_sha256: 'c'.repeat(64),
  xml_filename: 'event.xml', zip_filename: 'event.zip', software_id: 'private-software', certificate_s3_key: 'private-key',
  certificate_kms_key_id: 'private-kms', certificate_fingerprint: 'private-fingerprint',
};

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 41, status: 'preparing' }]).mockResolvedValueOnce([{ id: 41 }]).mockResolvedValueOnce([{ version: 2, dian_configuration_id: 18, software_id_snapshot: prepared.software_id, certificate_fingerprint_snapshot: prepared.certificate_fingerprint }]),
    received_document_events: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue({ result: reservedResult }) },
    received_document_event_attempts: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (arg: typeof tx) => unknown) => callback(tx)),
    received_document_events: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn() },
  };
  const reservations = { reserve: jest.fn().mockResolvedValue({ event_id: 41, event_number: 'RD41', duplicate: false, status: 'preparing', dian_configuration_id: 18, activation_version: 2 }) };
  const payloads = { build: jest.fn().mockResolvedValue({ request: { event_code: '030', event_number: 'RD41', referenced_document_key: source.referenced_cufe }, selection: { configuration_id: 18, accounting_entity_id: 7, store_id: 11 }, source }) };
  const dian = {
    assertReferencedInvoiceAccepted: jest.fn().mockResolvedValue({ document_key: source.referenced_cufe, checked_at: new Date().toISOString() }),
    prepareDocumentEvent: jest.fn().mockResolvedValue(prepared),
    sendPreparedDocumentEvent: jest.fn().mockResolvedValue({ ...prepared, success: true, delivery_status: 'accepted', request_xml: prepared.signed_xml, response_xml: '<Response/>', errors: [] }),
  };
  const service = new ReceivedBuyerEventDispatchService(prisma as unknown as GlobalPrismaService, reservations as unknown as ReceivedBuyerEventReservationService, payloads as unknown as ReceivedBuyerEventPayloadService, dian as unknown as DianDirectProvider);
  return { service, tx, prisma, reservations, payloads, dian };
}

describe('ReceivedBuyerEventDispatchService', () => {
  it('freezes the signed request and private metadata durably before a single SOAP transmission', async () => {
    const h = setup();
    h.dian.sendPreparedDocumentEvent.mockImplementation(async () => {
      expect(h.tx.received_document_events.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'sending', cude: prepared.cude, request_xml: prepared.signed_xml, attempt_count: { increment: 1 } }) }));
      expect(h.tx.received_document_event_attempts.create).toHaveBeenCalledWith({ data: expect.objectContaining({ attempt_number: 1, status: 'sending', request_xml: prepared.signed_xml, result: expect.objectContaining({ certificate_s3_key: 'private-key', certificate_kms_key_id: 'private-kms' }) }) });
      return { ...prepared, success: true, delivery_status: 'accepted', request_xml: prepared.signed_xml, response_xml: '<Response/>', errors: [] };
    });
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'accepted', duplicate: false });
    expect(h.dian.assertReferencedInvoiceAccepted).toHaveBeenCalledWith(source.referenced_cufe, { configuration_id: 18, accounting_entity_id: 7, store_id: 11 });
    expect(h.dian.prepareDocumentEvent).toHaveBeenCalledTimes(1);
    expect(h.dian.sendPreparedDocumentEvent).toHaveBeenCalledWith(prepared);
    expect(h.tx.received_document_events.updateMany.mock.calls[0][0].data).not.toHaveProperty('result');
    const outcomeResult = h.tx.received_document_events.updateMany.mock.calls[1][0].data.result;
    expect(outcomeResult).toMatchObject({ description: 'original explanation', claim_concept_code: '02', dian_configuration_id: 18, activation_version: 2, document_version: 4, referenced_cufe: source.referenced_cufe, delivery_status: 'accepted' });
    expect(outcomeResult).not.toHaveProperty('certificate_s3_key');
  });

  it('returns the historical duplicate without rebuilding or transmitting', async () => {
    const h = setup();
    h.reservations.reserve.mockResolvedValue({ event_id: 41, event_number: 'RD41', duplicate: true, status: 'accepted', dian_configuration_id: 18, activation_version: 2 });
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ duplicate: true, status: 'accepted' });
    expect(h.payloads.build).not.toHaveBeenCalled();
    expect(h.dian.sendPreparedDocumentEvent).not.toHaveBeenCalled();
  });

  it('marks failures before SOAP as preparation_failed and never sends', async () => {
    const h = setup(); h.payloads.build.mockRejectedValue(new Error('sensitive internals'));
    h.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ id: 41, status: 'preparing' }]);
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'preparation_failed' });
    const prepFailureResult = h.tx.received_document_events.updateMany.mock.calls[0][0].data.result;
    expect(prepFailureResult).toMatchObject({ description: 'original explanation', claim_concept_code: '02', dian_configuration_id: 18, activation_version: 2, failure_stage: 'preparation' });
    expect(h.dian.sendPreparedDocumentEvent).not.toHaveBeenCalled();
  });

  it('marks any post-send exception unknown and never auto-retries', async () => {
    const h = setup(); h.dian.sendPreparedDocumentEvent.mockRejectedValue(new Error('timeout after request may have arrived'));
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'unknown' });
    expect(h.dian.sendPreparedDocumentEvent).toHaveBeenCalledTimes(1);
    expect(h.tx.received_document_events.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'sending' }), data: expect.objectContaining({ status: 'unknown', result: expect.objectContaining({ delivery_status: 'unknown' }) }) }));
    expect(h.tx.received_document_event_attempts.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'unknown' } }));
    expect(h.tx.received_document_events.updateMany.mock.calls[1][0].data.result).toMatchObject({ description: 'original explanation', claim_concept_code: '02', dian_configuration_id: 18, activation_version: 2, delivery_status: 'unknown' });
    expect(JSON.stringify(h.tx.received_document_events.updateMany.mock.calls[1][0].data.result)).not.toContain('timeout after request');
    expect(h.tx.received_document_events.updateMany.mock.calls[1][0].where.document.is).toMatchObject({ organization_id: 5, accounting_entity_id: 7, store_id: 11 });
  });

  it('rejects non-production signed artifacts before freeze or transmission', async () => {
    const h = setup();
    h.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ id: 41, status: 'preparing' }]);
    h.dian.prepareDocumentEvent.mockResolvedValue({ ...prepared, environment: 'test' });
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'preparation_failed' });
    expect(h.tx.received_document_events.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'preparation_failed' }) }));
    expect(h.dian.sendPreparedDocumentEvent).not.toHaveBeenCalled();
  });

  it.each(['software_id_snapshot', 'certificate_fingerprint_snapshot'] as const)('rejects prepared artifact when activation %s changed', async (field) => {
    const h = setup();
    h.tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 41 }])
      .mockResolvedValueOnce([{ version: 2, dian_configuration_id: 18, software_id_snapshot: field === 'software_id_snapshot' ? 'rotated-software' : prepared.software_id, certificate_fingerprint_snapshot: field === 'certificate_fingerprint_snapshot' ? 'rotated-cert' : prepared.certificate_fingerprint }])
      .mockResolvedValue([{ id: 41, status: 'preparing' }]);
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'preparation_failed' });
    expect(h.tx.received_document_events.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'preparation_failed' }) }));
    expect(h.dian.sendPreparedDocumentEvent).not.toHaveBeenCalled();
  });

  it('omits raw transport messages from public and persisted parent results for unknown outcomes', async () => {
    const h = setup();
    h.dian.sendPreparedDocumentEvent.mockResolvedValue({ ...prepared, success: false, delivery_status: 'unknown', message: 'socket internals: secret', request_xml: prepared.signed_xml, errors: [{ message: 'socket internals: secret' }] });
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'unknown' });
    const parentResult = h.tx.received_document_events.updateMany.mock.calls[1][0].data.result;
    const attemptResult = h.tx.received_document_event_attempts.updateMany.mock.calls[0][0].data.result;
    expect(parentResult).not.toHaveProperty('message');
    expect(attemptResult).not.toHaveProperty('message');
    expect(JSON.stringify(parentResult)).not.toContain('socket internals');
    expect(JSON.stringify(attemptResult)).not.toContain('socket internals');
  });

  it('marks the reservation preparation_failed when a frozen source/version lock no longer matches', async () => {
    const h = setup(); h.tx.$queryRaw.mockReset().mockResolvedValueOnce([]);
    await expect(h.service.execute(context, 30, { event_code: '030', idempotency_key: 'once' })).resolves.toMatchObject({ status: 'unknown' });
    expect(h.dian.sendPreparedDocumentEvent).not.toHaveBeenCalled();
  });
});
