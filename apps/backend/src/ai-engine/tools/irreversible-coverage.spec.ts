import { AIToolRegistry } from './ai-tool-registry';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from './bridge/capability-registry.service';
import { createAccountingTools } from './domains/accounting.tools';
import { createCashRegisterTools } from './domains/cash-register.tools';
import { createExpenseTools } from './domains/expenses.tools';
import { createFinanceOpsTools } from './domains/finance-ops.tools';
import { createFiscalTools } from './domains/fiscal.tools';
import { createInventoryTools } from './domains/inventory.tools';
import { createInvoicingTools } from './domains/invoicing.tools';
import { createOrdersTools } from './domains/orders.tools';
import { createPaymentTools } from './domains/payments.tools';
import { createPayrollTools } from './domains/payroll.tools';
import { createProductTools } from './domains/products.tools';
import { createPurchasingTools } from './domains/purchasing.tools';
import { createReceivablesPayablesTools } from './domains/receivables-payables.tools';
import { createReturnTools } from './domains/returns.tools';
import { createSubscriptionTools } from './domains/subscriptions.tools';
import { createVariantTools } from './domains/variants.tools';
import { createWithholdingTools } from './domains/withholding.tools';

/**
 * Paso 1 (remediación Vex) — cobertura de irreversibilidad.
 *
 * Toda tool tipada de escritura con efecto externo o contable que no se
 * deshace con otra escritura normal (envíos DIAN, pagos, cobros, reembolsos,
 * cierres de caja/periodo, anulaciones/cancelaciones, declaraciones,
 * deletes/archivados) declara `irreversible: true` explícito. Este spec
 * recorre las 10 fábricas del Paso 1 registradas en un registry real y falla
 * si un write cuyo nombre delata irreversibilidad no porta la marca.
 *
 * Solo barren writes (`requiresConfirmation`): los reads (`readOnly`) y las
 * herramientas de UI (`clientSide`) nunca llevan la marca aunque su nombre
 * la mencione (`preview_refund`, `list_close_sessions`). Alcance
 * deliberado: solo las fábricas del Paso 1; los dominios diferidos
 * (`archive_product`, `cancel_subscription`, `delete_variant`,
 * `pay_subscription_due`) tienen su propio bloque abajo (E2E remediación
 * Vex), con pines directos en vez de red por dominio.
 */
const IRREVERSIBLE_NAME_PATTERN =
  /send_.*dian|close_|void_|cancel_|refund|pay_|collect_|delete_|archive_|record_.*payment|depreciation/;

/**
 * Writes que el patrón nombra pero que evalúan sin ejecutar el efecto:
 * `run_close_checks` re-evalúa los checks de una sesión de cierre sin cerrar
 * nada (su descripción lo promete y el pin de abajo lo fija). Si algún día
 * cerrara, el pin obliga a revisar esta exclusión en vez de heredar silencio.
 */
const EVALUATOR_EXCLUSIONS = new Set(['run_close_checks']);

const STEP_1_DOMAINS = [
  'invoicing',
  'payments',
  'payroll',
  'fiscal',
  'returns',
  'orders',
  'accounting',
  'withholding',
  'cash-register',
  'receivables-payables',
];

function buildStep1Registry(): AIToolRegistry {
  // Las fábricas solo tocan `deps` dentro de handlers/previews, así que el
  // array de declaraciones se construye con deps vacías sin ejecutar nada.
  const deps = {} as any;
  const registry = new AIToolRegistry(deps);
  registry.registerMany(createAccountingTools(deps));
  registry.registerMany(createCashRegisterTools(deps));
  registry.registerMany(createFiscalTools(deps));
  registry.registerMany(createInvoicingTools(deps));
  registry.registerMany(createOrdersTools(deps));
  registry.registerMany(createPaymentTools(deps));
  registry.registerMany(createPayrollTools(deps));
  registry.registerMany(createReceivablesPayablesTools(deps));
  registry.registerMany(createReturnTools(deps));
  registry.registerMany(createWithholdingTools(deps));
  return registry;
}

describe('irreversible-coverage · Paso 1 remediación Vex', () => {
  it('todo write irreversible por nombre declara irreversible: true', () => {
    const violators = buildStep1Registry()
      .getAll()
      .filter(
        (t) =>
          t.requiresConfirmation === true &&
          t.readOnly !== true &&
          t.clientSide !== true,
      )
      .filter((t) => !EVALUATOR_EXCLUSIONS.has(t.name))
      .filter(
        (t) =>
          IRREVERSIBLE_NAME_PATTERN.test(t.name) ||
          IRREVERSIBLE_NAME_PATTERN.test(t.domain ?? ''),
      )
      .filter((t) => t.irreversible !== true)
      .map((t) => `${t.domain}/${t.name}`);
    expect(violators).toEqual([]);
  });

  it('close_cash_session porta la marca (ancla del test negativo)', () => {
    // Si se retira `irreversible` de close_cash_session, este caso y el
    // barrido de arriba fallan: verificado revirtiendo esa línea.
    expect(
      buildStep1Registry().get('close_cash_session')?.irreversible,
    ).toBe(true);
  });

  it('run_close_checks sigue excluido solo mientras prometa que no cierra', () => {
    const tool = buildStep1Registry().get('run_close_checks');
    expect(tool).toBeDefined();
    expect(tool?.requiresConfirmation).toBe(true);
    expect(tool?.irreversible).not.toBe(true);
    expect(tool?.description).toContain('No cierra nada');
  });

  it('cada dominio del Paso 1 aporta al menos un write irreversible', () => {
    const flagged = new Set(
      buildStep1Registry()
        .getAll()
        .filter((t) => t.irreversible === true)
        .map((t) => t.domain),
    );
    for (const domain of STEP_1_DOMAINS) {
      expect(flagged.has(domain)).toBe(true);
    }
  });

  it('todo write marcado cae también en la red de seguridad por dominio', () => {
    // Defensa en profundidad: la marca explícita y la lista compartida de
    // segmentos deben coincidir, para que un olvido del flag no abra hueco.
    const outside = buildStep1Registry()
      .getAll()
      .filter((t) => t.irreversible === true)
      .filter((t) => !IRREVERSIBLE_DOMAIN_SEGMENTS.has(t.domain))
      .map((t) => `${t.domain}/${t.name}`);
    expect(outside).toEqual([]);
  });
});

describe('irreversible-coverage · dominios diferidos (E2E remediación Vex)', () => {
  // El Paso 1 barrió solo sus 10 fábricas y dejó estos nombres a "sus pasos
  // dueños" — pero ningún paso del plan era dueño de products/subscriptions/
  // variants, así que `archive_product` (DELETE definitivo) llegaba al plan
  // como reversible y un clic lo ejecutaba sin confirmación propia.
  // Hallazgo live E2E-1 (2026-10-01): pines directos, sin red de seguridad
  // por dominio — `products` y `subscriptions` enteros NO son irreversibles
  // (create_product es reversible), así que la marca explícita es la única
  // defensa y este spec es su ancla.
  function buildDeferredRegistry(): AIToolRegistry {
    const deps = {} as any;
    const registry = new AIToolRegistry(deps);
    registry.registerMany(createProductTools(deps));
    registry.registerMany(createSubscriptionTools(deps));
    registry.registerMany(createVariantTools(deps));
    return registry;
  }

  it.each([
    ['archive_product', 'products'],
    ['delete_variant', 'products'],
    ['cancel_subscription', 'subscriptions'],
    ['pay_subscription_due', 'subscriptions'],
  ])('%s porta irreversible: true', (name) => {
    expect(buildDeferredRegistry().get(name)?.irreversible).toBe(true);
  });

  it('ningún write diferido con nombre irreversible queda sin marca', () => {
    const violators = buildDeferredRegistry()
      .getAll()
      .filter(
        (t) =>
          t.requiresConfirmation === true &&
          t.readOnly !== true &&
          t.clientSide !== true,
      )
      .filter(
        (t) =>
          IRREVERSIBLE_NAME_PATTERN.test(t.name) ||
          IRREVERSIBLE_NAME_PATTERN.test(t.domain ?? ''),
      )
      .filter((t) => t.irreversible !== true)
      .map((t) => `${t.domain}/${t.name}`);
    expect(violators).toEqual([]);
  });
});

describe('irreversible-coverage · REQUIRED_IRREVERSIBLE (R3-A)', () => {
  // Lista fijada: cada tool que mueve dinero, contabiliza o sella un estado
  // no reversible con otra escritura normal. Quitar la marca de cualquiera
  // rompe este spec; añadir una a la lista exige que exista en el registro.
  const REQUIRED_IRREVERSIBLE = [
    // Paso 1 y diferidos (ya marcadas)
    'close_cash_session',
    'archive_product',
    'delete_variant',
    'cancel_subscription',
    'pay_subscription_due',
    // R3-A
    'record_po_payment',
    'approve_receive_purchase_order',
    'run_depreciation',
    'approve_expense',
    'approve_stock_adjustment',
    'post_journal_entry',
    'promote_dian_to_production',
    'upload_dian_certificate',
    'create_invoice_from_order',
    'approve_payroll',
    'approve_settlement',
    'approve_declaration',
    'export_payroll_ach',
    'record_cash_movement',
  ];

  function buildFullRegistry(): AIToolRegistry {
    const deps = {} as any;
    const registry = new AIToolRegistry(deps);
    for (const factory of [
      createAccountingTools,
      createCashRegisterTools,
      createExpenseTools,
      createFinanceOpsTools,
      createFiscalTools,
      createInventoryTools,
      createInvoicingTools,
      createOrdersTools,
      createPaymentTools,
      createPayrollTools,
      createProductTools,
      createPurchasingTools,
      createReceivablesPayablesTools,
      createReturnTools,
      createSubscriptionTools,
      createVariantTools,
      createWithholdingTools,
    ]) {
      registry.registerMany(factory(deps));
    }
    return registry;
  }

  it.each(REQUIRED_IRREVERSIBLE)('%s existe y porta irreversible: true', (name) => {
    const tool = buildFullRegistry().get(name);
    expect(tool).toBeDefined();
    expect(tool?.irreversible).toBe(true);
  });

  it('run_close_checks sigue sin marca (exclusión fijada)', () => {
    expect(buildFullRegistry().get('run_close_checks')?.irreversible).not.toBe(
      true,
    );
  });

  it('ningún write con nombre irreversible queda sin marca en el registro ampliado', () => {
    const violators = buildFullRegistry()
      .getAll()
      .filter(
        (t) =>
          t.requiresConfirmation === true &&
          t.readOnly !== true &&
          t.clientSide !== true,
      )
      .filter((t) => !EVALUATOR_EXCLUSIONS.has(t.name))
      .filter(
        (t) =>
          IRREVERSIBLE_NAME_PATTERN.test(t.name) ||
          IRREVERSIBLE_NAME_PATTERN.test(t.domain ?? ''),
      )
      .filter((t) => t.irreversible !== true)
      .map((t) => `${t.domain}/${t.name}`);
    expect(violators).toEqual([]);
  });
});
