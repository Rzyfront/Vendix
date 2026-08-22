import { Injectable } from '@nestjs/common';
import { VendixHttpException } from '../errors/vendix-http.exception';
import { ErrorCodes } from '../errors/error-codes';

/**
 * F4 — Ciclo de vida legal del IVA colombiano.
 *
 * Fuente ÚNICA de verdad (backend) para responder si un comercio es
 * "responsable de IVA" ante la DIAN. Reutiliza el patrón ya existente en
 * `PurchaseOrdersService.isVatResponsible` y `FiscalObligationService`
 * (constante O-48), consolidándolo en un helper puro reutilizable por los
 * puntos de escritura (productos, ventas POS, checkout ecommerce).
 *
 * La definición canónica se deriva de `fiscal_data`:
 *   - `tax_responsibilities` (RUT casilla 53) incluye 'O-48'  ⇒ responsable (true)
 *   - incluye 'O-49' SIN 'O-48'                               ⇒ NO responsable (false)
 *   - fallback por `tax_regime`:
 *       · COMUN / GRAN_CONTRIBUYENTE                          ⇒ responsable (true)
 *       · SIMPLIFICADO                                        ⇒ NO responsable (false)
 *   - indeterminado (sin señales)                             ⇒ NO responsable (false)
 *
 * Cambio de default (2026-08-21): la rama indeterminada pasó de `true` a
 * `false`. Razón: el 100% de los tenants arrancan con el módulo fiscal
 * apagado y sin responsabilidad declarada; tratarlos como responsables
 * equivalía a permitir cobro de IVA sin estar facultados para facturar
 * electrónicamente. Fail-closed. Para vender con IVA, el tenant debe
 * declarar `tax_responsibilities: ['O-48']` o pasar por el wizard fiscal.
 *
 * CP-PURCHASE-TRANSPARENCY B.0 — dos estados no alcanzan. `boolean` no
 * distingue "declaró que NO es responsable" de "no sabemos si lo es", y esa
 * diferencia es justo la que una pantalla de compras tiene que explicarle al
 * usuario antes de capitalizar el IVA de una factura. Para eso existe
 * `resolveVatResponsibility`, que devuelve motivo y fuente además del
 * booleano. `isVatResponsible` se mantiene como proyección de ese resultado
 * — una sola implementación, para que las dos respuestas no puedan divergir.
 */

/** RUT casilla 53 — 'O-48' Responsable de IVA. */
export const VAT_RESPONSIBLE_CODE = 'O-48';
/** RUT casilla 53 — 'O-49' No responsable de IVA. */
export const VAT_NOT_RESPONSIBLE_CODE = 'O-49';

/** Contexto de la operación bloqueada, viaja en `details.context` del error. */
export type VatChargeContext = 'product' | 'sale';

/** Forma mínima de `fiscal_data` que consume la resolución de responsabilidad. */
export interface VatFiscalDataInput {
  tax_responsibilities?: unknown;
  tax_regime?: unknown;
}

/**
 * De dónde salió la decisión. `absent` y `read_error` son las dos formas de
 * quedar indeterminado, y NO son intercambiables: la primera es un tenant que
 * todavía no hizo el trámite fiscal (se resuelve en el wizard), la segunda es
 * una falla transitoria de infraestructura (se resuelve reintentando).
 */
export type VatResponsibilitySource =
  | 'tax_responsibilities'
  | 'tax_regime'
  | 'absent'
  | 'read_error';

/** Motivo estable, apto para logs, tests y para mapear copy en el frontend. */
export type VatResponsibilityReason =
  | 'declared_responsible'
  | 'declared_not_responsible'
  | 'regime_responsible'
  | 'regime_not_responsible'
  | 'no_fiscal_signal'
  | 'fiscal_read_failed';

/**
 * Resultado de tres estados: responsable, no responsable, e indeterminado.
 *
 * `responsible` conserva la semántica fail-closed (indeterminado ⇒ `false`),
 * de modo que un consumidor que sólo lea ese campo se comporta exactamente
 * igual que antes. `indeterminate` es lo que permite al consumidor decir
 * "no lo sabemos" en vez de afirmar "no es responsable".
 */
export interface VatResponsibilityResult {
  /** Fail-closed: `false` también cuando el estado es indeterminado. */
  responsible: boolean;
  /** `true` cuando NO hubo ninguna señal fiscal concluyente. */
  indeterminate: boolean;
  reason: VatResponsibilityReason;
  source: VatResponsibilitySource;
  /** Explicación en español, lista para mostrarse al usuario. */
  message: string;
}

const RESULT_MESSAGES: Record<VatResponsibilityReason, string> = {
  declared_responsible:
    'El comercio declaró la responsabilidad O-48 (responsable de IVA).',
  declared_not_responsible:
    'El comercio declaró la responsabilidad O-49 (no responsable de IVA).',
  regime_responsible:
    'El régimen tributario declarado (COMÚN / GRAN CONTRIBUYENTE) implica responsabilidad de IVA.',
  regime_not_responsible:
    'El régimen tributario declarado (SIMPLIFICADO) no es responsable de IVA.',
  no_fiscal_signal:
    'El comercio no declaró responsabilidades ni régimen tributario. Se asume NO responsable de IVA y el impuesto se capitaliza al costo.',
  fiscal_read_failed:
    'No se pudo leer la configuración fiscal del comercio. Se asume NO responsable de IVA y el impuesto se capitaliza al costo.',
};

function buildResult(
  responsible: boolean,
  indeterminate: boolean,
  reason: VatResponsibilityReason,
  source: VatResponsibilitySource,
): VatResponsibilityResult {
  return {
    responsible,
    indeterminate,
    reason,
    source,
    message: RESULT_MESSAGES[reason],
  };
}

/**
 * Resuelve la responsabilidad de IVA distinguiendo TRES estados a partir de
 * `fiscal_data`. Es la implementación canónica; `isVatResponsible` proyecta
 * su campo `responsible`.
 *
 * | fiscal_data                                | responsible | indeterminate |
 * | ------------------------------------------ | ----------- | ------------- |
 * | `tax_responsibilities` incluye 'O-48'       | true        | false         |
 * | incluye 'O-49' sin 'O-48'                   | false       | false         |
 * | `tax_regime` COMUN / GRAN_CONTRIBUYENTE     | true        | false         |
 * | `tax_regime` SIMPLIFICADO                   | false       | false         |
 * | sin ninguna señal (null, {}, vacío, basura) | false       | **true**      |
 *
 * Nunca lanza. Para el caso "no se pudo LEER `fiscal_data`" —que es distinto
 * de "`fiscal_data` no dice nada"— usa `vatResponsibilityReadFailure()`.
 */
export function resolveVatResponsibility(
  fiscalData: VatFiscalDataInput | null | undefined,
): VatResponsibilityResult {
  const responsibilities = Array.isArray(fiscalData?.tax_responsibilities)
    ? (fiscalData!.tax_responsibilities as unknown[]).filter(
        (code): code is string => typeof code === 'string',
      )
    : [];

  // 1) Señal explícita por responsabilidades DIAN (RUT casilla 53).
  if (responsibilities.includes(VAT_RESPONSIBLE_CODE)) {
    return buildResult(true, false, 'declared_responsible', 'tax_responsibilities');
  }
  if (responsibilities.includes(VAT_NOT_RESPONSIBLE_CODE)) {
    return buildResult(
      false,
      false,
      'declared_not_responsible',
      'tax_responsibilities',
    );
  }

  // 2) Fallback por régimen tributario.
  const regime =
    typeof fiscalData?.tax_regime === 'string'
      ? fiscalData.tax_regime
      : undefined;
  if (regime === 'COMUN' || regime === 'GRAN_CONTRIBUYENTE') {
    return buildResult(true, false, 'regime_responsible', 'tax_regime');
  }
  if (regime === 'SIMPLIFICADO') {
    return buildResult(false, false, 'regime_not_responsible', 'tax_regime');
  }

  // 3) Indeterminado ⇒ NO responsable (fail-closed, 2026-08-21).
  return buildResult(false, true, 'no_fiscal_signal', 'absent');
}

/**
 * Resultado para el caso en que la LECTURA de `fiscal_data` falló (timeout,
 * error de settings, tenant sin contexto). Indeterminado y fail-closed, igual
 * que la ausencia de datos, pero con `source: 'read_error'` para que el
 * consumidor pueda ofrecer "reintentar" en vez de mandar al wizard fiscal.
 *
 * Existe aquí, y no inline en cada `catch`, porque los dos consumidores del
 * flujo de compras (PurchaseOrdersService e InvoiceScannerService) tienen que
 * contar la MISMA historia sobre la misma factura.
 */
export function vatResponsibilityReadFailure(): VatResponsibilityResult {
  return buildResult(false, true, 'fiscal_read_failed', 'read_error');
}

/**
 * Resuelve si el comercio es responsable de IVA a partir de su `fiscal_data`.
 * Proyección booleana de `resolveVatResponsibility`: colapsa "no responsable"
 * e "indeterminado" en `false` (fail-closed). Ver el bloque de documentación
 * del archivo para la definición canónica.
 */
export function isVatResponsible(
  fiscalData: VatFiscalDataInput | null | undefined,
): boolean {
  return resolveVatResponsibility(fiscalData).responsible;
}

/**
 * Predicado de bloqueo POSITIVO: `true` cuando el comercio es
 * explícitamente NO responsable de IVA o su estado fiscal es
 * indeterminado (fail-closed desde 2026-08-21). Sólo devuelve `false`
 * cuando hay una declaración de responsabilidad POSITIVA (O-48) o un
 * régimen que la implica (COMUN / GRAN_CONTRIBUYENTE).
 */
export function isExplicitlyNotVatResponsible(
  fiscalData: VatFiscalDataInput | null | undefined,
): boolean {
  return !isVatResponsible(fiscalData);
}

/**
 * Enforcement de escritura: lanza `FISCAL_VAT_NOT_RESPONSIBLE_001` (HTTP 412)
 * cuando el comercio NO es responsable de IVA, incluyendo el estado
 * indeterminado (fail-closed desde 2026-08-21). No-op sólo cuando hay
 * una declaración de responsabilidad POSITIVA (O-48 o régimen que la
 * implica). El `context` indica el origen ('product' | 'sale') y el CTA
 * apunta al wizard de activación fiscal.
 */
export function assertCanChargeVat(
  fiscalData: VatFiscalDataInput | null | undefined,
  context: VatChargeContext,
): void {
  const outcome = resolveVatResponsibility(fiscalData);
  if (outcome.responsible) return;
  throw new VendixHttpException(
    ErrorCodes.FISCAL_VAT_NOT_RESPONSIBLE_001,
    undefined,
    {
      context,
      cta: '/admin/fiscal/wizard',
      reason: outcome.reason,
    },
  );
}

/**
 * Servicio DI que delega a los helpers puros de este archivo.
 *
 * P0.1 — permite convergir las tres réplicas internas de backend
 * (PurchaseOrdersService, InvoiceScannerService, FiscalObligationService)
 * en una sola implementación. Las réplicas pre-existían como métodos
 * privados o constantes locales; este servicio expone la misma respuesta
 * canónica que el helper. Default fail-closed (2026-08-21): devuelve
 * `false` cuando no hay datos fiscales — para vender con IVA el tenant
 * debe declarar `tax_responsibilities: ['O-48']` o pasar por el wizard
 * fiscal.
 */
@Injectable()
export class VatResponsibilityService {
  /**
   * Resuelve si el comercio es responsable de IVA. Equivalente 1:1 a
   * `isVatResponsible(fiscalData)`; la inyección DI reemplaza a las
   * réplicas internas de PO / Scanner / fiscal-obligation. Pura, síncrona.
   *
   * Colapsa "no responsable" e "indeterminado" en `false`. Si el consumidor
   * necesita distinguirlos —para explicar POR QUÉ se capitaliza el IVA—
   * debe usar `resolveDetailed`.
   */
  resolve(fiscalData: VatFiscalDataInput | null | undefined): boolean {
    return isVatResponsible(fiscalData);
  }

  /**
   * Variante de tres estados: además del booleano fail-closed devuelve
   * `indeterminate`, el `reason` estable y un `message` en español listo
   * para mostrarse. Pura, síncrona, nunca lanza.
   */
  resolveDetailed(
    fiscalData: VatFiscalDataInput | null | undefined,
  ): VatResponsibilityResult {
    return resolveVatResponsibility(fiscalData);
  }

  /**
   * Resultado canónico para un fallo de LECTURA de `fiscal_data`. Los
   * `catch` de los consumidores deben devolver esto en vez de inventarse un
   * default: indeterminado, fail-closed, `source: 'read_error'`.
   */
  readFailure(): VatResponsibilityResult {
    return vatResponsibilityReadFailure();
  }
}
