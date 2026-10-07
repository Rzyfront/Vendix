import { RequestContextService } from '@common/context/request-context.service';
import {
  createReportingTools,
  ReportingToolDeps,
} from './reporting.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 track A — contrato A-1 `export_report` / A-2 `analyze_report`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca la red;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool; (e) circuito de lectura: ambas son
 * `readOnly`, sin preview ni confirmación, con re-verificación N/A.
 *
 * La red se mockea a nivel de `global.fetch` y la credencial a nivel de
 * `RequestContextService.getContext`: la spec pinnea el cableado
 * tool→endpoint, no el endpoint (ese vive en analytics y sus propias specs).
 */
describe('reporting.tools · A-1 export_report / A-2 analyze_report', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools() {
    const deps = {
      s3: {
        uploadFile: jest.fn().mockResolvedValue(undefined),
        getPresignedUrl: jest
          .fn()
          .mockResolvedValue('https://s3.test/presigned/sales-summary.xlsx'),
      } as any,
    } satisfies ReportingToolDeps;
    return { deps, tools: createReportingTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
  ) => JSON.parse(await getTool(tools, name).handler!(args, CONTEXT as any));

  let fetchMock: jest.Mock;
  let contextSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    contextSpy = jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ ...CONTEXT, access_token: 'tok-test' } as any);
  });

  afterEach(() => {
    contextSpy.mockRestore();
    jest.restoreAllMocks();
  });

  function jsonResponse(payload: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }

  function binaryResponse(bytes: Buffer, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => '',
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    };
  }

  // ─── (d)+(e) Registro ─────────────────────────────────────────────
  describe('registro', () => {
    it('expone exactamente las 2 tools del dominio reporting', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'analyze_report',
        'export_report',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('reporting');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('ambas exigen store:analytics:read', () => {
      const { tools } = buildTools();
      for (const name of ['analyze_report', 'export_report']) {
        expect(getTool(tools, name).requiredPermissions).toEqual([
          'store:analytics:read',
        ]);
      }
    });

    it('ambas son readOnly puras: sin confirmación ni preview', () => {
      const { tools } = buildTools();
      for (const name of ['analyze_report', 'export_report']) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y el enum de report_id', () => {
      const { tools } = buildTools();
      const analyze = getTool(tools, 'analyze_report');
      const expo = getTool(tools, 'export_report');
      expect(analyze.parameters.required).toEqual(['report_id']);
      expect(expo.parameters.required).toEqual(['report_id']);
      // 49 reportes del registry del frontend.
      expect(analyze.parameters.properties.report_id.enum).toHaveLength(49);
      expect(analyze.parameters.properties.report_id.enum).toContain(
        'sales-summary',
      );
      expect(expo.parameters.properties.report_id.enum).toContain(
        'profit-loss',
      );
    });

    it('A-1 declara el gate de descarga explícita en su descripción', () => {
      const { tools } = buildTools();
      const description = getTool(tools, 'export_report').description;
      expect(description).toContain('SOLO');
      expect(description).toContain('analyze_report');
    });

    it('A-1 encadena vex_render_file por s3_key, nunca URL firmada', () => {
      const { tools } = buildTools();
      const description = getTool(tools, 'export_report').description;
      expect(description).toContain('vex_render_file');
      expect(description).toContain('s3_key');
      expect(description).toContain('jamás se persiste');
    });

    it('A-2 declara que el modelo nunca recalcula', () => {
      const { tools } = buildTools();
      const description = getTool(tools, 'analyze_report').description;
      expect(description).toContain('NUNCA');
      expect(description).toContain('ÚNICA');
    });
  });

  // ─── A-2 analyze_report ───────────────────────────────────────────
  describe('analyze_report', () => {
    it('(b) happy resumen: snapshot exacto con cifras tal cual', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            total_revenue: 12500000,
            total_orders: 320,
            average_order_value: 39062.5,
          },
        }),
      );
      const { tools } = buildTools();

      const answer = await run(tools, 'analyze_report', {
        report_id: 'sales-summary',
        date_from: '2026-08-01',
        date_to: '2026-08-31',
      });

      expect(answer).toEqual({
        report: 'Resumen de ventas',
        report_id: 'sales-summary',
        range: { date_from: '2026-08-01', date_to: '2026-08-31' },
        summary: {
          total_revenue: 12500000,
          total_orders: 320,
          average_order_value: 39062.5,
        },
        next_step:
          'Presenta estas cifras tal cual vienen, sin recalcularlas a mano.',
      });
      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl).toContain('store/analytics/sales/summary');
      expect(calledUrl).toContain('date_from=2026-08-01');
      expect(calledUrl).toContain('date_to=2026-08-31');
    });

    it('(b) happy tabular: pagina en la tool aunque el endpoint no pagine', async () => {
      const rows = Array.from({ length: 120 }, (_, i) => ({
        producto: `P-${i + 1}`,
        total: 1000 * (i + 1),
      }));
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, data: rows }),
      );
      const { tools } = buildTools();

      const answer = await run(tools, 'analyze_report', {
        report_id: 'sales-by-product',
        limit: 50,
        offset: 50,
      });

      expect(answer.report).toBe('Ventas por producto');
      expect(answer.row_count).toBe(120);
      expect(answer.offset).toBe(50);
      expect(answer.limit).toBe(50);
      expect(answer.truncated).toBe(true);
      expect(answer.rows).toHaveLength(50);
      expect(answer.rows[0]).toEqual({ producto: 'P-51', total: 51000 });
      expect(answer.next_step).toContain('offset 100');
    });

    it('(a) sad: report_id desconocido → error y cero fetch', async () => {
      const { tools } = buildTools();

      const answer = await run(tools, 'analyze_report', {
        report_id: 'no-existe',
      });

      expect(answer.error).toContain('No conozco un reporte');
      expect(answer.next_step).toContain('report_id');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('(a) sad: sin credencial → error y cero fetch', async () => {
      contextSpy.mockReturnValue({ ...CONTEXT } as any);
      const { tools } = buildTools();

      const answer = await run(tools, 'analyze_report', {
        report_id: 'sales-summary',
      });

      expect(answer.error).toContain('No hay credencial');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('(c) 403 del endpoint → error guiado de permiso, sin reintento', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: 'Forbidden' }, 403),
      );
      const { tools } = buildTools();

      const answer = await run(tools, 'analyze_report', {
        report_id: 'profit-loss',
      });

      expect(answer.error).toContain('devolvió 403');
      expect(answer.next_step).toContain('no tiene permiso');
    });
  });

  // ─── A-1 export_report ────────────────────────────────────────────
  describe('export_report', () => {
    it('(b) happy: sube el binario y devuelve enlace con TTL', async () => {
      fetchMock.mockResolvedValueOnce(
        binaryResponse(Buffer.alloc(2048, 7)),
      );
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'export_report', {
        report_id: 'sales-summary',
        date_from: '2026-08-01',
        date_to: '2026-08-31',
      });

      expect(answer).toEqual({
        report: 'Resumen de ventas',
        report_id: 'sales-summary',
        file_name: 'sales-summary-2026-08-01-a-2026-08-31.xlsx',
        size_kb: 2,
        s3_key: expect.stringMatching(
          /^vexi-reports\/stores\/7\/.+\.xlsx$/,
        ),
        download_url: 'https://s3.test/presigned/sales-summary.xlsx',
        expires_in_minutes: 15,
        note: expect.stringContaining('vence en 15 minutos'),
      });
      expect(deps.s3.uploadFile).toHaveBeenCalledTimes(1);
      // Lo que se devuelve como s3_key es exactamente lo que se subió:
      // el bloque file lo referencia y la URL firmada jamás se persiste.
      expect(deps.s3.uploadFile.mock.calls[0][1]).toBe(answer.s3_key);
      expect(answer.note).toContain('vex_render_file');
      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl).toContain('store/analytics/sales/export');
      expect(fetchMock.mock.calls[0][1].headers.Accept).toContain(
        'spreadsheetml.sheet',
      );
    });

    it('(c) reporte sin export → {error, next_step} guiado, cero fetch', async () => {
      const { deps, tools } = buildTools();

      // overview-summary existe en el catálogo pero no tiene exportEndpoint.
      const answer = await run(tools, 'export_report', {
        report_id: 'overview-summary',
      });

      expect(answer).toEqual({
        error: expect.stringContaining('no tiene descarga XLSX'),
        next_step: expect.stringContaining('analyze_report'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(deps.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('(a) sad: report_id desconocido → error y cero fetch', async () => {
      const { tools } = buildTools();

      const answer = await run(tools, 'export_report', {
        report_id: 'no-existe',
      });

      expect(answer.error).toContain('No conozco un reporte');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('(c) export vacío → error guiado de rango, sin subir a S3', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(Buffer.alloc(0)));
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'export_report', {
        report_id: 'sales-summary',
      });

      expect(answer.error).toContain('salió vacío');
      expect(answer.next_step).toContain('otro periodo');
      expect(deps.s3.uploadFile).not.toHaveBeenCalled();
    });
  });
});
