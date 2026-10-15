import { isEmail } from 'class-validator';
import { onlyDigits } from '@common/utils/nit.util';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER } from '../validators/customer-fiscal-identity.validator';

/**
 * CORREO DEL ADQUIRIENTE OBLIGATORIO EN LA CREACIÓN MANUAL DE FACTURA.
 *
 * El correo es el destino del `AttachedDocument` que la norma obliga a
 * entregar. Una factura nominativa sin correo se emite y la DIAN la acepta,
 * pero el cliente nunca la recibe.
 *
 * ## Alcance — SÓLO los puntos de entrada manuales
 *
 * Esta compuerta la activan explícitamente:
 *   - `POST store/invoicing` (`InvoicingService.create(dto, { require_acquirer_email: true })`).
 *   - `POST superadmin/fiscal/sales-invoices` (`PlatformInvoicingService.createSalesInvoice`).
 *   - `POST superadmin/subscriptions/fiscal/invoices` (controller legacy).
 *
 * `InvoicingService.create()` también lo usan las notas de plataforma, y los
 * flujos automáticos (POS, desde orden / cuenta / pedido / contrato,
 * facturación SaaS) tienen sus propios métodos: ninguno pasa por aquí.
 *
 * ## Exento: consumidor final
 *
 * Mismo criterio que `DianDirectProvider.buildCustomerData`: el documento
 * declara consumidor final cuando trae el número oficial `222222222222`, o
 * cuando no declara adquiriente alguno (ni tipo, ni número, ni nombre).
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
  if (number && onlyDigits(number) === DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER) {
    return true;
  }
  return (
    !number && !blankToNull(input.document_type) && !blankToNull(input.name)
  );
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
      'El correo del cliente es obligatorio para crear la factura electrónica: es la dirección a la que se le entrega. Escríbelo en el formulario o agrégalo a la ficha del cliente.',
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
