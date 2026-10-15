import { isEmail } from 'class-validator';
import { onlyDigits } from '@common/utils/nit.util';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER } from '../validators/customer-fiscal-identity.validator';

/**
 * CORREO DEL ADQUIRIENTE OBLIGATORIO PARA EMITIR UNA FACTURA MANUAL.
 *
 * El correo es el destino del `AttachedDocument` que la norma obliga a
 * entregar. Una factura nominativa sin correo se emite y la DIAN la acepta,
 * pero el cliente nunca la recibe.
 *
 * ## Alcance — SÓLO los puntos de entrada manuales
 *
 * Esta compuerta la activan explícitamente:
 *   - `POST store/invoicing` sólo con `emit_immediately: true`.
 *   - `PATCH store/invoicing/:id/validate` y `:id/send` antes de emitir.
 *   - `POST superadmin/fiscal/sales-invoices` (`PlatformInvoicingService.createSalesInvoice`).
 *   - `POST superadmin/subscriptions/fiscal/invoices` (controller legacy).
 *
 * `InvoicingService.create()` también lo usan las notas de plataforma, y los
 * flujos automáticos (POS, desde orden / cuenta / pedido / contrato,
 * facturación SaaS) tienen sus propios métodos: ninguno pasa por aquí.
 *
 * ## Exento: consumidor final
 *
 * El adquiriente es consumidor final cuando trae el número oficial
 * `222222222222` o cuando no trae número de documento. Es la convención de la
 * pantalla «Nueva factura» (sin documento = consumidor final), que siempre
 * envía un tipo de documento por defecto: exigir además «sin tipo ni nombre»
 * (criterio de `DianDirectProvider.buildCustomerData`) haría que el servidor
 * rechazara con 400 una factura que la pantalla deja crear.
 */

/** Tipos de documento de venta con adquiriente a quien entregar la factura. */
export const INVOICE_TYPES_REQUIRING_ACQUIRER_EMAIL: readonly string[] =
  Object.freeze(['sales_invoice', 'export_invoice']);

export interface ManualAcquirerEmailInput {
  /** Correos candidatos EN ORDEN de precedencia; gana el primero no vacío. */
  email_candidates: ReadonlyArray<string | null | undefined>;
  document_type?: string | null;
  document_number?: string | null;
  name?: string | null;
}

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Primer correo no vacío de la cascada, recortado; `null` si no hay ninguno. */
export function resolveEffectiveAcquirerEmail(
  candidates: ReadonlyArray<string | null | undefined>,
): string | null {
  for (const candidate of candidates) {
    const value = blankToNull(candidate);
    if (value) return value;
  }
  return null;
}

/** ¿El adquiriente cae en el carril de consumidor final? */
export function isFinalConsumerAcquirer(input: {
  document_type?: string | null;
  document_number?: string | null;
  name?: string | null;
}): boolean {
  const number = blankToNull(input.document_number);
  return !number || onlyDigits(number) === DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER;
}

/**
 * Lanza 400 `INVOICING_ACQUIRER_EMAIL_REQUIRED` / `INVOICING_ACQUIRER_EMAIL_INVALID`.
 * Pura y sin I/O: el llamador resuelve las fuentes y la invoca ANTES de
 * cualquier efecto (crear cliente, numerar, escribir).
 */
export function assertManualAcquirerEmail(
  input: ManualAcquirerEmailInput,
): void {
  if (isFinalConsumerAcquirer(input)) return;

  const email = resolveEffectiveAcquirerEmail(input.email_candidates);
  if (!email) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_ACQUIRER_EMAIL_REQUIRED,
      'El correo del cliente es obligatorio para emitir la factura electrónica: es la dirección a la que se le entrega. Escríbelo en el formulario o agrégalo a la ficha del cliente.',
      { field: 'customer_email' },
    );
  }
  if (email.length > 255 || !isEmail(email)) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_ACQUIRER_EMAIL_INVALID,
      `El correo del cliente «${email}» no es válido (ej. cliente@dominio.com). Corrígelo en el formulario o en la ficha del cliente.`,
      { field: 'customer_email' },
    );
  }
}
