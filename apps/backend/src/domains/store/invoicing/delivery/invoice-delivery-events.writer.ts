import { Prisma } from '@prisma/client';

/**
 * Escritor ÚNICO de `invoice_delivery_events`, compartido por los DOS caminos
 * que entregan una factura por correo (E.10, 2026-08-25):
 *
 *   1. El reenvío de conveniencia — `InvoiceDeliveryService.deliver()`,
 *      `POST /:id/deliver` (E.6). El usuario teclea un correo arbitrario.
 *   2. La entrega PRIMARIA — `notifications-events.listener.ts`,
 *      `@OnEvent('invoice.pdf.generated')`. El acto que rige el Anexo Técnico
 *      1.9 §9.1, disparado automáticamente cuando la DIAN acepta el
 *      documento.
 *
 * Antes de E.10 sólo (1) dejaba traza: **16 de 95** facturas con
 * `email_sent_at` tenían CERO filas aquí — la entrega normativa no era
 * auditable y el reenvío de conveniencia sí. Este escritor cierra esa
 * asimetría reusando la misma forma de fila en vez de duplicarla.
 *
 * `invoice_delivery_events` NO está en el whitelist de alcance de
 * `StorePrismaService` (ver el docblock de `InvoiceDeliveryService.deliver`).
 * Por eso esta función recibe el DELEGADO ya resuelto por cada llamador con
 * su propio mecanismo de escape — `StorePrismaService.withoutScope()
 *   .invoice_delivery_events` en (1); `GlobalPrismaService.invoice_delivery_events`
 * en (2), getter añadido para esto, mismo patrón que sus demás ~90 getters—,
 * en vez de resolverlo ella misma. En los DOS casos los IDs que se escriben
 * (`invoice_id`, `organization_id`, `store_id`) salen de una fila de
 * `invoices` YA CARGADA por el llamador — alcanzada por tienda en (1),
 * cargada por id desde un evento interno que el propio backend emite en
 * (2)—, nunca de un parámetro de petición sin verificar: el bypass de
 * alcance es seguro en los dos por la misma razón estructural, no por
 * casualidad compartida.
 */

export interface InvoiceDeliveryEventsDelegate {
  create(args: {
    data: Prisma.invoice_delivery_eventsUncheckedCreateInput;
  }): Promise<unknown>;
}

export interface InvoiceDeliveryEventInput {
  invoice_id: number;
  organization_id: number;
  store_id: number | null;
  /** `'email'` en los dos caminos actuales; abierto a otros canales futuros. */
  channel: string;
  recipient: string;
  /**
   * Nombre del `.zip` adjunto, cuando lo hay. El reenvío (E.6) siempre arma
   * un zip; la entrega primaria adjunta PDF/XML sueltos, sin zip — ahí este
   * campo va `null` a propósito, no es un dato que falte.
   */
  zip_name?: string | null;
  status: 'sent' | 'error';
  provider_error?: string | null;
  /** `null` cuando el intento lo dispara un evento interno, no un usuario. */
  created_by?: number | null;
}

export async function writeInvoiceDeliveryEvent(
  delegate: InvoiceDeliveryEventsDelegate,
  input: InvoiceDeliveryEventInput,
): Promise<void> {
  await delegate.create({
    data: {
      invoice_id: input.invoice_id,
      organization_id: input.organization_id,
      store_id: input.store_id,
      channel: input.channel,
      recipient: input.recipient,
      zip_name: input.zip_name ?? null,
      status: input.status,
      provider_error: input.provider_error ?? null,
      created_by: input.created_by ?? null,
    },
  });
}
