import {
  buildWorkflowKit,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { DocumentRetentionCron } from './document-retention.cron';
import { DocumentRetentionService } from './document-retention.service';

const NOW = new Date('2026-12-01T08:00:00Z');

describe('DocumentRetentionCron (P4.4)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let cron: DocumentRetentionCron;

  const seedFor = (store: number) => {
    kit.db.insert('document_retention_policies', {
      organization_id: 1, store_id: store, key: 'p', name: 'Laboral', retain_days: 30, created_by_user_id: 1,
    });
    const d = kit.db.insert('dossiers', {
      organization_id: 1, store_id: store, reference: 'EXP-000001', title: 't', subject_type: 'employee',
      closed_at: new Date('2025-01-01T00:00:00Z'),
    });
    const f = kit.db.insert('stored_files', {
      organization_id: 1, store_id: store, s3_key: `k/${store}.pdf`, original_name: 'a.pdf',
      mime_type: 'application/pdf', size_bytes: 10, sha256: 'b'.repeat(64), uploaded_by_type: 'user',
    });
    kit.db.insert('dossier_items', { store_id: store, dossier_id: d.id, kind: 'uploaded_file', file_id: f.id, added_by_type: 'user' });
    return f;
  };

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    const retention = new DocumentRetentionService(kit.prisma, kit.s3 as any, kit.audit as any);
    cron = new DocumentRetentionCron(kit.prisma, retention);
  });
  afterEach(() => jest.restoreAllMocks());

  it('purga cada tienda con políticas con trigger "schedule" y la segunda corrida del mes no repite', async () => {
    const f1 = seedFor(1);
    const f2 = seedFor(2);

    expect(await cron.runOnce(NOW)).toBe(2);
    expect(kit.db.table('document_purge_runs').map((r) => [r.store_id, r.trigger, r.files_purged])).toEqual([
      [1, 'schedule', 1],
      [2, 'schedule', 1],
    ]);
    expect(kit.db.table('stored_files').find((f) => f.id === f1.id)!.purged_at).not.toBeNull();
    expect(kit.db.table('stored_files').find((f) => f.s3_key === f2.s3_key)!.purged_at).not.toBeNull();

    kit.s3.deleteFile.mockClear();
    expect(await cron.runOnce(new Date(NOW.getTime() + 3_600_000))).toBe(0);
    expect(kit.db.table('document_purge_runs')).toHaveLength(2);
    expect(kit.s3.deleteFile).not.toHaveBeenCalled();
  });

  it('salta la tienda sin la industria de Flujos y la que no tiene políticas activas', async () => {
    seedFor(1);
    kit.db.table('stores').find((s) => s.id === 1)!.industries = ['retail'];
    kit.db.insert('document_retention_policies', {
      organization_id: 1, store_id: 2, key: 'off', name: 'x', retain_days: 1, created_by_user_id: 1, is_active: false,
    });
    expect(await cron.runOnce(NOW)).toBe(0);
    expect(kit.db.table('document_purge_runs')).toHaveLength(0);
  });

  it('un mes nuevo vuelve a correr', async () => {
    seedFor(1);
    await cron.runOnce(NOW);
    expect(await cron.runOnce(new Date('2027-01-01T08:00:00Z'))).toBe(1);
  });
});
