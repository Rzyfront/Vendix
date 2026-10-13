import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentInboxStatusService } from './received-document-inbox-status.service';
import { inboxBaseWhere, inboxStateWhere, INBOX_STATES } from './received-document-inbox-projection';
import { ReceivedDocumentsReadContext } from './received-documents-context.service';
import { ReceivedDocumentQueryDto } from '../dto/received-document.dto';

const context: ReceivedDocumentsReadContext = {
  organization_id: 3, accounting_entity_id: 8, store_id: 21,
  is_organization: false, fiscal_scope: 'ORGANIZATION', actor_id: 55,
};
const now = new Date('2026-10-13T10:00:00Z');
function harness() {
  const tx = {
    received_documents: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { created_at: now } }),
    },
    dian_configurations: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    document_reception_connections: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(0),
      groupBy: jest.fn().mockResolvedValue([
        { connection_type: 'api_poll', _count: { _all: 2 } },
        { connection_type: 'webhook', _count: { _all: 1 } },
      ]),
      aggregate: jest.fn().mockResolvedValueOnce({ _max: { last_synced_at: now } })
        .mockResolvedValueOnce({ _min: { next_sync_at: now } }),
    },
    document_reception_runs: { findFirst: jest.fn().mockResolvedValue({ status: 'completed', received_count: 2, duplicate_count: 1, error_count: 0, finished_at: now }) },
  };
  const transaction = jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx));
  const service = new ReceivedDocumentInboxStatusService({ $transaction: transaction } as unknown as GlobalPrismaService);
  return { tx, transaction, service };
}

describe('received inbox summary and secret-free reception health', () => {
  it('counts all scoped matches rather than a page and omits attention/legal state filters', async () => {
    const h = harness();
    const counts = [55, 11, 42, 6];
    for (const count of counts) h.tx.received_documents.count.mockResolvedValueOnce(count);
    const query: ReceivedDocumentQueryDto = { page: 2, limit: 25, search: 'Proveedor', source_channel: 'api', document_type: 'invoice', inbox_state: 'new', legal_status: 'accepted', validation_status: 'invalid' };
    const summary = await h.service.summary(context, query);
    expect(summary).toMatchObject({ new: 55, requires_review: 11, accepted: 42, reclaimed: 6, total: 114 });
    expect(summary.as_of).toBeInstanceOf(Date);
    expect(h.tx.received_documents.count).toHaveBeenCalledTimes(4);
    INBOX_STATES.forEach((state, index) => expect(h.tx.received_documents.count).toHaveBeenNthCalledWith(index + 1, {
      where: { AND: [inboxBaseWhere(context, query), inboxStateWhere(state)] },
    }));
    expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });

  it('returns empty counts and inactive health without querying when the fiscal entity is missing', async () => {
    const h = harness();
    const missing = { ...context, accounting_entity_id: null };
    expect(await h.service.summary(missing, { page: 1, limit: 25 })).toMatchObject({ new: 0, requires_review: 0, accepted: 0, reclaimed: 0, total: 0 });
    expect(await h.service.receptionStatus(missing, missing)).toMatchObject({ dian_active: false, configured: false, active_connections: 0, channels: [], last_run: null });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it('exposes only compact health and queries canonical active production invoicing configuration', async () => {
    const h = harness();
    const health = await h.service.receptionStatus(context, context);
    expect(health).toEqual({
      dian_active: true, configured: true, active_connections: 3, channels: ['api_poll', 'webhook'],
      last_received_at: now, last_synced_at: now, next_sync_at: now,
      last_run: { status: 'completed', received_count: 2, duplicate_count: 1, error_count: 0, finished_at: now },
      error_code: null, requires_operational_store: false,
    });
    expect(h.tx.dian_configurations.findFirst).toHaveBeenCalledWith({
      where: { organization_id: 3, accounting_entity_id: 8, configuration_type: 'invoicing', environment: 'production', enablement_status: 'enabled' }, select: { id: true },
    });
    expect(h.tx.document_reception_runs.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { connection: { is: { organization_id: 3, accounting_entity_id: 8, store_id: 21 } } },
      select: { status: true, received_count: true, duplicate_count: true, error_count: true, finished_at: true },
    }));
    expect(JSON.stringify(health)).not.toMatch(/endpoint|public_token|secret|cursor|payload|summary/);
  });

  it('counts only enabled connections with valid operational store and actor ownership', async () => {
    const h = harness();
    await h.service.receptionStatus(context, context);
    expect(h.tx.document_reception_connections.groupBy).toHaveBeenCalledWith({
      by: ['connection_type'], _count: { _all: true },
      where: { AND: [
        { organization_id: 3, accounting_entity_id: 8, store_id: 21 },
        { enabled: true, connection_type: { in: ['api_poll', 'webhook'] }, store_id: { gt: 0 }, created_by: { gt: 0 },
          store: { is: { organization_id: 3, is_active: true } }, creator: { is: { organization_id: 3, state: 'active' } } },
      ] },
    });
  });

  it('allows aggregate organization history while requiring a selected store for configuration', async () => {
    const h = harness();
    const organization = { ...context, is_organization: true, store_id: null };
    expect((await h.service.receptionStatus(organization, organization)).requires_operational_store).toBe(true);
    expect(h.tx.document_reception_connections.count).toHaveBeenNthCalledWith(1, { where: { organization_id: 3, accounting_entity_id: 8 } });
  });

  it('keeps reception errors generic and never reflects unsafe provider diagnostics', async () => {
    const h = harness();
    h.tx.document_reception_runs.findFirst.mockResolvedValue({ status: 'failed', received_count: 0, duplicate_count: 0, error_count: 1, finished_at: now });
    const health = await h.service.receptionStatus(context, context);
    expect(health.error_code).toBe('RECEPTION_CONNECTION_ERROR');
    expect(health.last_run?.status).toBe('failed');
    expect(health).not.toHaveProperty('last_error');
  });
});
