import 'reflect-metadata';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ResponseService } from '@common/responses/response.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowAuditController } from './workflow-audit.controller';
import { WorkflowAuditExportService } from './workflow-audit.export.service';
import { WorkflowAuditQueryDto, WorkflowAuditQueryService } from './workflow-audit.query';
import { WorkflowAuditAction } from './workflow-audit.catalog';
import { WorkflowAuditRow, WorkflowAuditService } from './workflow-audit.service';

const as = <T>(store_id: number, fn: () => Promise<T>, user_id = 7) =>
  RequestContextService.runIsolated(
    { store_id, organization_id: 1, user_id, email: 'ana@tienda.co', is_super_admin: false, is_owner: false },
    fn,
  );

function setup() {
  const db = new FakeWorkflowDb();
  const prisma = db.asStorePrisma() as StorePrismaService;
  const audit = new WorkflowAuditService(prisma);
  const query = new WorkflowAuditQueryService(prisma);
  const exporter = new WorkflowAuditExportService(audit, query, prisma);
  const controller = new WorkflowAuditController(audit, query, exporter, new ResponseService());
  db.insert('users', { id: 7, first_name: 'Ana', last_name: 'Pérez' });
  db.insert('users', { id: 8, first_name: 'Luis', last_name: 'Gómez' });
  db.insert('stores', { id: 10, name: 'Taller Central', organization_id: 1 });
  db.insert('stores', { id: 20, name: 'Otra tienda', organization_id: 1 });
  return { db, prisma, audit, controller };
}

const record = (
  audit: WorkflowAuditService,
  store: number,
  action: WorkflowAuditAction,
  summary: string,
  extra: Record<string, unknown> = {},
  user = 7,
) =>
  as(
    store,
    () =>
      audit.recordNow({
        action,
        target_type: 'instance',
        target_id: 3,
        summary,
        ...extra,
      } as never),
    user,
  );

const query = (q: Partial<WorkflowAuditQueryDto>) => q as WorkflowAuditQueryDto;

function fakeResponse() {
  const sent: { headers: Record<string, unknown>; body?: Buffer } = { headers: {} };
  const res = {
    set: (h: Record<string, unknown>) => Object.assign(sent.headers, h),
    end: (b: Buffer) => {
      sent.body = b;
    },
  } as unknown as Response;
  return { res, sent };
}

async function sheets(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return wb;
}

describe('WorkflowAuditController', () => {
  it('is guarded by the manage permission on every route', () => {
    for (const method of ['list', 'verify', 'export'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, WorkflowAuditController.prototype[method])).toEqual([
        'store:workflows:manage',
      ]);
    }
  });

  describe('list', () => {
    it('lists newest first with bigint fields as strings and resolved actor names', async () => {
      const { audit, controller } = setup();
      await record(audit, 10, 'decision.task_completed', 'Aprobó FLU-1');
      await record(audit, 10, 'decision.instance_cancelled', 'Canceló FLU-2', {}, 8);

      const res = (await as(10, () => controller.list(query({})))) as {
        data: Array<{ seq: string; id: string; actor: { name: string }; category_label: string; action_label: string; target: { type_label: string } }>;
        meta: { total: number; page: number; limit: number };
      };

      expect(res.data.map((r) => r.seq)).toEqual(['2', '1']);
      expect(typeof res.data[0].id).toBe('string');
      expect(res.data[0].actor.name).toBe('Luis Gómez');
      expect(res.data[1].actor.name).toBe('Ana Pérez');
      expect(res.data[0].category_label).toBe('Decisiones');
      expect(res.data[0].action_label).toBe('Solicitud cancelada');
      expect(res.data[0].target.type_label).toBe('Solicitud');
      expect(res.meta).toMatchObject({ total: 2, page: 1, limit: 25 });
      expect(() => JSON.stringify(res)).not.toThrow();
    });

    it('never lists another store\'s rows', async () => {
      const { audit, controller } = setup();
      await record(audit, 10, 'secret.created', 'Creó el secreto A');
      await record(audit, 20, 'secret.created', 'Creó el secreto de otra tienda');

      const res = (await as(10, () => controller.list(query({})))) as { data: Array<{ summary: string }> };
      expect(res.data.map((r) => r.summary)).toEqual(['Creó el secreto A']);
    });

    it('filters by category, action, actor, flow, request and free text', async () => {
      const { audit, controller } = setup();
      await record(audit, 10, 'decision.task_completed', 'Aprobó la compra FLU-1', { definition_id: 4, instance_id: 9 });
      await record(audit, 10, 'secret.created', 'Creó el secreto API_ERP', { definition_id: 5 }, 8);
      await record(audit, 10, 'document.file_downloaded', 'Descargó el archivo contrato.pdf', { instance_id: 9 });

      const ids = async (q: Partial<WorkflowAuditQueryDto>) =>
        ((await as(10, () => controller.list(query(q)))) as { data: Array<{ seq: string }> }).data.map((r) => r.seq);

      await expect(ids({ category: 'secret' })).resolves.toEqual(['2']);
      await expect(ids({ action: 'document.file_downloaded' })).resolves.toEqual(['3']);
      await expect(ids({ actor_id: '8' })).resolves.toEqual(['2']);
      await expect(ids({ definition_id: '4' })).resolves.toEqual(['1']);
      await expect(ids({ instance_id: '9' })).resolves.toEqual(['3', '1']);
      await expect(ids({ search: 'api_erp' })).resolves.toEqual(['2']);
    });

    it('reads from/to as store-local calendar days (America/Bogota by default)', async () => {
      const { db, audit, controller } = setup();
      await record(audit, 10, 'secret.created', 'Antes');
      await record(audit, 10, 'secret.created', 'Dentro');
      await record(audit, 10, 'secret.created', 'Después');
      // 2026-03-02 02:00 UTC is still 2026-03-01 21:00 in Bogotá.
      const rows = db.table('workflow_audit_log');
      rows[0].created_at = new Date('2026-02-28T04:00:00Z');
      rows[1].created_at = new Date('2026-03-02T02:00:00Z');
      rows[2].created_at = new Date('2026-03-02T06:00:00Z');

      const res = (await as(10, () => controller.list(query({ from: '2026-03-01', to: '2026-03-01' })))) as {
        data: Array<{ summary: string }>;
      };
      expect(res.data.map((r) => r.summary)).toEqual(['Dentro']);
    });

    it('pages the results', async () => {
      const { audit, controller } = setup();
      for (const n of [1, 2, 3]) await record(audit, 10, 'secret.used', `Uso ${n}`);
      const res = (await as(10, () => controller.list(query({ page: '2', limit: '2' })))) as {
        data: Array<{ summary: string }>;
        meta: { total: number; page: number };
      };
      expect(res.data.map((r) => r.summary)).toEqual(['Uso 1']);
      expect(res.meta).toMatchObject({ total: 3, page: 2 });
    });

    it.each([
      [{ from: '2026-13-40' }],
      [{ from: '2026-03-05', to: '2026-03-01' }],
      [{ category: 'nope' }],
      [{ action: 'nope' }],
      [{ category: 'secret', action: 'decision.task_completed' }],
      [{ actor_id: 'abc' }],
      [{ limit: '101' }],
      [{ page: '0' }],
    ])('rejects the invalid filter %j with WORKFLOW_AUDIT_FILTER_INVALID', async (q) => {
      const { controller } = setup();
      const err = await as(10, () => controller.list(query(q as Partial<WorkflowAuditQueryDto>))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect((err as VendixHttpException).errorCode).toBe(ErrorCodes.WORKFLOW_AUDIT_FILTER_INVALID.code);
    });

    it('does not write an audit row when listing (reads are not audited)', async () => {
      const { db, controller } = setup();
      await as(10, () => controller.list(query({})));
      await as(10, () => controller.verify());
      expect(db.table('workflow_audit_log')).toHaveLength(0);
    });
  });

  describe('verify', () => {
    it('answers valid with the count, then the first broken sequence after a tamper', async () => {
      const { db, audit, controller } = setup();
      for (const n of [1, 2, 3]) await record(audit, 10, 'secret.used', `Uso ${n}`);

      const ok = (await as(10, () => controller.verify())) as { data: unknown };
      expect(ok.data).toEqual({ valid: true, count: 3, broken_at_seq: null });

      db.table('workflow_audit_log')[1].summary = 'Alterado';
      const broken = (await as(10, () => controller.verify())) as { data: unknown };
      expect(broken.data).toEqual({ valid: false, count: 1, broken_at_seq: '2' });
    });

    it('verifies only the caller store', async () => {
      const { db, audit, controller } = setup();
      await record(audit, 10, 'secret.used', 'Uso A');
      await record(audit, 20, 'secret.used', 'Uso B');
      db.table('workflow_audit_log').find((r) => r.store_id === 20)!.summary = 'Alterado';

      const res = (await as(10, () => controller.verify())) as { data: { valid: boolean; count: number } };
      expect(res.data).toMatchObject({ valid: true, count: 1 });
    });
  });

  describe('export', () => {
    it('appends audit.exported first and streams the registros and verificación sheets', async () => {
      const { db, audit, controller } = setup();
      await record(audit, 10, 'decision.task_completed', 'Aprobó la compra FLU-1', { details: { has_comment: true } });
      await record(audit, 20, 'secret.created', 'Creó el secreto ajeno');
      const { res, sent } = fakeResponse();

      await as(10, () => controller.export(query({}), res));

      expect(sent.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(String(sent.headers['Content-Disposition'])).toMatch(/^attachment; filename="auditoria-flujos_\d{4}-\d{2}-\d{2}\.xlsx"$/);
      const rows = db.table('workflow_audit_log').filter((r) => r.store_id === 10) as WorkflowAuditRow[];
      expect(rows.map((r) => r.action)).toEqual(['decision.task_completed', 'audit.exported']);
      expect(rows[1]).toMatchObject({ category: 'export', actor_id: 7 });

      const wb = await sheets(sent.body!);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Registros', 'Verificación']);
      const reg = wb.getWorksheet('Registros')!;
      const header = (reg.getRow(1).values as string[]).slice(1);
      expect(header).toEqual([
        'N.º', 'Fecha', 'Categoría', 'Acción', 'Clave de la acción', 'Actor', 'IP', 'Navegador',
        'Objeto', 'Resumen', 'Detalles (JSON)', 'Hash anterior', 'Hash',
      ]);
      expect(reg.rowCount).toBe(3);
      const first = (reg.getRow(2).values as string[]).slice(1);
      expect(first[0]).toBe('1');
      expect(first[2]).toBe('Decisiones');
      expect(first[3]).toBe('Tarea decidida');
      expect(first[5]).toBe('Ana Pérez');
      expect(first[8]).toBe('Solicitud #3');
      expect(first[10]).toBe('{"has_comment":true}');
      expect(first[12]).toBe(rows[0].entry_hash);
      const second = (reg.getRow(3).values as string[]).slice(1);
      expect(second[11]).toBe(rows[0].entry_hash);
      expect(second[12]).toBe(rows[1].entry_hash);
      expect(JSON.stringify(reg.getSheetValues())).not.toContain('ajeno');

      const ver = wb.getWorksheet('Verificación')!;
      const values = new Map<string, string>();
      ver.eachRow((row, n) => {
        if (n > 1) values.set(String(row.getCell(1).value), String(row.getCell(2).value));
      });
      expect(values.get('Resultado')).toBe('Cadena íntegra: 2 registros verificados');
      expect(values.get('Registros de la cadena')).toBe('2');
      expect(values.get('Último hash')).toBe(rows[1].entry_hash);
      expect(values.get('Algoritmo')).toBe('SHA-256 del hash anterior + contenido canónico');
      expect(values.get('Tienda')).toBe('Taller Central');
    });

    it('exports the whole filtered dataset, not a page', async () => {
      const { audit, controller } = setup();
      for (let n = 1; n <= 7; n++) await record(audit, 10, 'secret.used', `Uso ${n}`);
      await record(audit, 10, 'secret.created', 'Otro hecho');
      const { res, sent } = fakeResponse();

      await as(10, () => controller.export(query({ action: 'secret.used', limit: '2' }), res));

      const reg = (await sheets(sent.body!)).getWorksheet('Registros')!;
      expect(reg.rowCount).toBe(1 + 7);
    });

    it('reports a broken chain on the verificación sheet', async () => {
      const { db, audit, controller } = setup();
      for (const n of [1, 2]) await record(audit, 10, 'secret.used', `Uso ${n}`);
      db.table('workflow_audit_log')[0].summary = 'Alterado';
      const { res, sent } = fakeResponse();

      await as(10, () => controller.export(query({}), res));

      const ver = (await sheets(sent.body!)).getWorksheet('Verificación')!;
      expect(String(ver.getRow(2).getCell(2).value)).toBe('La cadena se rompe en el registro #1');
    });

    it('sends nothing when the export cannot be audited (fail-closed)', async () => {
      const { audit, controller } = setup();
      jest.spyOn(audit, 'recordNow').mockRejectedValue(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));
      const { res, sent } = fakeResponse();

      const err = await as(10, () => controller.export(query({}), res)).catch((e: unknown) => e);

      expect((err as VendixHttpException).errorCode).toBe(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code);
      expect(sent.body).toBeUndefined();
    });

    it('rejects invalid filters before writing the export row', async () => {
      const { db, controller } = setup();
      const { res, sent } = fakeResponse();
      const err = await as(10, () => controller.export(query({ from: 'ayer' }), res)).catch((e: unknown) => e);
      expect((err as VendixHttpException).errorCode).toBe(ErrorCodes.WORKFLOW_AUDIT_FILTER_INVALID.code);
      expect(db.table('workflow_audit_log')).toHaveLength(0);
      expect(sent.body).toBeUndefined();
    });
  });
});
