/**
 * CP-PURCHASE-TRANSPARENCY — contrato de la vista previa de costeo tal como el
 * POP la CONSUME hoy.
 *
 * Vive aquí y no en `store/inventory/interfaces/inventory.interface.ts` a
 * propósito: aquel archivo lo comparten módulos que no participan de este flujo
 * y su forma quedó congelada antes de que la vista previa aprendiera a explicar
 * su propio número. Estas interfaces EXTIENDEN las de allí —no las
 * reemplazan—, así que un consumidor viejo sigue compilando y este módulo deja
 * de leer campos por `as any`.
 *
 * Regla de producto que gobierna el archivo: ninguna cifra que el operador
 * aprueba puede cambiar después sin que él la haya visto venir. Por eso el
 * contrato transporta la EXPLICACIÓN (qué se hace con el IVA, por qué, con qué
 * base legal) y el reparto del flete por línea, no sólo los totales.
 */

import {
  CostPreviewItem,
  CostPreviewResponse,
} from '../../interfaces/inventory.interface';

/**
 * De dónde salió la responsabilidad de IVA. Espejo de
 * `VatResponsibilitySource` (backend, `common/helpers/vat-responsibility.helper.ts`).
 */
export type PopFiscalSource =
  | 'tax_responsibilities'
  | 'tax_regime'
  | 'absent'
  | 'read_error';

/** Motivo estable. Espejo de `VatResponsibilityReason`. */
export type PopFiscalReason =
  | 'declared_responsible'
  | 'declared_not_responsible'
  | 'regime_responsible'
  | 'regime_not_responsible'
  | 'no_fiscal_signal'
  | 'fiscal_read_failed';

/** Qué hace el motor de costeo con el IVA pagado en la compra. */
export type PopFiscalTreatment = 'deductible' | 'capitalized';

/**
 * Explicación fiscal estructurada que el backend emite con la vista previa.
 *
 * El frontend NO vuelve a derivar el predicado: pinta lo que llega. Si la
 * pantalla dedujera por su cuenta, el paso de recepción y el de confirmación
 * podrían afirmar cosas opuestas sobre la misma compra.
 */
export interface PopFiscalExplanation {
  /** Proyección fail-closed: `false` también cuando el estado es indeterminado. */
  vat_responsible: boolean;
  /** `true` ⇒ el comercio no declaró nada o no se pudo leer su ficha fiscal. */
  indeterminate: boolean;
  reason: PopFiscalReason;
  source: PopFiscalSource;
  treatment: PopFiscalTreatment;
  /** Español llano, redactado por el backend y listo para pintar. */
  message: string;
  legal_basis: string[];
  /** Sólo cuando el estado es indeterminado: lleva al asistente fiscal. */
  cta?: { label: string; route: string };
}

/** Cómo se imputa el flete de la factura. */
export type PopShippingAllocation = 'prorate' | 'expense';

/**
 * Línea de la vista previa con el desglose que el backend ya emite y que la
 * interfaz compartida todavía no declara.
 */
export interface PopCostPreviewItem extends CostPreviewItem {
  /** IVA de la línea que se recupera vía declaración (0 si se capitaliza). */
  deductible_tax_amount?: number;
  /** IVA de la línea que engorda el costo (0 si es descontable). */
  capitalized_tax_amount?: number;
  /** Descuento comercial total ya aplicado a la línea. */
  discount_amount?: number;
  /** Parte del descuento GENERAL de la factura que le tocó a esta línea. */
  header_discount_share?: number;
  /** Flete asignado a la línea. 0 cuando el flete se lleva a gasto. */
  allocated_shipping_amount?: number;
  /** El mismo flete, por unidad — lo que sube el costo unitario. */
  shipping_per_unit?: number;
}

/**
 * Respuesta de la vista previa tal como el POP la necesita.
 *
 * `costing_method` se relaja a `| null` porque las filas de producto nuevo se
 * sintetizan en el cliente y no tienen método de costeo que declarar.
 */
export interface PopCostPreviewResponse
  extends Omit<CostPreviewResponse, 'items' | 'costing_method'> {
  costing_method: 'cpp' | 'fifo' | null;
  items: PopCostPreviewItem[];
  /** B.4 — la explicación fiscal estructurada. Ausente en respuestas viejas. */
  fiscal_explanation?: PopFiscalExplanation;
  /** Flete de la cabecera tal como el backend lo interpretó. */
  shipping_cost?: number;
  /** Lo que el cliente PIDIÓ hacer con el flete. */
  shipping_cost_allocation_requested?: PopShippingAllocation;
  /**
   * Lo que el backend PUDO hacer. Difiere del solicitado cuando `prorate`
   * degrada a `expense` por no haber base sobre la que repartir — y el
   * operador tiene que verlo, porque su elección no se honró.
   */
  shipping_cost_allocation_applied?: PopShippingAllocation;
}

/** Línea de la petición de vista previa (espejo de `CostPreviewItemDto`). */
export interface PopCostPreviewRequestItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_cost: number;
  discount_percentage?: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_type?: string;
  prices_include_tax?: boolean;
}

/**
 * Petición de vista previa con las OCHO entradas que la creación y la
 * recepción también reciben.
 *
 * Mandar menos era la causa medida de que la simulación y la orden partieran
 * de bases distintas: el operador aprobaba una cifra que el sistema no podía
 * reproducir después.
 */
export interface PopCostPreviewRequest {
  location_id: number;
  prices_include_tax?: boolean;
  discount_amount?: number;
  shipping_cost?: number;
  shipping_cost_allocation?: PopShippingAllocation;
  items: PopCostPreviewRequestItem[];
}
