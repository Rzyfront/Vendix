import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import * as factories from '../tools';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createCashRegisterTools } from '../tools/domains/cash-register.tools';
import { createReceivablesPayablesTools } from '../tools/domains/receivables-payables.tools';
import { createExpenseTools } from '../tools/domains/expenses.tools';
import { createAiToolboxTools } from '../tools/domains/ai-toolbox.tools';
import type { CatalogEntry } from '../tools/bridge/api-catalog.service';
import {
  parsePlaybookMarkdown,
  validatePlaybookCatalog,
} from './playbook-validator';
import { PlaybookDocument } from './playbook.interface';

const content = join(__dirname, 'content');
const names = [
  'facturar-venta',
  'cerrar-caja',
  'crear-producto-inventario',
  'compra-proveedor',
  'recibir-compra',
  'pagar-proveedor',
  'crear-cliente',
  'venta-cobro',
  'cobrar-cartera',
  'reponer-inventario',
  'trasladar-inventario',
  'devolucion-reembolso',
  'registrar-gasto',
  'ruta-despacho',
  'reserva-servicio',
  'mesa-cocina-cobro',
  'cambio-precios',
  'cierre-contable',
  'nomina-periodo',
  'reporte-ventas-margen',
].sort();
const release = (): PlaybookDocument[] =>
  readdirSync(content)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) =>
      parsePlaybookMarkdown(readFileSync(join(content, file), 'utf8'), file),
    );
const source = (id = 'reponer-inventario') =>
  readFileSync(join(content, `${id}.md`), 'utf8');
function editFrontmatter(
  edit: (metadata: Record<string, any>) => void,
  id = 'reponer-inventario',
): string {
  const text = source(id);
  const end = text.indexOf('\n---\n', 4);
  const frontmatter = JSON.parse(text.slice(4, end));
  edit(frontmatter);
  return `---\n${JSON.stringify(frontmatter)}\n---\n${text.slice(end + 5)}`;
}

// Only declarations from the real complete factory surface. No handler/preview or business service executes.
function realRegistry(): AIToolRegistry {
  const registry = new AIToolRegistry({} as any);
  const deps = { embeddingService: { isAvailable: () => true } } as any;
  for (const [name, factory] of Object.entries(factories)) {
    if (name.startsWith('create') && typeof factory === 'function')
      registry.registerMany((factory as Function)(deps));
  }
  for (const factory of [
    createCashRegisterTools,
    createReceivablesPayablesTools,
    createExpenseTools,
    createAiToolboxTools,
  ])
    registry.registerMany(factory(deps));
  return registry;
}

/** Fixture entries are pinned to ACTUAL controller declarations below, not invented bridge aliases. */
const endpoints: CatalogEntry[] = [
  [
    'store/cash-registers/sessions/:sessionId/movements',
    'GET',
    ['store:cash_registers:movements'],
  ],
  [
    'store/cash-registers/sessions/:id/cash-summary',
    'GET',
    ['store:cash_registers:read'],
  ],
  [
    'store/cash-registers/sessions/:id/pending-orders',
    'GET',
    ['store:cash_registers:read'],
  ],
  ['store/cash-registers/sessions/:id', 'GET', ['store:cash_registers:read']],
  ['store/stock-transfers/:id', 'GET', ['store:stock-transfers:read']],
  [
    'store/orders/return-orders/:id',
    'GET',
    ['store:orders:return_orders:read'],
  ],
  ['store/expenses', 'POST', ['store:expenses:create']],
].map(([path, method, requiredPermissions]) => ({
  path,
  method,
  requiredPermissions,
  area: 'store',
  domain: 'fixture',
  controller: 'source-pinned',
  handler: 'source-pinned',
})) as CatalogEntry[];
const catalog = () => ({ tools: realRegistry().getAll(), endpoints });

describe('release playbook contract against real factories (no business execution)', () => {
  it('publishes exactly the approved 20 processes, IDs, versions, happy/sad and pure verifiers', () => {
    const docs = release();
    expect(docs.map((d) => d.id).sort()).toEqual(names);
    const result = validatePlaybookCatalog(docs, catalog());
    expect(result.playbooks).toHaveLength(20);
    expect(
      result.playbooks.find((d) => d.id === 'crear-producto-inventario')
        ?.contract.mode,
    ).toBe('preparation_only');
    expect(
      result.playbooks.find((d) => d.id === 'mesa-cocina-cobro')?.contract.mode,
    ).toBe('preparation_only');
    expect(
      result.gaps.some(
        (gap) =>
          gap.code === 'WRITE_PREFLIGHT_MISSING' &&
          gap.playbook_id === 'crear-producto-inventario',
      ),
    ).toBe(true);
    for (const doc of result.playbooks) {
      expect(doc.metadata.verifier_ids).toEqual([`${doc.id}:v1`]);
      expect(doc.contract.examples.map((e) => e.kind).sort()).toEqual([
        'happy',
        'sad',
      ]);
      expect(doc.metadata.tool_contracts.every((t) => t.version === '1')).toBe(
        true,
      );
    }
  });

  it('pins every bridge reference to real controller paths and permissions', () => {
    const controllers = [
      'cash-registers/sessions/sessions.controller.ts',
      'orders/stock-transfers/stock-transfers.controller.ts',
      'orders/return-orders/return-orders.controller.ts',
      'expenses/expenses.controller.ts',
    ].map((path) =>
      readFileSync(resolve(__dirname, '../../domains/store', path), 'utf8'),
    );
    for (const endpoint of endpoints) {
      const declaration = controllers.find((text) => {
        const root = /@Controller\('([^']+)'\)/.exec(text)?.[1];
        return (
          !!root &&
          (endpoint.path === root || endpoint.path.startsWith(`${root}/`))
        );
      });
      expect(declaration).toBeDefined();
      const root = /@Controller\('([^']+)'\)/.exec(declaration!)![1];
      const suffix = endpoint.path.slice(root.length).replace(/^\//, '');
      expect(declaration).toContain(
        suffix
          ? `@${endpoint.method === 'GET' ? 'Get' : 'Post'}('${suffix}')`
          : `@${endpoint.method === 'GET' ? 'Get' : 'Post'}()`,
      );
      for (const permission of endpoint.requiredPermissions)
        expect(declaration).toContain(`@Permissions('${permission}')`);
    }
    const docs = release();
    expect(
      docs
        .flatMap((d) => d.contract.steps)
        .filter((s) => s.bridge)
        .every((s) =>
          endpoints.some(
            (e) => e.path === s.bridge!.path && e.method === s.bridge!.method,
          ),
        ),
    ).toBe(true);
  });

  it('has stable B catalogHash identities, invalidates changed section/metadata, supports exact rollback', () => {
    const first = parsePlaybookMarkdown(source(), 'reponer-inventario.md');
    expect(parsePlaybookMarkdown(source(), 'reponer-inventario.md').hash).toBe(
      first.hash,
    );
    expect(
      parsePlaybookMarkdown(
        source() + '\nCambio release.',
        'reponer-inventario.md',
      ).hash,
    ).not.toBe(first.hash);
    expect(
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.metadata.version = '1.0.1';
        }),
        'reponer-inventario.md',
      ).hash,
    ).not.toBe(first.hash);
    expect(parsePlaybookMarkdown(source(), 'reponer-inventario.md').hash).toBe(
      first.hash,
    );
  });

  it('requires explicit JSON YAML-subset frontmatter, names, schema version and complete sections', () => {
    expect(() => parsePlaybookMarkdown('# No frontmatter', 'bad.md')).toThrow(
      'PLAYBOOK_FRONTMATTER',
    );
    expect(() =>
      parsePlaybookMarkdown(
        '---\nname: not-our-supported-subset\n---\nbody',
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_FRONTMATTER_JSON');
    expect(() =>
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.name = 'x'.repeat(65);
        }),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_SCHEMA');
    expect(() =>
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.description = 'x'.repeat(1025);
        }),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_SCHEMA');
    expect(() =>
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.vendix_contract.schema_version = '2';
        }),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_SCHEMA');
    expect(() =>
      parsePlaybookMarkdown(
        source().replace('## recovery', '## recovery-missing'),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_SCHEMA');
  });

  it.each(['invented_tool', 'get_sourcing_suggestion_typo'])(
    'rejects nonexistent canonical tool %s',
    (name) => {
      const doc = release().find((d) => d.id === 'reponer-inventario')!;
      doc.metadata.tool_contracts.push({ name, version: '1' });
      expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
        'PLAYBOOK_TOOL_MISSING',
      );
    },
  );
  it('rejects prose-only references to an invented tool instead of silently indexing it', () => {
    const doc = parsePlaybookMarkdown(
      source() + '\nUsa `create_fake_supplier`.\n',
      'bad.md',
    );
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_TOOL_MISSING',
    );
  });
  it('rejects an incompatible tool version and a missing executable verifier', () => {
    const doc = release()[0];
    doc.metadata.tool_contracts[0].version = '999';
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_TOOL_VERSION',
    );
    const valid = release()[0];
    valid.metadata.verifier_ids = ['missing:v1'];
    expect(() => validatePlaybookCatalog([valid], catalog())).toThrow(
      'PLAYBOOK_VERIFIER_MISSING',
    );
  });
  it('rejects insufficient tool AND bridge permission declarations (all, never OR)', () => {
    const doc = release().find((d) => d.id === 'crear-cliente')!;
    doc.metadata.required_permissions =
      doc.metadata.required_permissions.filter(
        (p) => p !== 'store:customers:update',
      );
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_PERMISSION',
    );
    const cash = release().find((d) => d.id === 'cerrar-caja')!;
    cash.metadata.required_permissions =
      cash.metadata.required_permissions.filter(
        (p) => p !== 'store:cash_registers:movements',
      );
    expect(() => validatePlaybookCatalog([cash], catalog())).toThrow(
      'PLAYBOOK_PERMISSION',
    );
  });
  it('rejects missing/deformed bridge routes and wrong verbs', () => {
    const doc = release().find((d) => d.id === 'cerrar-caja')!;
    const step = doc.contract.steps.find((s) => s.bridge)!;
    step.bridge!.path = 'store/cash-sessions/:id';
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_ENDPOINT_MISSING',
    );
    step.bridge = undefined;
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_ENDPOINT_REQUIRED',
    );
  });
  it('rejects missing dependencies, duplicate steps and cycles, including self-cycles', () => {
    const broken = release()[0];
    broken.contract.steps[0].depends_on = ['does-not-exist'];
    expect(() => validatePlaybookCatalog([broken], catalog())).toThrow(
      'PLAYBOOK_DEPENDENCY',
    );
    const cyclic = release()[0];
    cyclic.contract.steps[0].depends_on = [cyclic.contract.steps.at(-1)!.id];
    expect(() => validatePlaybookCatalog([cyclic], catalog())).toThrow(
      'PLAYBOOK_CYCLE',
    );
    const self = release()[0];
    self.contract.steps[0].depends_on = [self.contract.steps[0].id];
    expect(() => validatePlaybookCatalog([self], catalog())).toThrow(
      'PLAYBOOK_CYCLE',
    );
    const duplicate = release()[0];
    duplicate.contract.steps.push(duplicate.contract.steps[0]);
    expect(() => validatePlaybookCatalog([duplicate], catalog())).toThrow(
      'PLAYBOOK_DEPENDENCY',
    );
  });
  it('never treats a missing preview as executable: emits an explicit preparation gap', () => {
    const doc = release().find((d) => d.id === 'facturar-venta')!;
    const dependencies = catalog();
    dependencies.tools.find((t) => t.name === 'validate_invoice')!.preview =
      undefined;
    const result = validatePlaybookCatalog([doc], dependencies);
    expect(result.playbooks[0].contract.mode).toBe('preparation_only');
    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        code: 'WRITE_PREFLIGHT_MISSING',
        step_id: 'validate',
      }),
    );
  });
  it('requires individual approval for every mutation and rejects client-side authority', () => {
    const doc = release().find((d) => d.id === 'facturar-venta')!;
    doc.contract.steps.find((s) => s.id === 'emit')!.approval = 'none';
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_APPROVAL',
    );
    const dep = catalog();
    dep.tools.find((t) => t.name === 'get_order')!.clientSide = true;
    expect(() =>
      validatePlaybookCatalog(
        [release().find((d) => d.id === 'facturar-venta')!],
        dep,
      ),
    ).toThrow('PLAYBOOK_TOOL_CLIENT_SIDE');
  });
  it.each([900001, '900001', 'a1b2c3d4-1122-3344-5566-aabbccddeeff'])(
    'rejects fixed business IDs %s in executable arguments',
    (id) => {
      expect(() =>
        parsePlaybookMarkdown(
          editFrontmatter((f) => {
            f.vendix_contract.steps[1].arguments.product_id = id;
          }),
          'bad.md',
        ),
      ).toThrow('PLAYBOOK_FIXED_ID');
    },
  );
  it.each([
    'store_id',
    'organization_id',
    'user_id',
    'authorization',
    'password',
    'confirmationToken',
  ])('rejects scope/secret %s from a release argument', (key) => {
    expect(() =>
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.vendix_contract.steps[0].arguments = {
            [key]: '${inputs.untrusted}',
          };
        }),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_UNSAFE_CONTENT');
  });
  it('rejects omitted happy/sad examples and unsafe document size', () => {
    expect(() =>
      parsePlaybookMarkdown(
        editFrontmatter((f) => {
          f.vendix_contract.examples.pop();
        }),
        'bad.md',
      ),
    ).toThrow('PLAYBOOK_SCHEMA');
    expect(() => parsePlaybookMarkdown('x'.repeat(150001), 'bad.md')).toThrow(
      'PLAYBOOK_SCHEMA',
    );
  });
  it('validates real tool DTO arguments, including required keys, enums and symbolic bindings', () => {
    const doc = release().find((d) => d.id === 'venta-cobro')!;
    const pay = doc.contract.steps.find((s) => s.id === 'pay')!;
    pay.arguments!.payment_method = 'cash';
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_TOOL_ARGUMENT',
    );
    delete pay.arguments!.payment_method;
    delete pay.arguments!.store_payment_method_id;
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_TOOL_ARGUMENT',
    );
    const sourcing = release().find((d) => d.id === 'reponer-inventario')!;
    sourcing.contract.steps[1].arguments!.product_id =
      '${inputs.never_declared}';
    expect(() => validatePlaybookCatalog([sourcing], catalog())).toThrow(
      'PLAYBOOK_SYMBOL',
    );
    const malformed = release().find((d) => d.id === 'reponer-inventario')!;
    malformed.contract.steps[1].arguments!.product_id = '${context.store_id}';
    expect(() => validatePlaybookCatalog([malformed], catalog())).toThrow(
      'PLAYBOOK_SYMBOL',
    );
    const expense = release().find((d) => d.id === 'registrar-gasto')!;
    expense.contract.steps[0].arguments!.document_kind = 'expense';
    expect(() => validatePlaybookCatalog([expense], catalog())).toThrow(
      'PLAYBOOK_TOOL_ARGUMENT',
    );
  });
  it('binds symbolic bridge arguments to the published route instead of trusting metadata alone', () => {
    const doc = release().find((d) => d.id === 'cerrar-caja')!;
    const step = doc.contract.steps.find((s) => s.bridge)!;
    step.arguments!.path = 'store/cash-registers/sessions/900020/movements';
    expect(() => validatePlaybookCatalog([doc], catalog())).toThrow(
      'PLAYBOOK_ENDPOINT_PATH',
    );
  });
});
