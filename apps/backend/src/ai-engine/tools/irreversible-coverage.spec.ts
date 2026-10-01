import { AIToolRegistry } from './ai-tool-registry';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from './bridge/capability-registry.service';
import { createAccountingTools } from './domains/accounting.tools';
import { createCashRegisterTools } from './domains/cash-register.tools';
import { createFiscalTools } from './domains/fiscal.tools';
import { createInvoicingTools } from './domains/invoicing.tools';
import { createOrdersTools } from './domains/orders.tools';
import { createPaymentTools } from './domains/payments.tools';
import { createPayrollTools } from './domains/payroll.tools';
import { createReceivablesPayablesTools } from './domains/receivables-payables.tools';
import { createReturnTools } from './domains/returns.tools';
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
 * deliberado: solo las fábricas del Paso 1; otros dominios con nombres
 * irreversibles (`archive_product`, `cancel_subscription`, `delete_variant`)
 * son de sus pasos dueños, no de este.
 */
const IRREVERSIBLE_NAME_PATTERN =
  /send_.*dian|close_|void_|cancel_|refund|pay_|collect_|delete_|archive_/;

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
