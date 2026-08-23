import { Injectable } from '@nestjs/common';
import { VendixHttpException } from '../errors/vendix-http.exception';
import { ErrorCodes } from '../errors/error-codes';
import { purchaseEffectFor } from '../../domains/fiscal-operations/constants/fiscal-responsibilities.catalog';

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
 * CP-PURCHASE-TRANSPARENCY B.3 — qué hace el motor de costeo con el IVA que el
 * comercio PAGA en una compra.
 *
 * Se deriva de `responsible`, no se decide aparte: si el predicado y el texto
 * pudieran divergir, la pantalla explicaría al revés lo que el sistema hace.
 */
export type VatPurchaseTreatment = 'deductible' | 'capitalized';

/**
 * Explicación completa del tratamiento del IVA de una compra, lista para viajar
 * como dato estructurado hasta la interfaz (ADR-2: el frontend no vuelve a
 * derivar el predicado para explicar el costo).
 *
 * Es el cuerpo de `fiscal_explanation` en la respuesta de la vista previa de
 * costo. Contrato compartido: `reason` y `source` son las uniones estables del
 * helper — el mismo vocabulario que usan los logs y los tests, para que un
 * defecto reportado desde la pantalla se pueda buscar en el código.
 */
export interface VatTreatmentExplanation {
  /** Proyección fail-closed: `false` también cuando el estado es indeterminado. */
  vat_responsible: boolean;
  indeterminate: boolean;
  reason: VatResponsibilityReason;
  source: VatResponsibilitySource;
  treatment: VatPurchaseTreatment;
  /** Español llano, listo para pintar. Sin jerga de código. */
  message: string;
  legal_basis: string[];
  /** Presente SOLO cuando el estado es indeterminado. */
  cta?: { label: string; route: string };
}

/** Ruta del asistente fiscal. Único destino del CTA de estado indeterminado. */
export const FISCAL_WIZARD_ROUTE = '/admin/fiscal/wizard';

/**
 * Base legal del caso indeterminado. NO es la de O-49: el comercio no declaró
 * nada, así que lo que se cita es la regla por defecto que el sistema aplica
 * (tratarlo como no responsable y capitalizar), no una declaración suya.
 */
const INDETERMINATE_LEGAL_BASIS = [
  'Art. 437 ET, parágrafo 3 — no responsables del IVA',
  'Art. 493 ET — el IVA que no es descontable constituye mayor valor del costo o del gasto',
  'NIIF para PYMES §13.6 / NIC 2 ¶11 — los impuestos no recuperables integran el costo de los inventarios',
];

/**
 * Copia del catálogo para las dos ramas que NO nacen de una declaración del
 * contribuyente sino de una INFERENCIA por régimen tributario. El matiz
 * importa: el comercio no dijo «soy O-48», el sistema lo dedujo de su régimen,
 * y el texto tiene que decirlo así para que el operador sepa que puede
 * corregirlo.
 */
const REGIME_INFERENCE_COPY: Record<
  'regime_responsible' | 'regime_not_responsible',
  { message: string; legal_basis: string[] }
> = {
  regime_responsible: {
    message:
      'Tu régimen tributario (común o gran contribuyente) implica que eres responsable de IVA, aunque no lo declaraste explícitamente. Por eso el IVA de esta compra no aumenta el costo de tus productos: se registra como IVA descontable. Declara la responsabilidad O-48 en tu área fiscal para dejarlo confirmado.',
    legal_basis: [
      'Art. 437 ET — responsables del impuesto sobre las ventas',
      'Art. 485 ET — impuestos descontables',
      'Art. 488 ET — solo son descontables los impuestos pagados en bienes y servicios que dan derecho a costo o deducción',
    ],
  },
  regime_not_responsible: {
    message:
      'Tu régimen tributario declarado no es responsable de IVA, así que el IVA de esta compra se suma al costo de tus productos. Es una inferencia a partir del régimen, no una declaración tuya: si ya eres responsable de IVA, decláralo en tu área fiscal para que el costo se calcule bien.',
    legal_basis: [
      'Art. 18 Ley 1943 de 2018 — eliminación del régimen simplificado y creación de la categoría de no responsables de IVA',
      'Art. 493 ET — el IVA que no es descontable constituye mayor valor del costo o del gasto',
      'NIIF para PYMES §13.6 / NIC 2 ¶11 — los impuestos no recuperables integran el costo de los inventarios',
    ],
  },
};

/**
 * Explica el tratamiento del IVA de compra a partir de un resultado YA resuelto.
 *
 * Existe separada de `resolveVatTreatment` porque el consumidor que atrapó un
 * fallo de lectura tiene el resultado (`vatResponsibilityReadFailure()`) pero
 * ya no tiene los datos fiscales: sin esta variante tendría que inventarse el
 * texto en su `catch`, que es exactamente la duplicación que B.3 elimina.
 *
 * Pura, síncrona, nunca lanza.
 */
export function vatTreatmentFromResult(
  outcome: VatResponsibilityResult,
): VatTreatmentExplanation {
  const base = {
    vat_responsible: outcome.responsible,
    indeterminate: outcome.indeterminate,
    reason: outcome.reason,
    source: outcome.source,
  };

  // 1) Declaración explícita: el texto y la base legal salen del CATÁLOGO
  //    oficial (`fiscal-responsibilities.catalog.ts`), no de una cadena local.
  if (
    outcome.reason === 'declared_responsible' ||
    outcome.reason === 'declared_not_responsible'
  ) {
    const code =
      outcome.reason === 'declared_responsible'
        ? VAT_RESPONSIBLE_CODE
        : VAT_NOT_RESPONSIBLE_CODE;
    const effect = purchaseEffectFor(code);
    if (effect) {
      return { ...base, treatment: effect.treatment, message: effect.message, legal_basis: effect.legal_basis };
    }
    // El catálogo perdió la entrada (nunca debería pasar): se cae al
    // tratamiento derivado del booleano, que es el que el motor SÍ aplica.
  }

  // 2) Inferencia por régimen.
  if (
    outcome.reason === 'regime_responsible' ||
    outcome.reason === 'regime_not_responsible'
  ) {
    const copy = REGIME_INFERENCE_COPY[outcome.reason];
    return {
      ...base,
      treatment: outcome.responsible ? 'deductible' : 'capitalized',
      message: copy.message,
      legal_basis: copy.legal_basis,
    };
  }

  // 3) Indeterminado — las dos formas. Fail-closed: se capitaliza. El mensaje
  //    recomienda configurar el área fiscal y el CTA apunta al asistente.
  const cta = { label: 'Configurar mi área fiscal', route: FISCAL_WIZARD_ROUTE };
  if (outcome.reason === 'fiscal_read_failed') {
    return {
      ...base,
      treatment: 'capitalized',
      message:
        'No pudimos leer la configuración fiscal de tu comercio, así que por precaución tratamos esta compra como si no fueras responsable de IVA: el IVA se suma al costo de tus productos. Vuelve a intentarlo en un momento y, si el problema sigue, revisa la configuración de tu área fiscal.',
      legal_basis: INDETERMINATE_LEGAL_BASIS,
      cta,
    };
  }

  return {
    ...base,
    treatment: outcome.responsible ? 'deductible' : 'capitalized',
    message:
      'Aún no configuraste tu área fiscal. Mientras no lo hagas tratamos tu comercio como no responsable de IVA, así que el IVA de esta compra se sumará al costo de tus productos. Configura tu responsabilidad fiscal para que los costos y los impuestos se calculen según tu situación real ante la DIAN.',
    legal_basis: INDETERMINATE_LEGAL_BASIS,
    cta,
  };
}

/**
 * B.3 — resuelve el estado fiscal Y lo explica en una sola llamada.
 *
 * Es `resolveVatResponsibility` + el texto del catálogo. El booleano que
 * devuelve (`vat_responsible`) es LITERALMENTE el mismo que aplica el motor de
 * costeo, porque sale de la misma función: el texto no puede describir un
 * tratamiento distinto del que el sistema ejecuta.
 *
 * Pura, síncrona, nunca lanza. Para el caso «no se pudo LEER `fiscal_data`»
 * usa `vatTreatmentFromResult(vatResponsibilityReadFailure())`.
 */
export function resolveVatTreatment(
  fiscalData: VatFiscalDataInput | null | undefined,
): VatTreatmentExplanation {
  return vatTreatmentFromResult(resolveVatResponsibility(fiscalData));
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

  /**
   * B.3 — resultado de tres estados MÁS el tratamiento del IVA de compra, su
   * texto en español y su base legal, listo para viajar como
   * `fiscal_explanation` en la respuesta de la vista previa de costo.
   */
  explain(
    fiscalData: VatFiscalDataInput | null | undefined,
  ): VatTreatmentExplanation {
    return resolveVatTreatment(fiscalData);
  }

  /**
   * B.3 — explicación canónica cuando la LECTURA de `fiscal_data` falló. El
   * `catch` del consumidor devuelve esto en vez de inventarse un texto.
   */
  explainReadFailure(): VatTreatmentExplanation {
    return vatTreatmentFromResult(vatResponsibilityReadFailure());
  }
}
