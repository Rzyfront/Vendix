import { Prisma } from '@prisma/client';

/**
 * QUI-1060: devuelve a su salida los cupos de una reserva de plan. Se llama dentro
 * de la transacción que cancela o elimina la reserva, en todos los caminos de
 * cancelación (panel, enlace de confirmación, auto-cancelación). Reservas sin
 * salida (servicios normales o plan a fecha libre) no hacen nada. Nunca baja de cero.
 */
export async function releasePlanSeatsForBookingInTx(
  tx: Prisma.TransactionClient,
  bookingId: number,
): Promise<void> {
  const booking = await tx.bookings.findFirst({
    where: { id: bookingId },
    select: { store_id: true, departure_id: true, pax_adults: true, pax_children: true },
  });
  if (!booking || booking.departure_id == null) return;
  const pax = (booking.pax_adults ?? 0) + (booking.pax_children ?? 0);
  if (pax <= 0) return;
  await tx.$executeRaw`
    UPDATE "service_plan_departures"
       SET "seats_sold" = GREATEST("seats_sold" - ${pax}, 0), "updated_at" = NOW()
     WHERE "id" = ${booking.departure_id}
       AND "store_id" = ${booking.store_id}`;
}
