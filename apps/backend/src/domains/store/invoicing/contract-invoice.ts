import { ErrorCodes, VendixHttpException } from 'src/common/errors';

/**
 * D.1 (ADR-03, DB-05) — precarga pura contrato→factura AIU.
 *
 * Convierte el snapshot CONGELADO del contrato (C.1: totales + items de la
 * cotizacion + porcentajes A/I/U del perfil) en las lineas del borrador de
 * factura AIU. Es puro a proposito: lo que se congela aca es lo que la
 * matriz `aiu_taxable_matrix` va a declarar, asi que se prueba sin base de
 * datos campo a campo contra el snapshot.
 *
 * ## Forma del documento (Modelo 2 / `sumada`)
 *
 * Tres lineas por componente (Administracion, Imprevistos, Utilidad), cada
 * una por `subtotal × porcentaje / 100`. Solo porciones POSITIVAS: un
 * porcentaje ausente o en cero no genera renglon de $0.00.
 *
 * Por que NO se espejan los items cotizados como lineas de costo: el total
 * de la cotizacion nunca incluyo el AIU (los porcentajes son recargo sobre
 * el costo directo, ver `quotation-profile-config.ts`), asi que nadie puede
 * decir desde el snapshot si el subtotal ya trae el margen o no. Facturar
 * costo + AIU contaria el margen dos veces cuando el cotizador lo bundleo,
 * y ademas el piso legal se mide contra TODAS las lineas: con costo
 * incluido, un AIU legitimo del 10 % del costo queda en ~9 % del documento
 * y la creacion muere en `INVOICING_AIU_001`. Solo-AIU siempre cumple el
 * piso (el AIU es el 100 % de sus propias lineas) y "emitir sin editar pasa
 * validacion de piso" es criterio de aceptacion. El borrador nace editable:
 * el operador agrega la linea de costo si su regimen la factura.
 *
 * ## Tarifa (regla de herencia, sin inventar)
 *
 * El calculador jamas impone una tarifa no declarada, asi que cada linea
 * gravable tiene que traer la suya. La unica senal congelada disponible es
 * el `tax_rate` de los items cotizados: se usa la MODA (empate: la mayor,
 * conservadora — declara mas IVA, que se recupera, en vez de menos, que se
 * sanciona) como IVA de las tres lineas, igual que el panel pone IVA en
 * todas por defecto y el motor le quita el impuesto a las que el regimen no
 * grava (`aiu_untaxable_line_declares_tax`, no bloqueante). Sin senal en el
 * snapshot se falla en voz alta ANTES de numerar: declarar 19 % o 0 %
 * "por defecto" fabricaria dato fiscal (exento no es lo mismo que
 * sin-dato). El borrador es editable y la matriz muestra la tarifa usada.
 *
 * ## Sin A/I/U no hay precarga (falla, no degrada)
 *
 * Contrato sin perfil o con porcentajes en cero ⇒ 422 antes de numerar. Las
 * alternativas silenciosas son peores: lineas de costo solas mueren en el
 * piso de todas formas, y crear con `enforce_minimum_base: false` seria el
 * SISTEMA optando por no aplicar el piso sin que el operador lo sepa (la
 * columna `aiu_minimum_percent` quedaria NULL y la emision saltaria el piso
 * por `minimum_percent === null`). La via manual (`create()`) sigue abierta
 * para esos contratos; FB-08 (DTO `none`) no recibe A/I/U del operador por
 * decision del plan, asi que E.1 podra extenderlo.
 */

export interface ContractAiuSnapshotItem {
  tax_rate?: string | number | null;
}

export interface ContractAiuSnapshot {
  quotation: {
    subtotal_amount: string | number;
    notes: string | null | undefined;
    items: ContractAiuSnapshotItem[];
  };
  profile:
    | {
        config?:
          | {
              admin_percent?: number | null;
              contingency_percent?: number | null;
              profit_percent?: number | null;
            }
          | null;
      }
    | null;
}

export type ContractAiuComponentKey =
  | 'administracion'
  | 'imprevistos'
  | 'utilidad';

export interface ContractAiuDraftLine {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  aiu_component: ContractAiuComponentKey;
  taxes: Array<{
    tax_name: string;
    tax_rate: number;
    tax_type: string;
  }>;
}

export interface ContractAiuDraft {
  /** Lineas Modelo 2 listas para `recalculateDocument`. */
  lines: ContractAiuDraftLine[];
  /**
   * Objeto del contrato en CRUDO (notas de la cotizacion o null): la
   * precedencia contra el default de la tienda y la validacion CAV03 las
   * aplica `resolveAiuContext`, un solo sitio.
   */
  contract_object: string | null;
  /** Costo directo del snapshot sobre el que se aplicaron los porcentajes. */
  base_amount: number;
  /** Tarifa heredada (porcentaje, ej. 19) aplicada a las tres lineas. */
  rate_percent: number;
  /** Porciones resultantes por componente, en pesos. */
  portions: Record<ContractAiuComponentKey, number>;
}

const COMPONENT_DEFS: ReadonlyArray<{
  key: ContractAiuComponentKey;
  label: string;
  percent_of: (
    config: NonNullable<
      NonNullable<ContractAiuSnapshot['profile']>['config']
    >,
  ) => unknown;
}> = [
  {
    key: 'administracion',
    label: 'Administración',
    percent_of: (config) => config.admin_percent,
  },
  {
    key: 'imprevistos',
    label: 'Imprevistos',
    percent_of: (config) => config.contingency_percent,
  },
  {
    key: 'utilidad',
    label: 'Utilidad',
    percent_of: (config) => config.profit_percent,
  },
];

/** Misma `round2` que `createFromOrder`: centavos exactos, sin polvo float. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tarifa de la operacion segun el snapshot: MODA de los `tax_rate`
 * definidos en los items (fraccion → porcentaje), empate hacia la mayor.
 * `null` cuando el snapshot no trae ninguna senal.
 */
export function resolveContractAiuRatePercent(
  snapshot: ContractAiuSnapshot,
): number | null {
  const counts = new Map<number, number>();
  for (const item of snapshot.quotation.items ?? []) {
    if (item?.tax_rate === null || item?.tax_rate === undefined) continue;
    const fraction = Number(item.tax_rate);
    if (!Number.isFinite(fraction) || fraction < 0) continue;
    const percent = round2(fraction * 100);
    counts.set(percent, (counts.get(percent) ?? 0) + 1);
  }
  let best: number | null = null;
  let best_count = 0;
  for (const [percent, count] of counts) {
    if (
      count > best_count ||
      (count === best_count && (best === null || percent > best))
    ) {
      best = percent;
      best_count = count;
    }
  }
  return best;
}

export function buildContractAiuDraft(
  snapshot: ContractAiuSnapshot,
  contract_number: string,
  contract_id: number,
): ContractAiuDraft {
  const base = Number(snapshot.quotation.subtotal_amount);
  const config = snapshot.profile?.config ?? null;

  const portions = {} as Record<ContractAiuComponentKey, number>;
  for (const def of COMPONENT_DEFS) {
    const raw = config ? def.percent_of(config) : undefined;
    const percent =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
    portions[def.key] =
      percent > 0 && Number.isFinite(base) && base > 0
        ? round2((base * percent) / 100)
        : 0;
  }

  const positive = (Object.keys(portions) as ContractAiuComponentKey[]).filter(
    (key) => portions[key] > 0,
  );
  if (positive.length === 0) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_001,
      'El contrato no define Administración, Imprevistos ni Utilidad (sin ' +
        'perfil de cotización o con porcentajes en cero), así que no hay AIU ' +
        'que precargar en la factura. Crea el contrato desde una cotización ' +
        'con perfil A/I/U, o captura la factura AIU manualmente.',
      { contract_id, contract_number },
    );
  }

  const rate_percent = resolveContractAiuRatePercent(snapshot);
  if (rate_percent === null) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_001,
      'La cotización del contrato no declara tarifas por línea y la factura ' +
        'AIU no puede inventar la del impuesto: declara las tarifas en la ' +
        'cotización, o captura la factura AIU manualmente con su tarifa.',
      { contract_id, contract_number },
    );
  }

  const notes = (snapshot.quotation.notes ?? '').trim();
  const lines: ContractAiuDraftLine[] = [];
  for (const def of COMPONENT_DEFS) {
    if (portions[def.key] <= 0) continue;
    lines.push({
      description: `${def.label} AIU - ${contract_number}`,
      quantity: 1,
      unit_price: portions[def.key],
      discount_amount: 0,
      aiu_component: def.key,
      taxes: [{ tax_name: 'IVA', tax_rate: rate_percent, tax_type: 'iva' }],
    });
  }

  return {
    lines,
    contract_object: notes.length > 0 ? notes : null,
    base_amount: Number.isFinite(base) ? base : 0,
    rate_percent,
    portions,
  };
}
