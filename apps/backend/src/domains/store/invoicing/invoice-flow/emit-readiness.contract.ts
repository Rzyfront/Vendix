import type {
  CustomerFiscalIdentityFinding,
  CustomerFiscalIdentityReport,
} from '../validators/customer-fiscal-identity.validator';
import type {
  FiscalDocumentFinding,
  FiscalDocumentReport,
} from '../validators/fiscal-document.validator';

/**
 * Un hallazgo de la puerta de emisión, venga de la puerta que venga.
 *
 * Las dos puertas producen la MISMA forma útil para la pantalla —`code`,
 * `severity`, `field`, `problem`, `fix`— y difieren sólo en el universo de
 * `code` y en que el fiscal añade `category` y la regla del Anexo.
 */
export type EmitReadinessFinding =
  | CustomerFiscalIdentityFinding
  | FiscalDocumentFinding;

/**
 * EL VEREDICTO, SIN NADA QUE PRESUPONGA UN DOCUMENTO ESCRITO.
 *
 * Este es el núcleo común de las dos puertas de emisión de Vendix:
 *
 * - `GET /store/invoicing/:id/emit-readiness` — sobre una factura que YA existe.
 *   Añade `invoice_id`, `invoice_number`, `status`, `valid_transitions` y
 *   `discard_route`, que sólo tienen sentido sobre una fila persistida.
 * - `POST /store/invoicing/validate-draft` — sobre el payload que el formulario
 *   ENVIARÍA, antes de que exista factura y por tanto antes de que se gaste un
 *   consecutivo autorizado. Devuelve exactamente esta forma y nada más.
 *
 * El núcleo se declara UNA vez y aquí —fuera de `invoice-flow.service.ts`— para
 * que las dos puertas no puedan derivar: el día que una añada un campo al
 * veredicto y la otra no, la pantalla que las pinta con el mismo modal empieza a
 * mostrar cosas distintas según por dónde entró el usuario.
 *
 * `emittable` es el AND de las DOS puertas (identidad ∧ prevalidación fiscal),
 * nunca sólo el de identidad: publicar un `emittable` que mira una sola deja al
 * usuario con «no se puede emitir» y la lista de requisitos vacía.
 *
 * `fiscal_document: null` NO significa «está mal»: significa que el
 * `invoice_type` no se emite a la DIAN y no hay nada que prevalidar.
 */
export interface EmitReadinessVerdict {
  emittable: boolean;
  findings: EmitReadinessFinding[];
  blockers: EmitReadinessFinding[];
  warnings: EmitReadinessFinding[];
  has_items: boolean;
  /** El informe de identidad SIN aplanar, para leerlo sin ambigüedad. */
  identity: CustomerFiscalIdentityReport;
  fiscal_document: FiscalDocumentReport | null;
}

/**
 * Respuesta EXACTA de `POST /store/invoicing/validate-draft`.
 *
 * Es el veredicto y NADA más. No lleva `invoice_id`, `invoice_number` ni
 * `status` a propósito: el documento que se está juzgando todavía no se
 * escribió, y rellenarlos con `0` / `''` haría que la pantalla ofreciera
 * transiciones y rutas de descarte sobre una factura inexistente.
 */
export type DraftEmitReadinessReport = EmitReadinessVerdict;
