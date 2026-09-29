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
      },
      withholdingFlowService: {
        resolveSufferedByOperation: jest.fn(),
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

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 2 reads P0 de retenciones', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'preview_withholding',
        'list_withholding_calculations',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('withholding');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada read exige withholding:read (mismo verbo que el controlador)', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['withholding:read']);
      }
    });

    it('las 2 son reads puras sin circuito de escritura', () => {
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
});
