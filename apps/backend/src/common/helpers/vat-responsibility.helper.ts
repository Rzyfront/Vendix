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
 *   - indeterminado (sin señales)                             ⇒ responsable (true)
 *
 * La rama indeterminada devuelve `true` de forma DELIBERADA (anti-regresión):
 * preserva el comportamiento pre-F4 donde un comercio sin datos fiscales
 * cargados podía asignar/cobrar IVA con normalidad.
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
 * Resuelve si el comercio es responsable de IVA a partir de su `fiscal_data`.
 * Ver bloque de documentación del archivo para la definición canónica.
 */
export function isVatResponsible(
  fiscalData: VatFiscalDataInput | null | undefined,
): boolean {
  const responsibilities = Array.isArray(fiscalData?.tax_responsibilities)
    ? (fiscalData!.tax_responsibilities as unknown[]).filter(
        (code): code is string => typeof code === 'string',
      )
    : [];

  // 1) Señal explícita por responsabilidades DIAN (RUT casilla 53).
  if (responsibilities.includes(VAT_RESPONSIBLE_CODE)) return true; // O-48
  if (responsibilities.includes(VAT_NOT_RESPONSIBLE_CODE)) return false; // O-49 sin O-48

  // 2) Fallback por régimen tributario.
  const regime =
    typeof fiscalData?.tax_regime === 'string'
      ? fiscalData.tax_regime
      : undefined;
  if (regime === 'COMUN' || regime === 'GRAN_CONTRIBUYENTE') return true;
  if (regime === 'SIMPLIFICADO') return false;

  // 3) Indeterminado ⇒ responsable (anti-regresión).
  return true;
}

/**
 * Predicado de bloqueo POSITIVO: `true` SOLO cuando el comercio es
 * explícitamente NO responsable de IVA. El caso indeterminado devuelve
 * `false` (no bloquea), consistente con la rama anti-regresión.
 */
export function isExplicitlyNotVatResponsible(
  fiscalData: VatFiscalDataInput | null | undefined,
): boolean {
  return !isVatResponsible(fiscalData);
}

/**
 * Enforcement de escritura: lanza `FISCAL_VAT_NOT_RESPONSIBLE_001` (HTTP 412)
 * cuando el comercio NO es responsable de IVA. No-op si es responsable o si
 * el estado es indeterminado (no bloquea). El `context` indica el origen
 * ('product' | 'sale') y el CTA apunta al wizard de activación fiscal.
 */
export function assertCanChargeVat(
  fiscalData: VatFiscalDataInput | null | undefined,
  context: VatChargeContext,
): void {
  if (isVatResponsible(fiscalData)) return;
  throw new VendixHttpException(
    ErrorCodes.FISCAL_VAT_NOT_RESPONSIBLE_001,
    undefined,
    {
      context,
      cta: '/admin/fiscal/wizard',
    },
  );
}
