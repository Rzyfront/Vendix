import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { AiuTaxableBasis } from './profiles/invoice-profile-config.contract';

/**
 * D.9 — LA MISMA PREGUNTA, DOS LECTORES, UNA SOLA RESPUESTA.
 *
 * `InvoiceCalculatorService.isAiuTaxable` e `InvoiceFlowService.isAiuComponentTaxable`
 * contestan «¿esta línea entra a la base gravable del IVA?» en dos momentos
 * distintos del ciclo de vida del documento —el primero al CAPTURAR, el
 * segundo al EMITIR— y hasta este cambio eran dos implementaciones escritas a
 * mano. D.4 corrigió sólo la del calculador para `component: 'contrato'` bajo
 * `taxable_basis: 'utilidad'`; la del flujo de emisión se quedó atrás
 * devolviendo `false` para el mismo caso. El resultado era un ciclo
 * irrompible: el calculador capturaba la línea como correctamente gravada
 * (`omit_tax_total: false`, con IVA persistido) y `assertAiuLineTaxCoherence`,
 * leyendo la respuesta equivocada de la otra función para el mismo hecho,
 * rechazaba la factura con `INVOICING_AIU_005` — sin que existiera ninguna
 * forma de corregir el documento, porque el defecto estaba en la LECTURA, no
 * en el dato persistido.
 *
 * Las 15 celdas (3 bases × 5 componentes) cubren TODO el dominio de la
 * pregunta. Antes de este cambio sólo UNA divergía
 * (`utilidad` × `'contrato'`); las otras 14 ya coincidían, y este spec las
 * deja en el registro para que una futura tercera implementación —si alguna
 * vez existe una— tenga con qué compararse sin tener que redescubrir el caso.
 */
describe('D.9 — isAiuTaxable (calculador) vs isAiuComponentTaxable (flujo de emisión)', () => {
  const calculator = new InvoiceCalculatorService();

  // Sin dependencias reales: ninguno de los dos métodos bajo prueba toca
  // Prisma, HTTP ni el vault — mismo patrón que
  // `invoice-flow.aiu-regime.spec.ts` para `resolveAiuRegimeForEmission`.
  const flow = new InvoiceFlowService(
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const callIsAiuTaxable = (component: string | null, basis: AiuTaxableBasis): boolean =>
    (calculator as any).isAiuTaxable(component, { taxable_basis: basis });

  const callIsAiuComponentTaxable = (
    component: string | null,
    basis: AiuTaxableBasis,
  ): boolean => {
    // El flujo de emisión no conoce `taxable_basis` directamente: lee el
    // régimen persistido (`invoices.aiu_regime`). 'aiu' ⇔ 'et_462_1',
    // 'utilidad' ⇔ 'decreto_1372_1992', 'subtotal' es el mismo valor en las
    // dos superficies.
    const regime =
      basis === 'aiu'
        ? 'et_462_1'
        : basis === 'utilidad'
          ? 'decreto_1372_1992'
          : 'subtotal';
    return (flow as any).isAiuComponentTaxable(component, regime);
  };

  const COMPONENTS: readonly (string | null)[] = [
    null,
    'administracion',
    'imprevistos',
    'utilidad',
    'contrato',
  ];
  const BASES: readonly AiuTaxableBasis[] = ['aiu', 'utilidad', 'subtotal'];

  /**
   * Tabla de verdad de las 15 celdas. La única que este ticket cambia es
   * `utilidad` × `'contrato'`: antes el flujo de emisión respondía `false`
   * ahí (el resto de la fila y de la tabla ya coincidía en ambos lados).
   */
  const EXPECTED: Record<AiuTaxableBasis, Record<string, boolean>> = {
    aiu: {
      null: false,
      administracion: true,
      imprevistos: true,
      utilidad: true,
      contrato: true,
    },
    utilidad: {
      null: false,
      administracion: false,
      imprevistos: false,
      utilidad: true,
      contrato: true, // ← antes: calculador true, flujo false (D.9)
    },
    subtotal: {
      null: true,
      administracion: true,
      imprevistos: true,
      utilidad: true,
      contrato: true,
    },
  };

  for (const basis of BASES) {
    for (const component of COMPONENTS) {
      const key = component ?? 'null';
      const expected = EXPECTED[basis][key];

      it(`${basis} × ${key} → ambos predicados responden ${expected}`, () => {
        const fromCalculator = callIsAiuTaxable(component, basis);
        const fromFlow = callIsAiuComponentTaxable(component, basis);

        expect(fromCalculator).toBe(expected);
        expect(fromFlow).toBe(expected);
        expect(fromFlow).toBe(fromCalculator);
      });
    }
  }

  /**
   * El escenario real que quedaba atascado: una línea `aiu_component:
   * 'contrato'` (Modelo 1) en un contrato de construcción
   * (`taxable_basis: 'utilidad'` / `regime: 'decreto_1372_1992'`) SÍ debe
   * emitir su grupo de impuesto — `omit_tax_total: false` — porque bajo esa
   * base la Utilidad (contenida en la línea completa) grava. Se verifica a
   * través de `attachAiuLineExtras`, el punto real donde el flujo de emisión
   * fija la bandera sobre la línea del XML, no sólo contra el predicado
   * aislado.
   */
  it('desatasca: una línea "contrato" bajo "utilidad" emite su TaxTotal (omit_tax_total: false)', () => {
    const lines = [{ omit_tax_total: undefined, note: undefined } as any];
    const rows = [{ aiu_component: 'contrato' }];

    (flow as any).attachAiuLineExtras(lines, rows, {
      regime: 'decreto_1372_1992',
      note: 'Administración: base gravable AIU',
      regime_source: 'snapshot',
      minimum_percent: null,
    });

    expect(lines[0].omit_tax_total).toBe(false);
  });
});
