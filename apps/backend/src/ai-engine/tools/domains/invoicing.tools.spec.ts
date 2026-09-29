import { createInvoicingTools, InvoicingToolDeps } from './invoicing.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * F-28/F-32/F-34/F-35 — Spec de contrato de la familia invoicing (patrón
 * canónico T4).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) las 4 son reads puras: `readOnly: true`, sin `requiresConfirmation` ni
 *     `preview` — la emisión (F-30) vive en el paso 11 y su cadena
 *     habilitante ya viaja fijada en F-32/F-34/F-35.
 */
describe('invoicing.tools · contrato canónico T4', () => {
  const STORE_ID = 7;
  const ORG_ID = 3;

  function baseDeps() {
    return {
      invoicingService: { findOne: jest.fn() },
      invoiceFlowService: { getEmitReadiness: jest.fn() },
      dianEventsService: { findByInvoice: jest.fn() },
      resolutionsService: { findAll: jest.fn() },
      dianConfigService: {
        getDashboard: jest.fn(),
        getEmissionStatus: jest.fn(),
      },
    } as any satisfies InvoicingToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createInvoicingTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool) throw new Error(`${name} no registrado`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.handler) throw new Error(`${name} sin handler`);
    return JSON.parse(await tool.handler(args, context as any));
  };

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 4 reads P0 de facturación', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_invoice_status',
        'get_emit_readiness',
        'list_invoice_resolutions',
        'get_dian_status',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('invoicing');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada read exige invoicing:read (mismo verbo que el controlador)', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['invoicing:read']);
      }
    });

    it('las 4 son reads puras sin circuito de escritura', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos del JSON Schema', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'get_invoice_status').parameters.required).toEqual(
        ['invoice_id'],
      );
      expect(getTool(tools, 'get_emit_readiness').parameters.required).toEqual(
        ['invoice_id'],
      );
      expect(
        getTool(tools, 'list_invoice_resolutions').parameters.required,
      ).toEqual([]);
      expect(getTool(tools, 'get_dian_status').parameters.required).toEqual(
        [],
      );
    });
  });

  // ─── F-28: get_invoice_status ──────────────────────────────────────────
  describe('get_invoice_status (F-28)', () => {
    const INVOICE_ROW = {
      id: 42,
      invoice_number: 'FV-0042',
      document_type: 'invoice',
      status: 'sent',
      send_status: 'accepted',
      transmission_status: 'transmitted',
      issue_date: new Date('2026-09-01T10:00:00.000Z'),
      due_date: new Date('2026-09-30T10:00:00.000Z'),
      currency_code: 'COP',
      subtotal_amount: '100000.00',
      tax_amount: '19000.00',
      total_amount: '119000.00',
      cufe: 'cufe-abc',
      cude: null,
      customer: {
        id: 9,
        first_name: 'Ana',
        last_name: 'Ríos',
        legal_name: null,
        person_type: 'natural',
        email: 'ana@example.com',
      },
      resolution: { id: 5, resolution_number: '18760000001', prefix: 'FV' },
      invoice_items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      retry_status: null,
    };
    const EVENTS = [
      {
        id: 11,
        event_code: '030',
        event_name: 'Acuse de recibo',
        status: 'registered',
        description: 'Acuse RADIAN',
        created_at: new Date('2026-09-02T10:00:00.000Z'),
      },
    ];

    it('(b) happy: snapshot exacto de estado + eventos DIAN', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(INVOICE_ROW);
      deps.dianEventsService.findByInvoice.mockResolvedValue(EVENTS);

      const answer = await run(tools, 'get_invoice_status', {
        invoice_id: 42,
      });

      expect(deps.invoicingService.findOne).toHaveBeenCalledWith(42);
      expect(deps.dianEventsService.findByInvoice).toHaveBeenCalledWith(42);
      expect(answer).toEqual({
        invoice_id: 42,
        invoice_number: 'FV-0042',
        document_type: 'invoice',
        status: 'sent',
        send_status: 'accepted',
        transmission_status: 'transmitted',
        issue_date: '2026-09-01T10:00:00.000Z',
        due_date: '2026-09-30T10:00:00.000Z',
        currency: 'COP',
        subtotal: 100000,
        tax_amount: 19000,
        total_amount: 119000,
        cufe: 'cufe-abc',
        cude: null,
        customer: {
          id: 9,
          name: 'Ana Ríos',
          person_type: 'natural',
          email: 'ana@example.com',
        },
        resolution: {
          id: 5,
          resolution_number: '18760000001',
          prefix: 'FV',
        },
        item_count: 3,
        retry_status: null,
        dian_events: [
          {
            id: 11,
            event_code: '030',
            event_name: 'Acuse de recibo',
            status: 'registered',
            description: 'Acuse RADIAN',
            registered_at: '2026-09-02T10:00:00.000Z',
          },
        ],
      });
    });

    it('(a) sad: invoice_id inválido no toca los services', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_invoice_status', {
        invoice_id: 'FV-42',
      });

      expect(answer).toEqual({
        error: 'invoice_id inválido: debe ser un entero positivo.',
        next_step:
          'Revisa el id en el listado de facturas del módulo de facturación.',
      });
      expect(deps.invoicingService.findOne).not.toHaveBeenCalled();
      expect(deps.dianEventsService.findByInvoice).not.toHaveBeenCalled();
    });

    it('(c) factura inexistente → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.INVOICING_FIND_001,
          'Invoice not found',
        ),
      );

      const answer = await run(tools, 'get_invoice_status', {
        invoice_id: 999,
      });

      expect(answer.error).toContain('No se pudo leer la factura 999');
      expect(answer.next_step).toContain('listado de facturas');
    });

    it('eventos ilegibles degradan a lista vacía sin tumbar el estado', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(INVOICE_ROW);
      deps.dianEventsService.findByInvoice.mockRejectedValue(
        new Error('RADIAN caído'),
      );

      const answer = await run(tools, 'get_invoice_status', {
        invoice_id: 42,
      });

      expect(answer.invoice_id).toBe(42);
      expect(answer.dian_events).toEqual([]);
    });
  });

  // ─── F-32: get_emit_readiness ──────────────────────────────────────────
  describe('get_emit_readiness (F-32)', () => {
    const REPORT = {
      invoice_id: 42,
      invoice_number: 'FV-0042',
      status: 'validated',
      emittable: true,
      has_items: true,
      blockers: [],
      warnings: [{ code: 'CERT_EXPIRING', message: 'Certificado por vencer' }],
      findings: [{ code: 'OK', message: 'Identidad válida' }],
      identity: { emittable: true },
      fiscal_document: { emittable: true },
      valid_transitions: ['send', 'void'],
      discard_route: null,
    };

    it('(b) happy: snapshot con veredicto y cadena F-30 fijada', async () => {
      const { deps, tools } = buildTools();
      deps.invoiceFlowService.getEmitReadiness.mockResolvedValue(REPORT);

      const answer = await run(tools, 'get_emit_readiness', {
        invoice_id: 42,
      });

      expect(deps.invoiceFlowService.getEmitReadiness).toHaveBeenCalledWith(42);
      expect(answer).toEqual({
        invoice_id: 42,
        invoice_number: 'FV-0042',
        status: 'validated',
        emittable: true,
        has_items: true,
        blockers: [],
        warnings: [{ code: 'CERT_EXPIRING', message: 'Certificado por vencer' }],
        findings: [{ code: 'OK', message: 'Identidad válida' }],
        identity_emittable: true,
        fiscal_document_emittable: true,
        valid_transitions: ['send', 'void'],
        discard_route: null,
        emission_chain: {
          send_tool: 'send_invoice_dian (F-30)',
          requires: [
            'get_emit_readiness con emittable=true (F-32)',
            'get_dian_status con emission.is_live=true (F-35)',
            'list_invoice_resolutions con una resolución activa y saldo disponible (F-34)',
            'identidad del emisor responsable del impuesto del documento (assertCanChargeVat)',
          ],
        },
      });
    });

    it('(a) sad: invoice_id inválido no toca el flow service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_emit_readiness', {
        invoice_id: -3,
      });

      expect(answer).toEqual({
        error: 'invoice_id inválido: debe ser un entero positivo.',
        next_step:
          'Revisa el id en el listado de facturas del módulo de facturación.',
      });
      expect(deps.invoiceFlowService.getEmitReadiness).not.toHaveBeenCalled();
    });

    it('(c) readiness ilegible → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.invoiceFlowService.getEmitReadiness.mockRejectedValue(
        new Error('boom'),
      );

      const answer = await run(tools, 'get_emit_readiness', {
        invoice_id: 42,
      });

      expect(answer.error).toContain('No se pudo evaluar la factura 42');
      expect(answer.next_step).toContain('listado de facturas');
    });
  });

  // ─── F-34: list_invoice_resolutions ────────────────────────────────────
  describe('list_invoice_resolutions (F-34)', () => {
    const ROWS = [
      {
        id: 5,
        resolution_number: '18760000001',
        prefix: 'FV',
        document_type: 'invoice',
        from_number: 1,
        to_number: 1000,
        current_number: 42,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        is_active: true,
        accounting_entity_id: 12,
        technical_key_set: true,
        technical_key_length: 40,
      },
      {
        id: 6,
        resolution_number: '18760000002',
        prefix: 'FV',
        document_type: 'invoice',
        from_number: 1,
        to_number: 500,
        current_number: 500,
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
        is_active: false,
        accounting_entity_id: 12,
        technical_key_set: true,
        technical_key_length: 38,
      },
    ];

    it('(b) happy: snapshot con saldos y cadena F-30', async () => {
      const { deps, tools } = buildTools();
      deps.resolutionsService.findAll.mockResolvedValue(ROWS);

      const answer = await run(tools, 'list_invoice_resolutions', {});

      expect(deps.resolutionsService.findAll).toHaveBeenCalledWith();
      expect(answer.count).toBe(2);
      expect(answer.resolutions[0]).toEqual({
        id: 5,
        resolution_number: '18760000001',
        prefix: 'FV',
        document_type: 'invoice',
        from_number: 1,
        to_number: 1000,
        current_number: 42,
        remaining: 958,
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: '2026-12-31T00:00:00.000Z',
        is_active: true,
        accounting_entity_id: 12,
        technical_key_set: true,
        technical_key_length: 40,
      });
      // Sin saldo: el cursor agotado fija remaining en 0, nunca negativo.
      expect(answer.resolutions[1].remaining).toBe(0);
      expect(answer.emission_chain.send_tool).toBe('send_invoice_dian (F-30)');
    });

    it('active_only filtra en la tool sin cambiar el llamado al service', async () => {
      const { deps, tools } = buildTools();
      deps.resolutionsService.findAll.mockResolvedValue(ROWS);

      const answer = await run(tools, 'list_invoice_resolutions', {
        active_only: true,
      });

      expect(answer.count).toBe(1);
      expect(answer.resolutions[0].id).toBe(5);
    });

    it('la ClTec nunca viaja: ni rastro de technical_key en la salida', async () => {
      const { deps, tools } = buildTools();
      deps.resolutionsService.findAll.mockResolvedValue(ROWS);

      const answer = await run(tools, 'list_invoice_resolutions', {});

      for (const row of answer.resolutions) {
        expect(Object.keys(row)).not.toContain('technical_key');
        expect(Object.keys(row)).not.toContain('technical_key_encrypted');
        expect(JSON.stringify(row)).not.toContain('technical_key":');
      }
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.resolutionsService.findAll.mockRejectedValue(new Error('db'));

      const answer = await run(tools, 'list_invoice_resolutions', {});

      expect(answer.error).toContain('No se pudieron leer las resoluciones');
      expect(answer.next_step).toContain('facturación electrónica');
    });
  });

  // ─── F-35: get_dian_status ─────────────────────────────────────────────
  describe('get_dian_status (F-35)', () => {
    const DASHBOARD = {
      stats: { total_sent: 10, total_success: 9, total_errors: 1 },
      recent_submissions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }],
      certificate_status: { expires_at: '2027-01-01' },
      configs_summary: [{ id: 1, environment: 'production' }],
    };
    const EMISSION = {
      is_live: false,
      configuration_id: 1,
      environment: 'test',
      enablement_status: 'testing',
      reason: 'El set de pruebas está en curso ante la DIAN.',
      blockers: [{ code: 'NOT_ENABLED', message: 'Sin habilitación' }],
      warnings: [],
      actionable: [{ code: 'RUN_TEST_SET', message: 'Corre el set' }],
      waiting_on_dian: [],
    };

    it('(b) happy: snapshot que combina dashboard + emission-status', async () => {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getDashboard.mockResolvedValue(DASHBOARD);
      deps.dianConfigService.getEmissionStatus.mockResolvedValue(EMISSION);

      const answer = await run(tools, 'get_dian_status', {});

      expect(deps.dianConfigService.getDashboard).toHaveBeenCalledWith();
      expect(deps.dianConfigService.getEmissionStatus).toHaveBeenCalledWith();
      expect(answer).toEqual({
        emission: {
          is_live: false,
          configuration_id: 1,
          environment: 'test',
          enablement_status: 'testing',
          reason: 'El set de pruebas está en curso ante la DIAN.',
          blockers: [{ code: 'NOT_ENABLED', message: 'Sin habilitación' }],
          warnings: [],
          actionable: [{ code: 'RUN_TEST_SET', message: 'Corre el set' }],
          waiting_on_dian: [],
        },
        activity: {
          stats: { total_sent: 10, total_success: 9, total_errors: 1 },
          certificate_status: { expires_at: '2027-01-01' },
          configs_summary: [{ id: 1, environment: 'production' }],
          // Acotado a 5 para no llenar la ventana de contexto.
          recent_submissions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        },
        emission_chain: {
          send_tool: 'send_invoice_dian (F-30)',
          requires: [
            'get_emit_readiness con emittable=true (F-32)',
            'get_dian_status con emission.is_live=true (F-35)',
            'list_invoice_resolutions con una resolución activa y saldo disponible (F-34)',
            'identidad del emisor responsable del impuesto del documento (assertCanChargeVat)',
          ],
        },
      });
    });

    it('(c) DIAN ilegible → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getDashboard.mockRejectedValue(new Error('db'));
      deps.dianConfigService.getEmissionStatus.mockResolvedValue(EMISSION);

      const answer = await run(tools, 'get_dian_status', {});

      expect(answer.error).toContain('No se pudo leer el estado DIAN');
      expect(answer.next_step).toContain('facturación electrónica');
    });
  });
});
