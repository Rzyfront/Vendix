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
      invoicingService: {
        findOne: jest.fn(),
        update: jest.fn(),
        createFromOrder: jest.fn(),
      },
      invoiceFlowService: {
        getEmitReadiness: jest.fn(),
        getIssuerEmissionGate: jest.fn(),
        // Fixture con los valores reales de `VALID_TRANSITIONS` del dueño
        // (`invoice-flow.service.ts`): la tool ya no espeja la tabla, la
        // consulta por este método (paso 15).
        getValidTransitions: jest.fn(
          (status: string) =>
            (
              {
                draft: ['validated', 'cancelled'],
                validated: ['sent', 'cancelled'],
                sent: ['accepted', 'rejected'],
                accepted: [],
                rejected: ['sent', 'voided'],
                cancelled: [],
                voided: [],
              } as Record<string, string[]>
            )[status] ?? [],
        ),
        validate: jest.fn(),
        send: jest.fn(),
        accept: jest.fn(),
        reject: jest.fn(),
        cancel: jest.fn(),
        void: jest.fn(),
      },
      dianEventsService: { findByInvoice: jest.fn() },
      resolutionsService: { findAll: jest.fn() },
      dianConfigService: {
        getDashboard: jest.fn(),
        getEmissionStatus: jest.fn(),
        getProductionReadiness: jest.fn(),
        promoteToProduction: jest.fn(),
        getConfigById: jest.fn(),
        updateCertificate: jest.fn(),
      },
      certificateAdapter: { validateCertificate: jest.fn() },
      s3Service: { uploadFile: jest.fn() },
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
  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  describe('registro', () => {
    const READS = [
      'get_invoice_status',
      'get_emit_readiness',
      'list_invoice_resolutions',
      'get_dian_status',
      'get_production_readiness',
    ];
    const WRITES = [
      'validate_invoice',
      'send_invoice_dian',
      'accept_invoice',
      'create_invoice_from_order',
      'promote_dian_to_production',
      'upload_dian_certificate',
    ];

    it('expone los 11 tools de facturación (4 reads P0 + 1 read P1 + 6 writes)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_invoice_status',
        'get_emit_readiness',
        'list_invoice_resolutions',
        'get_dian_status',
        'validate_invoice',
        'send_invoice_dian',
        'accept_invoice',
        'create_invoice_from_order',
        'get_production_readiness',
        'promote_dian_to_production',
        'upload_dian_certificate',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('invoicing');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('reads exigen invoicing:read y writes invoicing:write (mismo verbo que el controlador)', () => {
      const { tools } = buildTools();
      for (const name of READS) {
        expect(getTool(tools, name).requiredPermissions).toEqual([
          'invoicing:read',
        ]);
      }
      for (const name of WRITES) {
        expect(getTool(tools, name).requiredPermissions).toEqual([
          'invoicing:write',
        ]);
      }
    });

    it('los reads son puros y los writes exigen confirmación con preview', () => {
      const { tools } = buildTools();
      for (const name of READS) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
      }
      for (const name of WRITES) {
        const tool = getTool(tools, name);
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
      }
      for (const tool of tools) {
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

  // ─── F-29: validate_invoice ──────────────────────────────────────────
  describe('validate_invoice (F-29)', () => {
    const DRAFT = {
      id: 11,
      invoice_number: 'FV-011',
      status: 'draft',
      customer: { legal_name: 'Comercial Andina' },
    };
    const READY = { emittable: true, blockers: [], warnings: [] };

    function readyDeps() {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(DRAFT);
      deps.invoiceFlowService.getEmitReadiness.mockResolvedValue(READY);
      return { deps, tools };
    }

    it('(e) preview ok con sujeto humano y efecto F-30', async () => {
      const { tools } = readyDeps();
      const card = await preview(tools, 'validate_invoice', { invoice_id: 11 });

      expect(card.status).toBe('ok');
      expect(card.target).toBe('Validar factura FV-011 de Comercial Andina');
      expect(card.changes).toEqual([
        { field: 'estado', label: 'Estado', from: 'draft', to: 'validated' },
        {
          field: 'efecto',
          label: 'Efecto',
          from: null,
          to: 'habilita la emisión con send_invoice_dian (F-30)',
        },
      ]);
      expect(card.domain).toBe('invoicing');
    });

    it('(b) handler valida tras re-verificar (snapshot)', async () => {
      const { deps, tools } = readyDeps();
      deps.invoiceFlowService.validate.mockResolvedValue({
        id: 11,
        invoice_number: 'FV-011',
        status: 'validated',
        total_amount: '119000',
      });

      const answer = await run(tools, 'validate_invoice', { invoice_id: 11 });

      expect(answer).toEqual({
        invoice_id: 11,
        invoice_number: 'FV-011',
        status: 'validated',
        total_amount: 119000,
        enables: 'send_invoice_dian (F-30)',
      });
      expect(deps.invoiceFlowService.validate).toHaveBeenCalledWith(11);
    });

    it('(c) no-draft no propone y el sad no toca validate', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue({
        ...DRAFT,
        status: 'sent',
      });

      const card = await preview(tools, 'validate_invoice', { invoice_id: 11 });
      expect(card.status).toBe('error');
      expect(card.message).toContain("estado 'sent'");

      const answer = await run(tools, 'validate_invoice', { invoice_id: 11 });
      expect(answer.error).toContain('ya no está en borrador');
      expect(answer.next_step).toContain('F-28');
      expect(deps.invoiceFlowService.validate).not.toHaveBeenCalled();
    });

    it('(c) readiness que se cae entre preview y apply bloquea el handler', async () => {
      const { deps, tools } = readyDeps();
      deps.invoiceFlowService.getEmitReadiness.mockResolvedValue({
        emittable: false,
        blockers: [{ problem: 'sin líneas' }],
        warnings: [],
      });

      const card = await preview(tools, 'validate_invoice', { invoice_id: 11 });
      expect(card.status).toBe('error');
      expect(card.message).toContain('get_emit_readiness (F-32)');

      const answer = await run(tools, 'validate_invoice', { invoice_id: 11 });
      expect(answer.error).toContain('dejó de ser validable');
      expect(deps.invoiceFlowService.validate).not.toHaveBeenCalled();
    });
  });

  // ─── F-30: send_invoice_dian ─────────────────────────────────────────
  describe('send_invoice_dian (F-30)', () => {
    const INVOICE = {
      id: 12,
      invoice_number: 'FV-012',
      status: 'validated',
      customer: { legal_name: 'Comercial Andina' },
    };
    const GATE = {
      invoice_id: 12,
      vat_responsible: true,
      vat_indeterminate: false,
      vat_reason: 'declared_responsible',
      vat_message: 'Responsable de IVA (O-48).',
      inc_responsible: true,
      inc_indeterminate: false,
      tax_responsibilities: ['O-48', 'O-33'],
      can_emit: true,
    };
    const RESOLUTION = {
      id: 3,
      resolution_number: '18760000001',
      prefix: 'FV',
      is_active: true,
      from_number: 1,
      to_number: 1000,
      current_number: 11,
    };

    function chainedDeps(overrides: Record<string, any> = {}) {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(
        overrides.invoice ?? INVOICE,
      );
      deps.invoiceFlowService.getEmitReadiness.mockResolvedValue(
        overrides.readiness ?? { emittable: true, blockers: [], warnings: [] },
      );
      deps.invoiceFlowService.getIssuerEmissionGate.mockResolvedValue(
        overrides.gate ?? GATE,
      );
      deps.dianConfigService.getEmissionStatus.mockResolvedValue(
        overrides.emission ?? { is_live: true },
      );
      deps.resolutionsService.findAll.mockResolvedValue(
        overrides.resolutions ?? [RESOLUTION],
      );
      return { deps, tools };
    }

    it('(e) preview warning con frase irreversible y esquema del emisor', async () => {
      const { tools } = chainedDeps();
      const card = await preview(tools, 'send_invoice_dian', {
        invoice_id: 12,
      });

      expect(card.status).toBe('warning');
      expect(card.target).toBe(
        'Emitir factura FV-012 de Comercial Andina ante la DIAN',
      );
      expect(card.message).toContain(
        'Un documento electrónico emitido ante la DIAN no se puede deshacer',
      );
      expect(card.message).toContain('F-32 emisible');
      const byField = Object.fromEntries(
        card.changes.map((change: any) => [change.field, change.to]),
      );
      expect(byField.estado).toBe('sent');
      expect(byField.esquema_emisor).toBe('ZA · IVA e INC');
      expect(byField.tax_level_code).toBe('R-99-PN');
      expect(card.domain).toBe('invoicing');
    });

    it('(b) handler emite y proyecta issuer_dian + resolución (snapshot)', async () => {
      const { deps, tools } = chainedDeps();
      deps.invoiceFlowService.send.mockResolvedValue({
        id: 12,
        invoice_number: 'FV-012',
        status: 'sent',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        cufe: 'cufe-1',
      });

      const answer = await run(tools, 'send_invoice_dian', { invoice_id: 12 });

      expect(answer).toEqual({
        invoice_id: 12,
        invoice_number: 'FV-012',
        status: 'sent',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        cufe: 'cufe-1',
        is_resend: false,
        issuer_dian: {
          party_tax_scheme: { id: 'ZA', name: 'IVA e INC' },
          tax_level_code: 'R-99-PN',
        },
        resolution_used: {
          id: 3,
          resolution_number: '18760000001',
          prefix: 'FV',
          remaining_before: 989,
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
      expect(deps.invoiceFlowService.send).toHaveBeenCalledWith(12);
    });

    it('(c) sin O-48 nunca emitir: CTA al wizard y send intacto', async () => {
      const { deps, tools } = chainedDeps({
        gate: {
          ...GATE,
          vat_responsible: false,
          vat_indeterminate: true,
          vat_message: 'Sin señal fiscal concluyente.',
          can_emit: false,
        },
      });

      const card = await preview(tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(card.status).toBe('error');
      expect(card.message).toContain('Sin O-48 nunca emitir');
      expect(card.message).toContain('/admin/fiscal/wizard');

      const answer = await run(tools, 'send_invoice_dian', { invoice_id: 12 });
      expect(answer.error).toContain('Sin O-48 nunca emitir');
      expect(answer.next_step).toContain('/admin/fiscal/wizard');
      expect(deps.invoiceFlowService.send).not.toHaveBeenCalled();
    });

    it('(c) resolución sin saldo → {error, next_step}', async () => {
      const { deps, tools } = chainedDeps({
        resolutions: [{ ...RESOLUTION, current_number: 1000 }],
      });

      const answer = await run(tools, 'send_invoice_dian', { invoice_id: 12 });

      expect(answer.error).toContain('saldo de numeración');
      expect(answer.next_step).toContain('F-34');
      expect(deps.invoiceFlowService.send).not.toHaveBeenCalled();
    });

    it('(c) readiness falso y DIAN caída bloquean con su guía', async () => {
      const blocked = chainedDeps({
        readiness: {
          emittable: false,
          blockers: [{ problem: 'adquiriente sin NIT' }],
        },
      });
      const noReady = await run(blocked.tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(noReady.error).toContain('no es emisible');
      expect(noReady.next_step).toContain('F-32');
      expect(
        blocked.deps.invoiceFlowService.send,
      ).not.toHaveBeenCalled();

      const down = chainedDeps({
        emission: { is_live: false, reason: 'certificado vencido' },
      });
      const noLive = await run(down.tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(noLive.error).toContain('no está en vivo');
      expect(noLive.next_step).toContain('F-35');
      expect(down.deps.invoiceFlowService.send).not.toHaveBeenCalled();
    });

    it('(c) borrador pide F-29 y aceptada pide nota crédito', async () => {
      const draft = chainedDeps({
        invoice: { ...INVOICE, status: 'draft' },
      });
      const draftAnswer = await run(draft.tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(draftAnswer.next_step).toContain('F-29');

      const accepted = chainedDeps({
        invoice: { ...INVOICE, status: 'accepted' },
      });
      const acceptedAnswer = await run(accepted.tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(acceptedAnswer.next_step).toContain('nota crédito');
    });

    it('reenvío de un rechazo se marca como tal', async () => {
      const { deps, tools } = chainedDeps({
        invoice: { ...INVOICE, status: 'rejected' },
      });
      deps.invoiceFlowService.send.mockResolvedValue({
        id: 12,
        status: 'sent',
      });

      const card = await preview(tools, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(card.target).toContain('reenvío');
      const answer = await run(tools, 'send_invoice_dian', { invoice_id: 12 });
      expect(answer.is_resend).toBe(true);
    });
  });

  // ─── F-31: accept_invoice ────────────────────────────────────────────
  describe('accept_invoice (F-31)', () => {
    const SENT = {
      id: 13,
      invoice_number: 'FV-013',
      status: 'sent',
      notes: null,
      customer: { legal_name: 'Comercial Andina' },
    };

    it('(b) accept sobre sent dispara la transición (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(SENT);
      deps.invoiceFlowService.accept.mockResolvedValue({
        id: 13,
        invoice_number: 'FV-013',
        status: 'accepted',
      });

      const card = await preview(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'accept',
      });
      expect(card.status).toBe('ok');
      expect(card.target).toBe('Aceptar factura FV-013 de Comercial Andina');
      expect(card.message).toContain('asientos contables');

      const answer = await run(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'accept',
      });
      expect(answer).toEqual({
        invoice_id: 13,
        invoice_number: 'FV-013',
        action: 'accept',
        status: 'accepted',
        note_attached: false,
      });
      expect(deps.invoiceFlowService.accept).toHaveBeenCalledWith(13);
      // Paso 15: el preview consulta las salidas al dueño, no a un espejo.
      expect(deps.invoiceFlowService.getValidTransitions).toHaveBeenCalledWith(
        'sent',
      );
    });

    it('(e) void porta la frase irreversible', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue({
        ...SENT,
        status: 'rejected',
      });
      deps.invoiceFlowService.void.mockResolvedValue({
        id: 13,
        status: 'voided',
      });

      const card = await preview(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'void',
      });
      expect(card.status).toBe('warning');
      expect(card.message).toContain(
        'Un documento electrónico emitido ante la DIAN no se puede deshacer',
      );
      const answer = await run(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'void',
      });
      expect(answer.status).toBe('voided');
    });

    it('(c) aceptada no se toca: pide nota crédito', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue({
        ...SENT,
        status: 'accepted',
      });

      const card = await preview(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'void',
      });
      expect(card.status).toBe('error');
      expect(card.message).toContain('nota crédito');
      expect(deps.invoiceFlowService.void).not.toHaveBeenCalled();
    });

    it('nota en borrador se adhiere; en enviada se rechaza', async () => {
      const draftCase = buildTools();
      draftCase.deps.invoicingService.findOne.mockResolvedValue({
        ...SENT,
        status: 'draft',
      });
      draftCase.deps.invoicingService.update.mockResolvedValue({});
      draftCase.deps.invoiceFlowService.cancel.mockResolvedValue({
        id: 13,
        status: 'cancelled',
      });

      const card = await preview(draftCase.tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'cancel',
        note: 'Duplicada del mostrador',
      });
      expect(card.status).toBe('warning');
      expect(
        card.changes.find((change: any) => change.field === 'nota')?.to,
      ).toBe('Duplicada del mostrador');

      const ok = await run(draftCase.tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'cancel',
        note: 'Duplicada del mostrador',
      });
      expect(ok.note_attached).toBe(true);
      expect(draftCase.deps.invoicingService.update).toHaveBeenCalledWith(13, {
        notes: 'Duplicada del mostrador',
      });

      const sentCase = buildTools();
      sentCase.deps.invoicingService.findOne.mockResolvedValue(SENT);
      const denied = await run(sentCase.tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'accept',
        note: 'tardía',
      });
      expect(denied.error).toContain('solo se adhiere sobre un borrador');
      expect(sentCase.deps.invoiceFlowService.accept).not.toHaveBeenCalled();
    });

    it('(a) sad: action y nota inválidas no tocan el flow', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.findOne.mockResolvedValue(SENT);

      const badAction = await run(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'explode',
      });
      expect(badAction.error).toContain('action inválida');

      const longNote = await run(tools, 'accept_invoice', {
        invoice_id: 13,
        action: 'accept',
        note: 'x'.repeat(501),
      });
      expect(longNote.error).toContain('500 caracteres');
      expect(deps.invoiceFlowService.accept).not.toHaveBeenCalled();
    });
  });

  // ─── F-33: create_invoice_from_order ─────────────────────────────────
  describe('create_invoice_from_order (F-33)', () => {
    it('(b) crea el borrador desde la orden (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.createFromOrder.mockResolvedValue({
        id: 21,
        invoice_number: 'FV-021',
        status: 'draft',
        subtotal_amount: '100000',
        tax_amount: '19000',
        total_amount: '119000',
      });

      const card = await preview(tools, 'create_invoice_from_order', {
        order_id: 9,
      });
      expect(card.status).toBe('ok');
      expect(card.target).toBe('Factura borrador desde la orden #9');
      expect(card.message).toContain('F-32');

      const answer = await run(tools, 'create_invoice_from_order', {
        order_id: 9,
      });
      expect(answer).toEqual({
        invoice_id: 21,
        invoice_number: 'FV-021',
        status: 'draft',
        order_id: 9,
        subtotal: 100000,
        tax_amount: 19000,
        total_amount: 119000,
        next_step: 'Evalúa el borrador con get_emit_readiness (F-32).',
      });
      expect(deps.invoicingService.createFromOrder).toHaveBeenCalledWith(9);
    });

    it('(c) orden ya facturada → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.invoicingService.createFromOrder.mockRejectedValue(
        new Error('la orden ya está facturada'),
      );

      const answer = await run(tools, 'create_invoice_from_order', {
        order_id: 9,
      });
      expect(answer.error).toContain('ya está facturada');
      expect(answer.next_step).toContain('get_order');
    });
  });

  // ─── F-36: get_production_readiness ──────────────────────────────────
  describe('get_production_readiness (F-36)', () => {
    const REPORT = {
      environment: 'test',
      enablement_status: 'in_progress',
      ready: true,
      missing: [],
      checks: [{ key: 'certificate', satisfied: true }],
      warnings: [],
      actionable: [],
      waiting_on_dian: [],
      resolutions: [
        {
          id: 3,
          prefix: 'FV',
          resolution_number: '18760000001',
          range_from: 1,
          range_to: 1000,
          current_number: 11,
          valid_from: '2026-01-01T00:00:00.000Z',
          valid_to: '2027-01-01T00:00:00.000Z',
          technical_key: 'SECRETA',
          is_habilitacion_range: false,
          is_expired: false,
          is_exhausted: false,
        },
      ],
    };

    it('(b) proyecta el checklist sin la clave técnica (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getProductionReadiness.mockResolvedValue(REPORT);

      const answer = await run(tools, 'get_production_readiness', {
        config_id: 5,
      });

      expect(answer).toEqual({
        config_id: 5,
        environment: 'test',
        enablement_status: 'in_progress',
        ready: true,
        missing: [],
        checks: [{ key: 'certificate', satisfied: true }],
        warnings: [],
        actionable: [],
        waiting_on_dian: [],
        resolutions: [
          {
            id: 3,
            prefix: 'FV',
            resolution_number: '18760000001',
            range_from: 1,
            range_to: 1000,
            current_number: 11,
            valid_from: '2026-01-01T00:00:00.000Z',
            valid_to: '2027-01-01T00:00:00.000Z',
            is_habilitacion_range: false,
            is_expired: false,
            is_exhausted: false,
          },
        ],
        enables: 'promote_dian_to_production (F-37)',
      });
      expect(JSON.stringify(answer)).not.toContain('SECRETA');
      expect(JSON.stringify(answer)).not.toContain('technical_key');
    });

    it('(a) sad: config_id inválido no toca el service', async () => {
      const { deps, tools } = buildTools();
      const answer = await run(tools, 'get_production_readiness', {
        config_id: -2,
      });
      expect(answer.error).toContain('config_id inválido');
      expect(
        deps.dianConfigService.getProductionReadiness,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── F-37: promote_dian_to_production ────────────────────────────────
  describe('promote_dian_to_production (F-37)', () => {
    const READY_REPORT = {
      environment: 'test',
      enablement_status: 'ready',
      ready: true,
      missing: [],
      checks: [],
    };

    it('(e) preview warning con frase de dian-config', async () => {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getProductionReadiness.mockResolvedValue(
        READY_REPORT,
      );
      deps.dianConfigService.promoteToProduction.mockResolvedValue({
        id: 5,
        environment: 'production',
        enablement_status: 'enabled',
        enabled_at: '2026-09-29T00:00:00.000Z',
      });

      const card = await preview(tools, 'promote_dian_to_production', {
        config_id: 5,
      });
      expect(card.status).toBe('warning');
      expect(card.message).toContain(
        'Cambiar la configuración de facturación electrónica afecta todos los documentos',
      );

      const answer = await run(tools, 'promote_dian_to_production', {
        config_id: 5,
      });
      expect(answer).toEqual({
        config_id: 5,
        environment: 'production',
        enablement_status: 'enabled',
        enabled_at: '2026-09-29T00:00:00.000Z',
      });
      expect(deps.dianConfigService.promoteToProduction).toHaveBeenCalledWith(
        5,
      );
    });

    it('(c) checklist incompleto bloquea con los faltantes', async () => {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getProductionReadiness.mockResolvedValue({
        ...READY_REPORT,
        ready: false,
        missing: ['certificate', 'test_set'],
      });

      const card = await preview(tools, 'promote_dian_to_production', {
        config_id: 5,
      });
      expect(card.status).toBe('error');
      expect(card.message).toContain('certificate, test_set');

      const answer = await run(tools, 'promote_dian_to_production', {
        config_id: 5,
      });
      expect(answer.error).toContain('dejó de estar lista');
      expect(deps.dianConfigService.promoteToProduction).not.toHaveBeenCalled();
    });
  });

  // ─── F-38: upload_dian_certificate ───────────────────────────────────
  describe('upload_dian_certificate (F-38)', () => {
    const P12 = Buffer.from('fake-p12-bytes').toString('base64');
    const CONFIG = {
      id: 5,
      organization_id: 3,
      store_id: 7,
      nit: '900123456',
      nit_dv: '7',
    };
    const VALIDATION = {
      valid: true,
      subject: 'CN=Comercial Andina',
      issuer: 'CN=DIAN CA',
      expires: new Date('2027-06-01T00:00:00.000Z'),
      fingerprint: 'AA:BB',
      serial_number: '01',
      tax_id: '900123456',
    };

    function certDeps() {
      const { deps, tools } = buildTools();
      deps.dianConfigService.getConfigById.mockResolvedValue(CONFIG);
      deps.certificateAdapter.validateCertificate.mockResolvedValue(
        VALIDATION,
      );
      deps.s3Service.uploadFile.mockResolvedValue('s3://key');
      deps.dianConfigService.updateCertificate.mockResolvedValue({
        id: 5,
        certificate_source: 'manual_upload_validated',
        certificate_uploaded_at: '2026-09-29T00:00:00.000Z',
      });
      return { deps, tools };
    }

    it('(e) preview valida sin persistir y jamás nombra el secreto', async () => {
      const { deps, tools } = certDeps();
      const card = await preview(tools, 'upload_dian_certificate', {
        config_id: 5,
        p12_base64: P12,
        password: 's3cr3t',
      });

      expect(card.status).toBe('warning');
      expect(card.target).toContain('NIT 900123456');
      expect(JSON.stringify(card)).not.toContain('s3cr3t');
      expect(JSON.stringify(card)).not.toContain(P12);
      expect(
        deps.certificateAdapter.validateCertificate,
      ).toHaveBeenCalledWith({
        p12_buffer: expect.any(Buffer),
        password: 's3cr3t',
        expected_tax_id: '900123456',
        expected_dv: '7',
      });
      expect(deps.s3Service.uploadFile).not.toHaveBeenCalled();
      expect(deps.dianConfigService.updateCertificate).not.toHaveBeenCalled();
    });

    it('(b) handler sube, activa y devuelve solo lo público (snapshot)', async () => {
      const { deps, tools } = certDeps();
      const answer = await run(tools, 'upload_dian_certificate', {
        config_id: 5,
        p12_base64: P12,
        password: 's3cr3t',
      });

      expect(answer).toEqual({
        config_id: 5,
        certificate_source: 'manual_upload_validated',
        certificate_uploaded_at: '2026-09-29T00:00:00.000Z',
        certificate: {
          subject: 'CN=Comercial Andina',
          issuer: 'CN=DIAN CA',
          expires: '2027-06-01T00:00:00.000Z',
          fingerprint: 'AA:BB',
          serial_number: '01',
          tax_id: '900123456',
        },
      });
      expect(JSON.stringify(answer)).not.toContain('s3cr3t');
      expect(deps.s3Service.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        'dian/certificates/org-3/7/5/certificate.p12',
        'application/x-pkcs12',
      );
      expect(deps.dianConfigService.updateCertificate).toHaveBeenCalledWith(
        5,
        'dian/certificates/org-3/7/5/certificate.p12',
        's3cr3t',
        VALIDATION.expires,
        VALIDATION,
      );
    });

    it('(c) certificado inválido, base64 roto y falta de clave bloquean', async () => {
      const badCert = certDeps();
      badCert.deps.certificateAdapter.validateCertificate.mockResolvedValue({
        valid: false,
        error: 'certificate expired long ago',
      });
      const expired = await run(badCert.tools, 'upload_dian_certificate', {
        config_id: 5,
        p12_base64: P12,
        password: 's3cr3t',
      });
      expect(expired.error).toContain('vencido');
      expect(badCert.deps.s3Service.uploadFile).not.toHaveBeenCalled();

      const { deps, tools } = buildTools();
      const broken = await run(tools, 'upload_dian_certificate', {
        config_id: 5,
        p12_base64: '!!!no-base64!!!',
        password: 's3cr3t',
      });
      expect(broken.error).toContain('p12_base64 inválido');

      const noPassword = await run(tools, 'upload_dian_certificate', {
        config_id: 5,
        p12_base64: P12,
        password: '  ',
      });
      expect(noPassword.error).toContain('password es obligatoria');
      expect(
        deps.certificateAdapter.validateCertificate,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── Guarda transversal: irreversibilidad + esquema del emisor ────────
  describe('guarda transversal (IRREVERSIBLE_DOMAINS + PartyTaxScheme)', () => {
    it('invoicing y dian-config pertenecen a IRREVERSIBLE_DOMAINS con la frase usada', async () => {
      const { IRREVERSIBLE_DOMAINS } = await import(
        '../bridge/capability-registry.service'
      );
      expect(typeof IRREVERSIBLE_DOMAINS.invoicing).toBe('string');
      expect(typeof IRREVERSIBLE_DOMAINS['dian-config']).toBe('string');

      const { tools } = buildTools();
      const sendDesc = getTool(tools, 'send_invoice_dian').description;
      expect(sendDesc).toContain('IRREVERSIBLE');
      const { deps, tools: chained } = ((): any => {
        const built = buildTools();
        built.deps.invoicingService.findOne.mockResolvedValue({
          id: 12,
          invoice_number: 'FV-012',
          status: 'validated',
          customer: { legal_name: 'Comercial Andina' },
        });
        built.deps.invoiceFlowService.getEmitReadiness.mockResolvedValue({
          emittable: true,
          blockers: [],
          warnings: [],
        });
        built.deps.invoiceFlowService.getIssuerEmissionGate.mockResolvedValue({
          can_emit: true,
          vat_responsible: true,
          inc_responsible: false,
          tax_responsibilities: ['O-48'],
          vat_message: 'ok',
        });
        built.deps.dianConfigService.getEmissionStatus.mockResolvedValue({
          is_live: true,
        });
        built.deps.resolutionsService.findAll.mockResolvedValue([
          {
            id: 3,
            resolution_number: '1876',
            is_active: true,
            from_number: 1,
            to_number: 100,
            current_number: 1,
          },
        ]);
        return built;
      })();
      const card = await preview(chained, 'send_invoice_dian', {
        invoice_id: 12,
      });
      expect(card.message).toContain(IRREVERSIBLE_DOMAINS.invoicing);
      expect(deps).toBeDefined();
    });

    it('PartyTaxScheme de 4 estados y TaxLevelCode colapsando a R-99-PN', async () => {
      const { resolveDianPartyTaxScheme } = await import(
        '../../../domains/store/invoicing/providers/dian-direct/constants/dian-tax-codes'
      );
      const { toDianTaxLevelCode } = await import(
        '../../../domains/store/invoicing/providers/dian-direct/constants/dian-tax-level-codes'
      );
      // Guarda del contrato que F-30 proyecta: la tabla completa, no 2 casos.
      expect(
        resolveDianPartyTaxScheme({ vat_responsible: true, inc_responsible: true }),
      ).toEqual({ id: 'ZA', name: 'IVA e INC' });
      expect(
        resolveDianPartyTaxScheme({ vat_responsible: true, inc_responsible: false }),
      ).toEqual({ id: '01', name: 'IVA' });
      expect(
        resolveDianPartyTaxScheme({ vat_responsible: false, inc_responsible: true }),
      ).toEqual({ id: '04', name: 'INC' });
      expect(
        resolveDianPartyTaxScheme({ vat_responsible: false, inc_responsible: false }),
      ).toEqual({ id: 'ZZ', name: 'No aplica' });
      // O-48/O-33 no existen en facturación electrónica: colapsan a R-99-PN.
      expect(toDianTaxLevelCode(['O-48', 'O-33'])).toBe('R-99-PN');
      expect(toDianTaxLevelCode(['O-13', 'O-15'])).toBe('O-13;O-15');
    });
  });
});
