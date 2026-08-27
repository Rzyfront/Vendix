import { PrintFormat } from '../../settings/interfaces/store-settings.interface';
import {
  PAPER_DEFINITIONS,
  PaperDefinition,
  QR_MIN_SIDE_MM,
} from './paper-definitions';

/**
 * E.11 slice 2 — punto de entrada del consumer para los 5 papeles.
 *
 * Lo único que el resto del dominio necesita saber del papel es «dame la
 * definición de este código». El resto (builder, composer, gateway, spec
 * de paridad) lo lee por aquí.
 *
 * Decisión de producto: los códigos son un conjunto CERRADO — los define
 * `PRINT_FORMATS` en `store-settings.interface.ts` y son los mismos cinco
 * que el builder soporta. Pasar algo fuera de ese conjunto es un error de
 * tipo de entrada (no un «paper no configurado»), y se lanza un `Error`
 * con código legible. NO se devuelve un fallback silencioso: un PDF con la
 * geometría equivocada deja de ser el mismo documento legal que el
 * adquiriente espera recibir.
 *
 * # Integración con el builder (slice 3)
 *
 * El consumidor natural de esta función es
 * `FiscalInvoicePdfRenderService.renderBuffer` (en este mismo dominio), que
 * hoy lee `data.format` del `InvoicePdfData` y se lo pasa al builder tal
 * cual. El cableado fino — pasarle también la `PaperDefinition` completa
 * para que el builder NO recompile su `GEOMETRY` desde cero, o para que el
 * service decida `bottom_reserve` y `double_pass` antes de invocar al
 * builder— es el slice 3 de este paso. Hasta entonces, este archivo
 * queda como DATOS PUROS: nada en el builder cambia, y el `engine:'pdf'`
 * del gateway sigue produciendo el mismo Buffer que producía antes.
 *
 * # TODO(integration-slice-3): integrate with builder when slice 2b wires DI
 *   - Inyectar `PaperDefaultsService` (o importar `getPaperDefinition`
 *     directamente) en `FiscalInvoicePdfRenderService`.
 *   - Antes de `InvoicePdfBuilder.generate(...)`, llamar
 *     `getPaperDefinition(data.format ?? 'letter')` y, si
 *     `paper.requires_multipage_qr_band` y el QR existe, pasar al builder
 *     una variante con `bottom_reserve = paper.qr_stamp_band_mm * PT_PER_MM`.
 *   - Si `paper.double_pass_required`, replicar el flujo de sonda de
 *     `ROLL_PROBE_HEIGHT` en el builder (hoy ya lo hace, pero leyendo
 *     `layout.roll`; cuando se cablee, leerá `paper.double_pass_required`).
 */
export function getPaperDefinition(
  paperFormat: PrintFormat,
): PaperDefinition {
  const definition = PAPER_DEFINITIONS[paperFormat];
  if (!definition) {
    throw new Error(
      `PAPER_FORMAT_UNKNOWN_001: el papel "${paperFormat}" no está en PAPER_DEFINITIONS. ` +
        `Códigos válidos: ${Object.keys(PAPER_DEFINITIONS).join(', ')}.`,
    );
  }
  return definition;
}

/**
 * Resuelve el papel efectivo a partir de un valor arbitrario y un fallback.
 *
 * Tres sitios del dominio leen el papel de un setting de la tienda y lo
 * dejan caer a `letter` si el valor falta o no es uno de los cinco
 * (`invoice-pdf.builder.ts:resolveLayout`, `print-gateway.service.ts:
 * resolveEffectiveConfig`, `PRINT_PAGE_GEOMETRY`). Esta función unifica
 * esa cadena de resolución y le quita a cada llamador la decisión
 * «¿caigo a letter?». Es lo que slice 3 va a invocar cuando cablee el
 * consumer.
 *
 * @param raw  valor leído del setting (string suelto o `PrintFormat`).
 * @param fallback papel a usar cuando `raw` no es uno de los cinco. Por
 *               defecto `letter`, que es lo que el builder asumía antes de
 *               que el setting existiera.
 */
export function resolvePaperDefinition(
  raw: string | PrintFormat | null | undefined,
  fallback: PrintFormat = 'letter',
): PaperDefinition {
  if (raw && raw in PAPER_DEFINITIONS) {
    return PAPER_DEFINITIONS[raw as PrintFormat];
  }
  return PAPER_DEFINITIONS[fallback];
}

/**
 * Re-export del mínimo legal §11.7 — para que cualquier llamador que ya
 * importe de `paper-defaults` no tenga que importar dos archivos sólo
 * para leerlo.
 */
export { QR_MIN_SIDE_MM };
