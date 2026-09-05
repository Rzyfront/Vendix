import { InvoicingService } from './invoicing.service';
import {
  InvoiceCalculatorAiuInput,
  InvoiceCalculatorService,
} from './services/invoice-calculator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * D.4 — `recalculateDocument` es el ÚNICO punto de la captura que puede
 * bloquear el documento (`invoicing.service.ts:3888`): el calculador
 * (`InvoiceCalculatorService.calculate`) es puro y sólo devuelve
 * `divergences`, nunca lanza. Esta suite prueba que el llamador SÍ traduce la
 * MEZCLA de modelos en el 422 `INVOICING_AIU_007`, y que lo hace ANTES de
 * llegar al piso legal (`INVOICING_AIU_001`) — el orden importa porque el piso
 * necesita un AIU ya bien formado, y un documento que mezcla los dos modelos no
 * lo tiene.
 *
 * ## Qué dejó de ser exclusivo
 *
 * La regla ya NO prohíbe varias líneas `'contrato'` en el mismo documento: un
 * contrato AIU factura varios servicios y consolidarlos en un renglón borraría
 * el detalle que el cliente firmó. Lo que sigue prohibido es MEZCLAR Modelo 1
 * (`'contrato'`, el AIU va DENTRO del importe de la línea) con Modelo 2
 * (líneas por componente, que lo SUMAN aparte) — combinarlos contaría el mismo
 * AIU dos veces.
 *
 * Por eso `recalculateDocument` deriva la mezcla de los `items` y ya no de la
 * divergencia `'aiu_contrato_mutually_exclusive'`: el calculador sigue
 * emitiéndola por el conteo >1 —donde ahora sólo se registra en el log— y corta
 * ahí sin llegar a evaluar la mezcla, así que leerla dejaría pasar justo el
 * documento que hay que frenar.
 *
 * Se instancia por prototipo, igual que
 * `invoicing.service.aiu-matrix.spec.ts`: `recalculateDocument` sólo toca
 * `this.calculator` (asignado a mano abajo), `this.logger` (idem) y
 * `this.applyTaxCatalogToLine` (que a su vez sólo toca `this.logger`, y no en
 * esta ruta — el catálogo pasa vacío, así que retorna temprano sin loguear
 * nada). Levantar el grafo de ~14 dependencias de `InvoicingService` para
 * ejercitar un `throw` que ocurre antes de cualquier lectura a Prisma mediría
 * el grafo, no la regla.
 */
describe('InvoicingService · exclusión mutua de «contrato» (INVOICING_AIU_007)', () => {
  const buildService = (): any => {
    const service = Object.create(InvoicingService.prototype) as any;
    service.calculator = new InvoiceCalculatorService();
    // El logger SÍ hace falta desde que varias líneas «contrato» dejaron de
    // bloquear: la divergencia del calculador sobrevive y `recalculateDocument`
    // la registra al final. Sin el doble, el caso que debe pasar moriría en un
    // `TypeError` sobre `this.logger`, que se lee como si la regla siguiera
    // rechazando.
    service.logger = { warn: jest.fn() };
    return service;
  };

  const aiu: InvoiceCalculatorAiuInput = {
    taxable_basis: 'aiu',
    components: {
      administracion: 6,
      imprevistos: 1,
      utilidad: 3,
    },
    components_basis: 'contract',
  };

  const item = (overrides: Record<string, unknown>) => ({
    description: 'Línea de prueba',
    quantity: 1,
    unit_price: 1_000_000,
    ...overrides,
  });

  it('dos líneas «contrato» en el mismo documento ya NO lanzan AIU_007', () => {
    const service = buildService();
    // El impuesto declarado NO es decorativo: sin él las dos líneas caerían en
    // `INVOICING_AIU_004` (componente que el régimen grava y llegó sin
    // impuesto) y el caso mediría ese rechazo en vez de la regla que aísla —
    // quedaría rojo por la razón equivocada el día que AIU_007 volviera.
    const items = [
      item({
        description: 'Aseo',
        aiu_component: 'contrato',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
      item({
        description: 'Vigilancia',
        aiu_component: 'contrato',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
    ];

    expect(() =>
      service.recalculateDocument(items, [], 'factura', aiu),
    ).not.toThrow();
  });

  it('«contrato» mezclada con una línea por componente ⇒ 422 INVOICING_AIU_007', () => {
    const service = buildService();
    const items = [
      item({ aiu_component: 'contrato' }),
      item({
        aiu_component: 'administracion',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
    ];

    let thrown: unknown;
    try {
      service.recalculateDocument(items, [], 'factura', aiu);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(VendixHttpException);
    expect((thrown as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_AIU_007.code,
    );
  });

  it('no confunde el conflicto con el piso legal: una sola «contrato» bien formada no lanza AIU_007', () => {
    const service = buildService();
    // AIU muy por encima del 10% del contrato y CON impuesto declarado: no debe
    // caer ni en AIU_001 (piso legal) ni en AIU_004 (componente gravable sin
    // impuesto) — ninguno de los dos es lo que esta prueba aísla — así que la
    // única forma de que quede en verde es que AIU_007 tampoco dispare.
    const items = [
      item({
        aiu_component: 'contrato',
        unit_price: 10_000_000,
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
    ];

    expect(() =>
      service.recalculateDocument(items, [], 'factura', aiu),
    ).not.toThrow();
  });

  it('tres líneas por componente (Modelo 2 puro, sin «contrato») no lanza AIU_007', () => {
    const service = buildService();
    const items = [
      item({
        aiu_component: 'administracion',
        unit_price: 6_000_000,
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
      item({
        aiu_component: 'imprevistos',
        unit_price: 1_000_000,
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
      item({
        aiu_component: 'utilidad',
        unit_price: 3_000_000,
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
    ];

    expect(() =>
      service.recalculateDocument(items, [], 'factura', aiu),
    ).not.toThrow();
  });
});
