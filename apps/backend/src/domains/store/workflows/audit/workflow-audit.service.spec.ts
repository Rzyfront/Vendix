import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowAuditRequestContext } from './workflow-audit.context';
import { auditEntryHash, WorkflowAuditRow, WorkflowAuditService } from './workflow-audit.service';

const as = <T>(store_id: number, fn: () => Promise<T>, user_id: number | null = 7) =>
  RequestContextService.runIsolated(
    {
      store_id,
      organization_id: 1,
      user_id: user_id ?? undefined,
      email: user_id ? 'ana@tienda.co' : undefined,
      is_super_admin: false,
      is_owner: false,
    },
    fn,
  );

describe('WorkflowAuditService', () => {
  let db: FakeWorkflowDb;
  let audit: WorkflowAuditService;

  beforeEach(() => {
    db = new FakeWorkflowDb();
    audit = new WorkflowAuditService(db.asStorePrisma() as StorePrismaService);
  });

  const rows = (): WorkflowAuditRow[] => db.table('workflow_audit_log') as WorkflowAuditRow[];

  it('chains each store row to the previous one and the chain verifies', async () => {
    await as(10, () =>
      audit.recordNow({ action: 'definition.published', target_type: 'definition', target_id: 5, definition_id: 5, summary: 'Publicó «Compras» v2' }),
    );
    await as(10, () =>
      audit.recordNow({ action: 'decision.task_completed', target_type: 'task', target_id: 9, instance_id: 3, summary: 'Aprobó la solicitud FLU-3' }),
    );

    const [first, second] = rows();
    expect(BigInt(first.seq)).toBe(1n);
    expect(BigInt(second.seq)).toBe(2n);
    expect(first.prev_hash).toBeNull();
    expect(second.prev_hash).toBe(first.entry_hash);
    expect(first.entry_hash).toBe(auditEntryHash(null, first));
    expect(first.category).toBe('definition');
    expect(second.category).toBe('decision');

    await expect(as(10, () => audit.verify())).resolves.toEqual({
      valid: true,
      count: 2,
      broken_at_seq: null,
      last_hash: second.entry_hash,
    });
  });

  it('keeps one independent chain per store', async () => {
    await as(10, () => audit.recordNow({ action: 'secret.created', target_type: 'secret', summary: 'Creó el secreto API_ERP' }));
    await as(20, () => audit.recordNow({ action: 'secret.created', target_type: 'secret', summary: 'Creó el secreto TOKEN' }));

    const byStore = (s: number) => rows().filter((r) => r.store_id === s);
    expect(BigInt(byStore(10)[0].seq)).toBe(1n);
    expect(BigInt(byStore(20)[0].seq)).toBe(1n);
    expect(byStore(20)[0].prev_hash).toBeNull();
    await expect(as(20, () => audit.verify())).resolves.toMatchObject({ valid: true, count: 1 });
  });

  it('records the authenticated actor, the request origin and safe details', async () => {
    await WorkflowAuditRequestContext.run({ ip_address: '181.50.1.2', user_agent: 'Mozilla/5.0' }, () =>
      as(10, () =>
        audit.recordNow({
          action: 'secret.updated',
          target_type: 'secret',
          target_id: 'API_ERP',
          summary: 'Cambió el secreto API_ERP',
          details: { name: 'API_ERP', value: 'super-secreto', nested: { token: 'abc', at: new Date('2026-11-08T10:00:00.000Z') }, big: 12n },
        }),
      ),
    );

    const [row] = rows();
    expect(row).toMatchObject({ actor_type: 'user', actor_id: 7, actor_label: 'ana@tienda.co', ip_address: '181.50.1.2', user_agent: 'Mozilla/5.0' });
    expect(row.details).toEqual({
      name: 'API_ERP',
      value: '[redactado]',
      nested: { token: '[redactado]', at: '2026-11-08T10:00:00.000Z' },
      big: '12',
    });
    expect(JSON.stringify(row.details)).not.toContain('super-secreto');
  });

  it('cuts long text without splitting an emoji, so what is stored is what was hashed', async () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    await as(10, () =>
      audit.recordNow({
        action: 'secret.updated',
        target_type: 'secret',
        target_id: 'API_ERP',
        summary: `${'a'.repeat(499)}😀 y más`,
        details: { note: `${'b'.repeat(1999)}😀` },
      }),
    );
    const [row] = rows();
    expect(row.summary).toBe('a'.repeat(499));
    expect(lone.test(row.summary)).toBe(false);
    expect((row.details as { note: string }).note).toBe('b'.repeat(1999));
  });

  it('marks the actor as system when no user is authenticated', async () => {
    await as(10, () => audit.recordNow({ action: 'export.requested', target_type: 'export', summary: 'Exportación programada' }), null);
    expect(rows()[0]).toMatchObject({ actor_type: 'system', actor_id: null, ip_address: null, user_agent: null });
  });

  it('detects an edited row and a removed row', async () => {
    for (const n of [1, 2, 3]) {
      await as(10, () => audit.recordNow({ action: 'document.file_downloaded', target_type: 'file', target_id: n, summary: `Descargó el archivo ${n}` }));
    }
    rows()[1].summary = 'Texto alterado';
    await expect(as(10, () => audit.verify())).resolves.toMatchObject({ valid: false, count: 1, broken_at_seq: '2' });

    rows()[1].summary = 'Descargó el archivo 2';
    await expect(as(10, () => audit.verify())).resolves.toMatchObject({ valid: true, count: 3 });

    db.table('workflow_audit_log').splice(1, 1);
    await expect(as(10, () => audit.verify())).resolves.toMatchObject({ valid: false, broken_at_seq: '3' });
  });

  it('rolls the row back with the business transaction it joined', async () => {
    const prisma = db.asStorePrisma();
    await expect(
      as(10, () =>
        prisma.$transaction(async (tx: unknown) => {
          await audit.append(tx, { action: 'decision.instance_cancelled', target_type: 'instance', summary: 'Canceló FLU-1' });
          throw new Error('decision failed');
        }),
      ),
    ).rejects.toThrow('decision failed');
    expect(rows()).toHaveLength(0);
  });

  it('is fail-closed: a write failure surfaces WORKFLOW_AUDIT_UNAVAILABLE', async () => {
    const broken = { $transaction: () => Promise.reject(new Error('connection lost')) } as unknown as StorePrismaService;
    const failing = new WorkflowAuditService(broken);
    const err = await as(10, () =>
      failing.recordNow({ action: 'document.issued_downloaded', target_type: 'issued_document', summary: 'Descargó un documento' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendixHttpException);
    expect((err as VendixHttpException).errorCode).toBe(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code);
  });

  it('refuses to write without a store in context', async () => {
    const err = await RequestContextService.runIsolated({ is_super_admin: false, is_owner: false }, () =>
      audit.recordNow({ action: 'audit.exported', target_type: 'audit', summary: 'Exportó la auditoría' }),
    ).catch((e: unknown) => e);
    expect((err as VendixHttpException).errorCode).toBe(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code);
  });
});
