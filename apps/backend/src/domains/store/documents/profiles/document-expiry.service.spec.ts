import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { systemIdempotencyKey } from '../../workflows/engine/workflow-idempotency';
import { triggerIdempotencyKey } from '../../workflows/engine/workflow-trigger.events';
import { DocumentExpiryCron } from './document-expiry.cron';
import { DocumentExpiryService, expiryMessage } from './document-expiry.service';
import { DocumentFileProfilesService } from './document-file-profiles.service';

// 10:00 in Bogota (UTC-5) on 2026-11-07.
const NOW = new Date('2026-11-07T15:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('documents expiry (P4.6)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let notifications: { createAndBroadcast: jest.Mock };
  let expiry: DocumentExpiryService;
  let profiles: DocumentFileProfilesService;
  let n = 0;

  const file = (store = 1, over: Record<string, unknown> = {}) => {
    n++;
    return kit.db.insert('stored_files', {
      organization_id: 1, store_id: store, s3_key: `k/${n}`, original_name: `poliza-${n}.pdf`,
      mime_type: 'application/pdf', size_bytes: 10, sha256: 'c'.repeat(64), uploaded_by_type: 'user',
      ...over,
    });
  };
  const profile = (fileId: number, validUntil: string | null, over: Record<string, unknown> = {}, store = 1) =>
    kit.db.insert('document_file_profiles', {
      store_id: store, file_id: fileId, doc_type: 'Póliza', valid_until: validUntil ? day(validUntil) : null, ...over,
    });
  const outbox = () => kit.db.table('workflow_outbox').filter((r) => r.kind === 'business_event');
  const profileOf = (fileId: number) => kit.db.table('document_file_profiles').find((p) => p.file_id === fileId)!;

  beforeEach(() => {
    n = 0;
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.as({ user_id: undefined });
    notifications = { createAndBroadcast: jest.fn(async () => ({ id: 1 })) };
    expiry = new DocumentExpiryService(kit.prisma, notifications as any);
    profiles = new DocumentFileProfilesService(kit.prisma, kit.audit as any);
    // An active flow so the business event is written to the outbox.
    seedDefinition(
      kit.db,
      purchaseDefinition({
        key: 'renovacion',
        triggers: [{ kind: 'event', event: 'document.expiring', map: {} }],
      } as any),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('mensaje: "La <tipo> <archivo> vence el <fecha> (<N> días)"', () => {
    expect(expiryMessage('Póliza', 'poliza.pdf', '2026-12-07', 30)).toBe(
      'La póliza poliza.pdf vence el 7 de diciembre de 2026 (30 días)',
    );
    expect(expiryMessage(null, 'x.pdf', '2026-12-01', 1)).toBe('El documento x.pdf vence el 1 de diciembre de 2026 (1 día)');
    expect(expiryMessage('Cédula', 'c.pdf', '2026-11-07', 0)).toContain('(hoy)');
  });

  it('a 30 días notifica, emite document.expiring con los tokens del catálogo y marca la alerta', async () => {
    const f = file();
    const d = kit.db.insert('dossiers', {
      organization_id: 1, store_id: 1, reference: 'EXP-000007', title: 'Renovar', subject_type: 'supplier', subject_id: 4,
    });
    kit.db.insert('dossier_items', { store_id: 1, dossier_id: d.id, kind: 'uploaded_file', file_id: f.id, added_by_type: 'user' });
    profile(f.id, '2026-12-07');

    expect(await expiry.alertDue(NOW)).toBe(1);

    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      1,
      'workflow_task',
      'Documento por vencer',
      `La póliza ${f.original_name} vence el 7 de diciembre de 2026 (30 días)`,
      expect.objectContaining({ kind: 'document_expiring', file_id: f.id, days_left: 30 }),
    );
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].payload).toEqual({
      event: 'document.expiring',
      business_id: `${f.id}:2026-12-07`,
      context: {
        file_id: f.id,
        file_name: f.original_name,
        doc_type: 'Póliza',
        valid_until: '2026-12-07',
        days_left: 30,
        dossier_reference: 'EXP-000007',
        subject_type: 'supplier',
        subject_id: 4,
      },
    });
    expect(profileOf(f.id).expiry_alerted_for).toEqual(day('2026-12-07'));
    expect(profileOf(f.id).expiry_alerted_at).toEqual(NOW);
  });

  it('una sola vez por fecha: la segunda corrida no repite aviso ni evento', async () => {
    const f = file();
    profile(f.id, '2026-12-07');
    await expiry.alertDue(NOW);
    expect(await expiry.alertDue(new Date(NOW.getTime() + 86_400_000))).toBe(0);
    expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
    expect(outbox()).toHaveLength(1);
  });

  it('al cambiar la fecha de vencimiento vuelve a alertar', async () => {
    kit.as({ user_id: 1 });
    const f = file();
    profile(f.id, '2026-12-07');
    await expiry.alertDue(NOW);

    await profiles.update(f.id, { valid_until: '2026-12-05' });
    expect(profileOf(f.id).expiry_alerted_for).toBeNull();
    expect(await expiry.alertDue(NOW)).toBe(1);
    expect(outbox().map((o) => o.payload.business_id)).toEqual([`${f.id}:2026-12-07`, `${f.id}:2026-12-05`]);
    expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(2);
  });

  it('solo avisa dentro de hoy..hoy+30 en la zona horaria de la tienda', async () => {
    const inside = file();
    profile(inside.id, '2026-11-07'); // today (Bogota)
    const past = file();
    profile(past.id, '2026-11-06');
    // 2026-12-08 is 30 days ahead in UTC but 31 in Bogota at this instant of 2026-11-08T03:00Z.
    const edge = file();
    profile(edge.id, '2026-12-08');
    const none = file();
    profile(none.id, null);
    const lateNow = new Date('2026-11-08T03:00:00Z'); // 22:00 on Nov 7 in Bogota

    expect(await expiry.alertDue(lateNow)).toBe(1);
    expect(outbox().map((o) => o.payload.context.file_id)).toEqual([inside.id]);
  });

  it('no avisa archivos borrados o purgados', async () => {
    const gone = file(1, { deleted_at: NOW });
    const purged = file(1, { purged_at: NOW });
    profile(gone.id, '2026-11-20');
    profile(purged.id, '2026-11-20');
    expect(await expiry.alertDue(NOW)).toBe(0);
    expect(outbox()).toHaveLength(0);
  });

  it('el cron recorre las tiendas con aislamiento y no cruza datos', async () => {
    const mine = file(1);
    profile(mine.id, '2026-12-01');
    const theirs = file(2);
    profile(theirs.id, '2026-12-02', {}, 2);
    seedDefinition(
      kit.db,
      purchaseDefinition({ key: 'renovacion2', triggers: [{ kind: 'event', event: 'document.expiring', map: {} }] } as any),
      2,
    );
    const cron = new DocumentExpiryCron(kit.prisma, expiry);

    expect(await cron.runOnce(NOW)).toBe(2);
    expect(notifications.createAndBroadcast.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
    expect(outbox().map((o) => [o.store_id, o.payload.context.file_id]).sort()).toEqual(
      [[1, mine.id], [2, theirs.id]].sort(),
    );
    // Store 1's own run never touched store 2's profile.
    kit.as({ store_id: 1 });
    expect(await expiry.alertDue(NOW)).toBe(0);
    expect(await cron.runOnce(NOW)).toBe(0);
  });

  describe('lista "Por vencer"', () => {
    it('muestra días restantes, vencidos primero, y solo lo de la tienda', async () => {
      const soon = file();
      profile(soon.id, '2026-11-17');
      const expired = file();
      profile(expired.id, '2026-11-02');
      const far = file();
      profile(far.id, '2027-03-01');
      const other = file(2);
      profile(other.id, '2026-11-10', {}, 2);

      const out = await expiry.listExpiring({}, NOW);
      expect(out.total).toBe(2);
      expect(out.data.map((r) => [r.file_id, r.days_left])).toEqual([
        [expired.id, -5],
        [soon.id, 10],
      ]);
      expect(out.data[1]).toMatchObject({ valid_until: '2026-11-17', doc_type: 'Póliza', renewal: null });
      expect((await expiry.listExpiring({ days: 200 }, NOW)).total).toBe(3);
    });

    it('enlaza la solicitud de renovación que arrancó el evento', async () => {
      const f = file();
      profile(f.id, '2026-12-07');
      const def = kit.db.table('workflow_definitions')[0];
      const inst = kit.db.insert('workflow_instances', {
        organization_id: 1, store_id: 1, reference: 'FLU-000001', title: 'Renovación de póliza', status: 'active',
      });
      kit.db.insert('workflow_instance_events', {
        store_id: 1, instance_id: inst.id, seq: 1, type: 'started', actor_type: 'system',
        idempotency_key: systemIdempotencyKey(triggerIdempotencyKey(def.id, 'document.expiring', `${f.id}:2026-12-07`)),
      });

      const out = await expiry.listExpiring({}, NOW);
      expect(out.data[0].renewal).toEqual({
        id: inst.id, reference: 'FLU-000001', title: 'Renovación de póliza', status: 'active',
      });
    });
  });
});
