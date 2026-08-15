import { FiscalDocumentFinding } from '../validators/fiscal-document.validator';

/**
 * Estado fiscal de una venta de mostrador, tal como lo pinta el POS.
 *
 * Es un estado DERIVADO: no hay columna que lo guarde. Se recompone leyendo la
 * factura, su `transmission_status` y la cola de reintentos, porque cada uno de
 * esos tres ya es la verdad de su propia parte y copiarlos a un cuarto sitio
 * sólo crearía una versión que se desincroniza.
 *
 * Los cinco valores son los cinco desenlaces que el cajero necesita distinguir,
 * y ni uno más:
 *
 * - `not_applicable` — esta tienda no emite electrónicamente (área fiscal
 *   inactiva o habilitación DIAN sin terminar). No hay nada que esperar.
 * - `pending`  — el documento está en camino: se está armando, se está
 *   transmitiendo, o la cola lo reintentará. NO exige nada del cajero.
 * - `issued`   — la DIAN lo aceptó. Hay CUFE.
 * - `contingency` — la DIAN no estaba disponible; el documento se expidió bajo
 *   contingencia (Anexo §12.2, tipo 04), es entregable al cliente, y el emisor
 *   debe transmitirlo dentro de 48 h. Tampoco exige nada del cajero.
 * - `failed`   — el documento NO se emitió y NO se va a arreglar solo: le falta
 *   un dato o lo rechazó la DIAN. Es el único estado que pide intervención.
 */
export type PosFiscalState =
  | 'not_applicable'
  | 'pending'
  | 'issued'
  | 'contingency'
  | 'failed';

export interface PosFiscalStatus {
  order_id: number;
  state: PosFiscalState;
  /** Por qué está en ese estado, en español y ya redactado para mostrarse. */
  message: string;
  invoice_id: number | null;
  invoice_number: string | null;
  /** Estado del documento en la máquina de estados fiscal (`draft`, `sent`…). */
  invoice_status: string | null;
  cufe: string | null;
  pdf_url: string | null;
  /**
   * Qué le falta al documento cuando `state === 'failed'` por prevalidación.
   * Sale del validador único (`fiscal-document.validator.ts` /
   * `customer-fiscal-identity.validator.ts`), así que trae `problem` y `fix`:
   * qué está mal y dónde se corrige. Vacío en cualquier otro estado.
   */
  blockers: FiscalDocumentFinding[];
  /** Intento actual de la cola de reintentos, cuando hay uno vivo. */
  retry: {
    attempts: number;
    max_attempts: number;
    next_retry_at: Date;
    last_error: string | null;
  } | null;
  /** Fecha límite de transmisión cuando el documento salió bajo contingencia. */
  contingency_deadline: Date | null;
  /**
   * Token de la solicitud de datos de facturación pendiente para este pedido.
   *
   * Es el carril de «factura nominativa pedida después»: la venta se cerró a
   * Consumidor Final y el cliente puede mandar sus datos más tarde por el
   * formulario público. El POS lo usa para imprimir/compartir el enlace.
   */
  invoice_data_token: string | null;
}
