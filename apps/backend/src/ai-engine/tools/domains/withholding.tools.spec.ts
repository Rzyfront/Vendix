import { createWithholdingTools, WithholdingToolDeps } from './withholding.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * F-39/F-41 — Spec de contrato de la familia withholding (patrón canónico T4).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) las 2 son reads puras: `readOnly: true`, sin `requiresConfirmation` ni
 *     `preview` — el preview fiscal es proyección del motor, no propuesta de
 *     escritura, y jamás persiste líneas.
 *
 * Regla fiscal que esta spec blinda: el modelo NUNCA calcula a mano. Suffered
 * viaja SIEMPRE por `resolveSufferedByOperation` (una línea por grupo de
 * operación en venta mixta), practiced por `previewWithholding` del service.
 */
describe('withholding.tools · contrato canónico T4', () => {
  const STORE_ID = 7;
  const ORG_ID = 3;

  function baseDeps() {
    return {
      withholdingTaxService: {
        previewWithholding: jest.fn(),
        findAllCalculations: jest.fn(),
        getStats: jest.fn(),
        calculateWithholding: jest.fn(),
        generateCertificate: jest.fn(),
        generateSufferedCertificate: jest.fn(),
        generateEmployeeCertificate: jest.fn(),
      },
      withholdingFlowService: {
        resolveSufferedByOperation: jest.fn(),
      },
      exogenousService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        validateYear: jest.fn(),
        generateReport: jest.fn(),
        markAsSubmitted: jest.fn(),
      },
      taxesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    } as any satisfies WithholdingToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createWithholdingTools(deps) };
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

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    const PERMISSIONS: Record<string, string[]> = {
      preview_withholding: ['withholding:read'],
      list_withholding_calculations: ['withholding:read'],
      calculate_withholding: ['withholding:read'],
      get_withholding_certificate: ['withholding:read'],
      list_exogenous_reports: ['exogenous:read'],
      get_exogenous_status: ['exogenous:read'],
      generate_exogenous_report: ['exogenous:write'],
      submit_exogenous_report: ['exogenous:write'],
      list_tax_categories: ['store:taxes:read'],
      create_tax_category: ['store:taxes:create'],
      update_tax_category: ['store:taxes:update'],
    };
    const WRITES = [
      'generate_exogenous_report',
      'submit_exogenous_report',
      'create_tax_category',
      'update_tax_category',
    ];

    it('expone los 11 tools de la familia (2 reads P0 + 9 del paso 11)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'preview_withholding',
        'list_withholding_calculations',
        'calculate_withholding',
        'get_withholding_certificate',
        'list_exogenous_reports',
        'get_exogenous_status',
        'generate_exogenous_report',
        'submit_exogenous_report',
        'list_tax_categories',
        'create_tax_category',
        'update_tax_category',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('withholding');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool exige el permiso de su controlador (mismo verbo)', () => {
      const { tools } = buildTools();
      for (const [name, permissions] of Object.entries(PERMISSIONS)) {
        expect(getTool(tools, name).requiredPermissions).toEqual(permissions);
      }
    });

    it('los reads son puros y los 4 writes exigen confirmación con preview', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
        if (WRITES.includes(tool.name)) {
          expect(tool.readOnly ?? false).toBe(false);
          expect(tool.requiresConfirmation).toBe(true);
          expect(typeof tool.preview).toBe('function');
        } else {
          expect(tool.readOnly).toBe(true);
          expect(tool.requiresConfirmation ?? false).toBe(false);
          expect(tool.preview).toBeUndefined();
        }
      }
    });

    it('declara requeridos del JSON Schema', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'preview_withholding').parameters.required,
      ).toEqual(['role', 'base']);
      expect(
        getTool(tools, 'preview_withholding').parameters.properties.role.enum,
      ).toEqual(['practiced', 'suffered']);
      expect(
        getTool(tools, 'list_withholding_calculations').parameters.required,
      ).toEqual([]);
    });
  });

  // ─── F-39: preview_withholding ─────────────────────────────────────────
  describe('preview_withholding (F-39)', () => {
    const SUFFERED_LINES = [
      {
        withholding_type: 'retefuente',
        concept_code: 'RTE_COMPRAS',
        concept_id: 1,
        rate: 0.025,
        base: 100000,
        amount: 2500,
        role: 'suffered',
        account_role: 'withholding.suffered.retefuente_receivable',
        account_code: null,
      },
      {
        withholding_type: 'retefuente',
        concept_code: 'RTE_SERV_GEN',
        concept_id: 2,
        rate: 0.04,
        base: 50000,
        amount: 2000,
        role: 'suffered',
        account_role: 'withholding.suffered.retefuente_receivable',
        account_code: null,
      },
    ];

    it('(b) suffered simple: un grupo vía resolveSufferedByOperation', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingFlowService.resolveSufferedByOperation.mockResolvedValue({
        lines: [SUFFERED_LINES[0]],
        uvt_value_used: 47065,
        counterparty_type: 'customer',
      });

      const answer = await run(
        tools,
        'preview_withholding',
        { role: 'suffered', base: 100000, customer_id: 9 },
        { store_id: STORE_ID, organization_id: ORG_ID },
      );

      // Nunca `resolveSuffered` directo: el único camino es por operación.
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).toHaveBeenCalledWith({
        organization_id: ORG_ID,
        store_id: STORE_ID,
        customer_id: 9,
        items: [{ product_type: null, base: 100000, ivaAmount: 0 }],
      });
      expect(
        deps.withholdingTaxService.previewWithholding,
      ).not.toHaveBeenCalled();
      expect(answer).toEqual({
        role: 'suffered',
        lines: [SUFFERED_LINES[0]],
        total_withholding: 2500,
        uvt_value_used: 47065,
        counterparty_type: 'customer',
        groups: 1,
      });
    });

    it('(b) venta mixta bienes+servicios: una línea por grupo', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingFlowService.resolveSufferedByOperation.mockResolvedValue({
        lines: SUFFERED_LINES,
        uvt_value_used: 47065,
        counterparty_type: 'customer',
      });

      const answer = await run(tools, 'preview_withholding', {
        role: 'suffered',
        base: 150000,
        customer_id: 9,
        items: [
          { product_type: 'physical', base: 100000, iva_amount: 19000 },
          { product_type: 'service', base: 50000, iva_amount: 9500 },
        ],
      });

      // Los items viajan intactos al FLOW: la tool no agrupa ni promedia, el
      // motor resuelve cada grupo con su propia base y umbral UVT.
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).toHaveBeenCalledWith({
        organization_id: ORG_ID,
        store_id: STORE_ID,
        customer_id: 9,
        items: [
          { product_type: 'physical', base: 100000, ivaAmount: 19000 },
          { product_type: 'service', base: 50000, ivaAmount: 9500 },
        ],
      });
      expect(answer.role).toBe('suffered');
      expect(answer.lines).toEqual(SUFFERED_LINES);
      expect(answer.total_withholding).toBe(4500);
      expect(answer.groups).toBe(2);
    });

    it('(b) B2C anónimo (sin cliente) → lines vacía, no error', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingFlowService.resolveSufferedByOperation.mockResolvedValue({
        lines: [],
        uvt_value_used: 0,
        counterparty_type: null,
      });

      const answer = await run(tools, 'preview_withholding', {
        role: 'suffered',
        base: 100000,
      });

      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ customer_id: null }),
      );
      expect(answer).toEqual({
        role: 'suffered',
        lines: [],
        total_withholding: 0,
        uvt_value_used: 0,
        counterparty_type: null,
        groups: 1,
      });
    });

    it('(b) practiced: vía previewWithholding del service con DTO validado', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.previewWithholding.mockResolvedValue({
        lines: [
          {
            withholding_type: 'retefuente',
            concept_code: 'RTE_COMPRAS',
            rate: 0.025,
            base: 200000,
            amount: 5000,
            role: 'practiced',
            account_role: 'withholding.practiced.retefuente_payable',
          },
        ],
        total_withholding: 5000,
      });

      const answer = await run(tools, 'preview_withholding', {
        role: 'practiced',
        base: 200000,
        supplier_id: 4,
      });

      expect(
        deps.withholdingTaxService.previewWithholding,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'practiced',
          base: 200000,
          supplier_id: 4,
        }),
      );
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).not.toHaveBeenCalled();
      expect(answer).toEqual({
        role: 'practiced',
        lines: [
          {
            withholding_type: 'retefuente',
            concept_code: 'RTE_COMPRAS',
            rate: 0.025,
            base: 200000,
            amount: 5000,
            role: 'practiced',
            account_role: 'withholding.practiced.retefuente_payable',
          },
        ],
        total_withholding: 5000,
      });
    });

    it('(a) sad: role/base inválidos no tocan el motor fiscal', async () => {
      const { deps, tools } = buildTools();

      const badRole = await run(tools, 'preview_withholding', {
        role: 'self',
        base: 100,
      });
      expect(badRole).toEqual({
        error:
          "role inválido: debe ser 'practiced' (compra a proveedor) o 'suffered' (venta a cliente).",
        next_step: 'Indica el rol de la operación antes de proyectar la retención.',
      });

      const badBase = await run(tools, 'preview_withholding', {
        role: 'suffered',
        base: -5,
      });
      expect(badBase).toEqual({
        error: 'base inválida: debe ser un número mayor o igual a cero.',
        next_step: 'Indica el subtotal de la operación en base.',
      });

      const badItem = await run(tools, 'preview_withholding', {
        role: 'suffered',
        base: 100,
        customer_id: 9,
        items: [{ product_type: 'service', base: 'mucha' }],
      });
      expect(badItem.error).toContain('items[0].base inválida');

      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).not.toHaveBeenCalled();
      expect(
        deps.withholdingTaxService.previewWithholding,
      ).not.toHaveBeenCalled();
    });

    it('(c) suffered sin organización en contexto → {error, next_step}', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'preview_withholding',
        { role: 'suffered', base: 100000, customer_id: 9 },
        { store_id: STORE_ID },
      );

      expect(answer.error).toContain('Sin organización en contexto');
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).not.toHaveBeenCalled();
    });

    it('(c) motor caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingFlowService.resolveSufferedByOperation.mockRejectedValue(
        new Error('sin UVT'),
      );

      const answer = await run(tools, 'preview_withholding', {
        role: 'suffered',
        base: 100000,
        customer_id: 9,
      });

      expect(answer.error).toContain(
        'No se pudo proyectar la retención sufrida',
      );
      expect(answer.next_step).toContain('UVT');
    });
  });

  // ─── F-41: list_withholding_calculations ───────────────────────────────
  describe('list_withholding_calculations (F-41)', () => {
    const ROWS = [
      {
        id: 101,
        year: 2026,
        role: 'practiced',
        counterparty_type: 'supplier',
        withholding_type: 'retefuente',
        concept_id: 1,
        concept: { code: 'RTE_COMPRAS', name: 'Compras' },
        base_amount: '200000.00',
        withholding_rate: '0.0250',
        withholding_amount: '5000.00',
        uvt_value_used: '47065.00',
        supplier: { id: 4, name: 'Proveedor SAS', tax_id: '900123456' },
        customer: null,
        invoice: { id: 42, invoice_number: 'FV-0042' },
        accounting_entity_id: 12,
        created_at: new Date('2026-09-10T10:00:00.000Z'),
      },
      {
        id: 102,
        year: 2026,
        role: 'suffered',
        counterparty_type: 'customer',
        withholding_type: 'reteiva',
        concept_id: 7,
        concept: { code: 'RTE_IVA', name: 'ReteIVA' },
        base_amount: '19000.00',
        withholding_rate: '0.1500',
        withholding_amount: '2850.00',
        uvt_value_used: '47065.00',
        supplier: null,
        customer: {
          id: 9,
          first_name: 'Ana',
          last_name: 'Ríos',
          email: 'ana@example.com',
        },
        invoice: null,
        accounting_entity_id: 12,
        created_at: new Date('2026-09-11T10:00:00.000Z'),
      },
    ];
    const STATS = {
      active_concepts: 12,
      current_uvt_value: 47065,
      current_uvt_year: 2026,
      monthly: { total_withheld: 7850, total_base: 219000, count: 2 },
      yearly: { total_withheld: 7850, total_base: 219000, count: 2 },
    };

    it('(b) happy: snapshot de histórico + paginación', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.findAllCalculations.mockResolvedValue({
        data: ROWS,
        total: 2,
        page: 1,
        limit: 20,
      });

      const answer = await run(tools, 'list_withholding_calculations', {
        year: 2026,
      });

      expect(
        deps.withholdingTaxService.findAllCalculations,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ year: 2026, page: 1, limit: 20 }),
      );
      expect(answer.page).toBe(1);
      expect(answer.limit).toBe(20);
      expect(answer.total).toBe(2);
      expect(answer.total_pages).toBe(1);
      expect(answer.calculations[0]).toEqual({
        id: 101,
        year: 2026,
        role: 'practiced',
        counterparty_type: 'supplier',
        withholding_type: 'retefuente',
        concept: { id: 1, code: 'RTE_COMPRAS', name: 'Compras' },
        base_amount: 200000,
        withholding_rate: 0.025,
        withholding_amount: 5000,
        uvt_value_used: 47065,
        supplier: { id: 4, name: 'Proveedor SAS', tax_id: '900123456' },
        customer: null,
        invoice: { id: 42, invoice_number: 'FV-0042' },
        accounting_entity_id: 12,
        created_at: '2026-09-10T10:00:00.000Z',
      });
      expect(answer.calculations[1].role).toBe('suffered');
      expect(answer.calculations[1].customer).toEqual({
        id: 9,
        name: 'Ana Ríos',
        email: 'ana@example.com',
      });
      expect(answer.stats).toBeUndefined();
    });

    it('include_stats=true agrega el resumen mensual/anual + UVT', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.findAllCalculations.mockResolvedValue({
        data: ROWS,
        total: 2,
        page: 1,
        limit: 20,
      });
      deps.withholdingTaxService.getStats.mockResolvedValue(STATS);

      const answer = await run(tools, 'list_withholding_calculations', {
        include_stats: true,
      });

      expect(deps.withholdingTaxService.getStats).toHaveBeenCalledWith();
      expect(answer.stats).toEqual(STATS);
      expect(answer.calculations).toHaveLength(2);
    });

    it('(a) sad: role inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_withholding_calculations', {
        role: 'self',
      });

      expect(answer.error).toContain('no pasaron la validación');
      expect(answer.next_step).toContain('role');
      expect(
        deps.withholdingTaxService.findAllCalculations,
      ).not.toHaveBeenCalled();
    });

    it('limit se acota a 100 antes de llegar al service', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.findAllCalculations.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 100,
      });

      await run(tools, 'list_withholding_calculations', { limit: 5000 });

      expect(
        deps.withholdingTaxService.findAllCalculations,
      ).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('(c) histórico ilegible → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.findAllCalculations.mockRejectedValue(
        new Error('db'),
      );

      const answer = await run(tools, 'list_withholding_calculations', {});

      expect(answer.error).toContain(
        'No se pudo leer el histórico de retenciones',
      );
      expect(answer.next_step).toContain('filtros');
    });
  });

  // ─── F-40: calculate_withholding ───────────────────────────────────────
  describe('calculate_withholding (F-40)', () => {
    it('(b) practiced: cálculo por concepto sin persistir (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.calculateWithholding.mockResolvedValue({
        withholding_amount: 25000,
        withholding_rate: 0.025,
      });

      const answer = await run(tools, 'calculate_withholding', {
        role: 'practiced',
        amount: 1000000,
        concept_code: 'RTE_COMPRAS',
      });

      expect(answer).toEqual({
        role: 'practiced',
        concept_code: 'RTE_COMPRAS',
        amount: 1000000,
        withholding_amount: 25000,
        withholding_rate: 0.025,
        result: { withholding_amount: 25000, withholding_rate: 0.025 },
      });
      expect(
        deps.withholdingTaxService.calculateWithholding,
      ).toHaveBeenCalledWith(1000000, 'RTE_COMPRAS', undefined);
    });

    it('(b) suffered: SIEMPRE vía resolveSufferedByOperation', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingFlowService.resolveSufferedByOperation.mockResolvedValue(
        {
          lines: [{ amount: 40000, withholding_type: 'retefuente' }],
          uvt_value_used: 47065,
          counterparty_type: 'customer',
        },
      );

      const answer = await run(
        tools,
        'calculate_withholding',
        {
          role: 'suffered',
          base: 1000000,
          iva_amount: 190000,
          customer_id: 9,
          product_type: 'service',
        },
        { store_id: STORE_ID, organization_id: ORG_ID },
      );

      expect(answer).toEqual({
        role: 'suffered',
        lines: [{ amount: 40000, withholding_type: 'retefuente' }],
        total_withholding: 40000,
        uvt_value_used: 47065,
        counterparty_type: 'customer',
      });
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).toHaveBeenCalledWith({
        organization_id: ORG_ID,
        store_id: STORE_ID,
        customer_id: 9,
        items: [{ product_type: 'service', base: 1000000, ivaAmount: 190000 }],
      });
    });

    it('(a) sad: rol, concepto y base inválidos no tocan el motor', async () => {
      const { deps, tools } = buildTools();

      const badRole = await run(tools, 'calculate_withholding', {
        role: 'self',
      });
      expect(badRole.error).toContain('role inválido');

      const noConcept = await run(tools, 'calculate_withholding', {
        role: 'practiced',
        amount: 100,
      });
      expect(noConcept.error).toContain('validación');

      const noBase = await run(tools, 'calculate_withholding', {
        role: 'suffered',
      });
      expect(noBase.error).toContain('base inválida');

      expect(
        deps.withholdingTaxService.calculateWithholding,
      ).not.toHaveBeenCalled();
      expect(
        deps.withholdingFlowService.resolveSufferedByOperation,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── F-42: get_withholding_certificate ─────────────────────────────────
  describe('get_withholding_certificate (F-42)', () => {
    it('(b) practiced por proveedor (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.generateCertificate.mockResolvedValue({
        supplier_name: 'Distribuidora Sur',
        supplier_nit: '900111222',
        total_base: 5000000,
        total_withheld: 125000,
        monthly_breakdown: [],
      });

      const answer = await run(tools, 'get_withholding_certificate', {
        kind: 'practiced',
        supplier_id: 4,
        year: 2025,
      });

      expect(answer).toEqual({
        kind: 'practiced',
        year: 2025,
        supplier_name: 'Distribuidora Sur',
        supplier_nit: '900111222',
        total_base: 5000000,
        total_withheld: 125000,
        monthly_breakdown: [],
      });
      expect(
        deps.withholdingTaxService.generateCertificate,
      ).toHaveBeenCalledWith(4, 2025);
    });

    it('suffered y employee rutean a su generador', async () => {
      const { deps, tools } = buildTools();
      deps.withholdingTaxService.generateSufferedCertificate.mockResolvedValue(
        { total_withheld: 80000 },
      );
      deps.withholdingTaxService.generateEmployeeCertificate.mockResolvedValue(
        { total_withheld: 1200000 },
      );

      const suffered = await run(tools, 'get_withholding_certificate', {
        kind: 'suffered',
        counterparty_type: 'customer',
        counterparty_id: 9,
        year: 2025,
      });
      expect(suffered.kind).toBe('suffered');
      expect(
        deps.withholdingTaxService.generateSufferedCertificate,
      ).toHaveBeenCalledWith('customer', 9, 2025);

      const employee = await run(tools, 'get_withholding_certificate', {
        kind: 'employee',
        employee_id: 2,
        year: 2025,
      });
      expect(employee.kind).toBe('employee');
      expect(
        deps.withholdingTaxService.generateEmployeeCertificate,
      ).toHaveBeenCalledWith(2, 2025);
    });

    it('(c) kind y año inválidos no tocan los generadores', async () => {
      const { deps, tools } = buildTools();

      const badKind = await run(tools, 'get_withholding_certificate', {
        kind: 'nope',
      });
      expect(badKind.error).toContain('kind inválido');

      const badYear = await run(tools, 'get_withholding_certificate', {
        kind: 'practiced',
        supplier_id: 4,
        year: 1999,
      });
      expect(badYear.error).toContain('2000');
      expect(
        deps.withholdingTaxService.generateCertificate,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── F-43: list_exogenous_reports ──────────────────────────────────────
  describe('list_exogenous_reports (F-43)', () => {
    it('(b) lista con rol legal por formato (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.exogenousService.findAll.mockResolvedValue({
        data: [
          {
            id: 1,
            fiscal_year: 2025,
            format_code: '1001',
            format_name: 'Retenciones practicadas',
            status: 'generated',
            line_count: 40,
            total_records: 40,
            total_amount: '1200000',
            submitted_at: null,
            created_at: '2026-02-01T00:00:00.000Z',
          },
          {
            id: 2,
            fiscal_year: 2025,
            format_code: '1003',
            format_name: 'Retenciones que le practicaron',
            status: 'submitted',
            line_count: 12,
            total_records: 12,
            total_amount: '300000',
            submitted_at: '2026-03-01T00:00:00.000Z',
            created_at: '2026-02-02T00:00:00.000Z',
          },
        ],
        meta: { total: 2, page: 1, limit: 20, total_pages: 1 },
      });

      const answer = await run(tools, 'list_exogenous_reports', {
        fiscal_year: 2025,
      });

      expect(answer.reports.map((row: any) => row.role)).toEqual([
        'practiced',
        'suffered',
      ]);
      expect(answer.total).toBe(2);
      expect(answer.reports[0]).toEqual({
        id: 1,
        fiscal_year: 2025,
        format_code: '1001',
        format_name: 'Retenciones practicadas',
        role: 'practiced',
        status: 'generated',
        line_count: 40,
        total_records: 40,
        total_amount: 1200000,
        submitted_at: null,
        created_at: '2026-02-01T00:00:00.000Z',
      });
    });

    it('(c) servicio caído → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.exogenousService.findAll.mockRejectedValue(new Error('db'));

      const answer = await run(tools, 'list_exogenous_reports', {});
      expect(answer.error).toContain('No se pudieron leer los reportes');
      expect(answer.next_step).toContain('año fiscal');
    });
  });

  // ─── F-44: get_exogenous_status ────────────────────────────────────────
  describe('get_exogenous_status (F-44)', () => {
    it('(b) cabecera + completitud del año (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.exogenousService.findOne.mockResolvedValue({
        id: 1,
        fiscal_year: 2025,
        format_code: '1001',
        format_name: 'Retenciones practicadas',
        status: 'generated',
        line_count: 40,
        total_records: 40,
        total_amount: '1200000',
        submitted_at: null,
      });
      deps.exogenousService.validateYear.mockResolvedValue({
        fiscal_year: 2025,
        is_complete: false,
        error_count: 2,
        errors: ['tercero sin NIT', 'concepto sin tarifa'],
      });

      const answer = await run(tools, 'get_exogenous_status', { report_id: 1 });

      expect(answer).toEqual({
        report: {
          id: 1,
          fiscal_year: 2025,
          format_code: '1001',
          format_name: 'Retenciones practicadas',
          role: 'practiced',
          status: 'generated',
          line_count: 40,
          total_records: 40,
          total_amount: 1200000,
          submitted_at: null,
        },
        completeness: {
          is_complete: false,
          error_count: 2,
          errors: ['tercero sin NIT', 'concepto sin tarifa'],
        },
      });
      expect(deps.exogenousService.validateYear).toHaveBeenCalledWith(2025);
    });

    it('(a) sad: report_id inválido no toca el service', async () => {
      const { deps, tools } = buildTools();
      const answer = await run(tools, 'get_exogenous_status', {
        report_id: 0,
      });
      expect(answer.error).toContain('report_id inválido');
      expect(answer.next_step).toContain('F-43');
      expect(deps.exogenousService.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── F-45: generate_exogenous_report ───────────────────────────────────
  describe('generate_exogenous_report (F-45)', () => {
    function genDeps() {
      const { deps, tools } = buildTools();
      deps.exogenousService.validateYear.mockResolvedValue({
        fiscal_year: 2025,
        is_complete: true,
        error_count: 0,
        errors: [],
      });
      deps.exogenousService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, total_pages: 0 },
      });
      return { deps, tools };
    }

    it('(e) preview 1003 advierte crédito a favor', async () => {
      const { tools } = genDeps();
      const card = await preview(tools, 'generate_exogenous_report', {
        fiscal_year: 2025,
        format_code: '1003',
      });

      expect(card.status).toBe('ok');
      expect(card.target).toContain('1003');
      const role = card.changes.find(
        (change: any) => change.field === 'rol',
      )?.to;
      expect(role).toContain('suffered');
      expect(role).toContain('crédito a favor');
      expect(card.domain).toBe('withholding');
    });

    it('(b) handler genera y proyecta rol (snapshot)', async () => {
      const { deps, tools } = genDeps();
      deps.exogenousService.generateReport.mockResolvedValue({
        report: {
          id: 7,
          status: 'generated',
          total_records: 40,
          total_amount: '1200000',
        },
      });

      const answer = await run(tools, 'generate_exogenous_report', {
        fiscal_year: 2025,
        format_code: '1001',
      });

      expect(answer).toEqual({
        report_id: 7,
        fiscal_year: 2025,
        format_code: '1001',
        role: 'practiced',
        status: 'generated',
        total_records: 40,
        total_amount: 1200000,
      });
      expect(deps.exogenousService.generateReport).toHaveBeenCalledWith(
        expect.objectContaining({ fiscal_year: 2025, format_code: '1001' }),
      );
    });

    it('(c) formato fuera de 1001/1003 se rechaza sin generar', async () => {
      const { deps, tools } = genDeps();
      const card = await preview(tools, 'generate_exogenous_report', {
        fiscal_year: 2025,
        format_code: '1005',
      });
      expect(card.status).toBe('error');
      expect(card.message).toContain('1001');

      const answer = await run(tools, 'generate_exogenous_report', {
        fiscal_year: 2025,
        format_code: '1005',
      });
      expect(answer.error).toContain('1001 y 1003');
      expect(deps.exogenousService.generateReport).not.toHaveBeenCalled();
    });
  });

  // ─── F-46: submit_exogenous_report ─────────────────────────────────────
  describe('submit_exogenous_report (F-46)', () => {
    const GENERATED = {
      id: 7,
      fiscal_year: 2025,
      format_code: '1001',
      status: 'generated',
      line_count: 40,
    };

    it('(e) preview warning + handler marca submitted (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.exogenousService.findOne.mockResolvedValue(GENERATED);
      deps.exogenousService.markAsSubmitted.mockResolvedValue({
        id: 7,
        format_code: '1001',
        fiscal_year: 2025,
        status: 'submitted',
        submitted_at: '2026-09-29T00:00:00.000Z',
      });

      const card = await preview(tools, 'submit_exogenous_report', {
        report_id: 7,
      });
      expect(card.status).toBe('warning');
      expect(card.message).toContain('ante la DIAN');

      const answer = await run(tools, 'submit_exogenous_report', {
        report_id: 7,
      });
      expect(answer).toEqual({
        report_id: 7,
        format_code: '1001',
        fiscal_year: 2025,
        status: 'submitted',
        submitted_at: '2026-09-29T00:00:00.000Z',
      });
      expect(deps.exogenousService.markAsSubmitted).toHaveBeenCalledWith(7);
    });

    it('(c) solo procede desde generated', async () => {
      const submitted = buildTools();
      submitted.deps.exogenousService.findOne.mockResolvedValue({
        ...GENERATED,
        status: 'submitted',
      });
      const already = await run(submitted.tools, 'submit_exogenous_report', {
        report_id: 7,
      });
      expect(already.error).toContain("'submitted'");
      expect(
        submitted.deps.exogenousService.markAsSubmitted,
      ).not.toHaveBeenCalled();

      const generating = buildTools();
      generating.deps.exogenousService.findOne.mockResolvedValue({
        ...GENERATED,
        status: 'generating',
      });
      const card = await preview(generating.tools, 'submit_exogenous_report', {
        report_id: 7,
      });
      expect(card.status).toBe('error');
      expect(card.message).toContain('generando');
    });
  });

  // ─── F-47: list_tax_categories ─────────────────────────────────────────
  describe('list_tax_categories (F-47)', () => {
    it('(b) lista con tax_type y tarifas (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.findAll.mockResolvedValue({
        data: [
          {
            id: 1,
            name: 'IVA general 19%',
            description: null,
            tax_type: 'iva',
            status: 'active',
            tax_rates: [{ id: 1, name: 'IVA 19', rate: '0.19', is_compound: false }],
          },
          {
            id: 2,
            name: 'INC 8%',
            description: null,
            tax_type: 'inc',
            status: 'active',
            tax_rates: [{ id: 2, name: 'INC 8', rate: '0.08', is_compound: false }],
          },
        ],
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      });

      const answer = await run(tools, 'list_tax_categories', {});

      expect(answer.total).toBe(2);
      expect(answer.categories[1]).toEqual({
        id: 2,
        name: 'INC 8%',
        description: null,
        tax_type: 'inc',
        status: 'active',
        rates: [{ id: 2, name: 'INC 8', rate: 0.08, is_compound: false }],
      });
    });

    it('(c) servicio caído → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.findAll.mockRejectedValue(new Error('db'));

      const answer = await run(tools, 'list_tax_categories', {});
      expect(answer.error).toContain('No se pudieron leer las categorías');
    });
  });

  // ─── F-48: create_tax_category ─────────────────────────────────────────
  describe('create_tax_category (F-48)', () => {
    const ARGS = {
      name: 'IVA general 19%',
      type: 'percentage',
      rate: 19,
      tax_type: 'iva',
    };

    it('(e) preview con ruteo fiscal del tax_type', async () => {
      const { tools } = buildTools();
      const card = await preview(tools, 'create_tax_category', ARGS);

      expect(card.status).toBe('ok');
      expect(card.target).toBe('Categoría IVA general 19% (iva 19%)');
      const routing = card.changes.find(
        (change: any) => change.field === 'tipo_fiscal',
      )?.to;
      expect(routing).toContain('PUC 2408');
      expect(routing).toContain('DIAN 01');
      expect(card.domain).toBe('withholding');
    });

    it('(b) handler crea con el DTO validado (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.create.mockResolvedValue({
        id: 9,
        name: 'IVA general 19%',
        tax_type: 'iva',
        tax_rates: [{ id: 9, rate: '0.19' }],
      });

      const answer = await run(tools, 'create_tax_category', ARGS);

      expect(answer).toEqual({
        category_id: 9,
        name: 'IVA general 19%',
        tax_type: 'iva',
        rates: [{ id: 9, rate: 0.19 }],
      });
      expect(deps.taxesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ tax_type: 'iva', rate: 19 }),
        { id: null },
      );
    });

    it('(c) sin tax_type no hay propuesta: anti-?? iva', async () => {
      const { deps, tools } = buildTools();
      const { tax_type: _dropped, ...withoutType } = ARGS;

      const card = await preview(tools, 'create_tax_category', withoutType);
      expect(card.status).toBe('error');
      expect(card.message).toContain('tax_type es obligatorio');

      const answer = await run(tools, 'create_tax_category', withoutType);
      expect(answer.error).toContain('tax_type es obligatorio');
      expect(deps.taxesService.create).not.toHaveBeenCalled();
    });
  });

  // ─── F-49: update_tax_category ─────────────────────────────────────────
  describe('update_tax_category (F-49)', () => {
    const CURRENT = {
      id: 9,
      name: 'IVA general 19%',
      description: null,
      tax_type: 'iva',
    };

    it('(e) cambio de tax_type advierte re-ruteo', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.findOne.mockResolvedValue(CURRENT);

      const card = await preview(tools, 'update_tax_category', {
        category_id: 9,
        tax_type: 'inc',
      });

      expect(card.status).toBe('warning');
      expect(card.message).toContain('re-rutea');
      const change = card.changes.find(
        (entry: any) => entry.field === 'tax_type',
      );
      expect(change?.from).toBe('iva');
      expect(change?.to).toContain('PUC 2436');
    });

    it('(b) handler aplica el patch parcial (snapshot)', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.findOne.mockResolvedValue(CURRENT);
      deps.taxesService.update.mockResolvedValue({
        id: 9,
        name: 'IVA general 19%',
        tax_type: 'inc',
      });

      const answer = await run(tools, 'update_tax_category', {
        category_id: 9,
        tax_type: 'inc',
      });

      expect(answer).toEqual({
        category_id: 9,
        name: 'IVA general 19%',
        tax_type: 'inc',
      });
      expect(deps.taxesService.update).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ tax_type: 'inc' }),
        { id: null },
      );
    });

    it('(c) sin cambios y tax_type inválido no tocan el service', async () => {
      const { deps, tools } = buildTools();
      deps.taxesService.findOne.mockResolvedValue(CURRENT);

      const empty = await run(tools, 'update_tax_category', { category_id: 9 });
      expect(empty.error).toContain('Sin cambios');

      const badType = await run(tools, 'update_tax_category', {
        category_id: 9,
        tax_type: 'bitcoin',
      });
      expect(badType.error).toContain('tax_type inválido');
      expect(deps.taxesService.update).not.toHaveBeenCalled();
    });
  });
});
