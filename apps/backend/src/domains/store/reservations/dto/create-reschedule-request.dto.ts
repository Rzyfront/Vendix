import { IsDateString, IsString, IsOptional, Matches, MaxLength } from 'class-validator';

/**
 * Payload para crear una solicitud de reagendamiento PENDIENTE.
 *
 * Appointment redesign phase 2 — el body es esencialmente el mismo que
 * `RescheduleBookingDto` (date / start_time / end_time) más una razón
 * opcional. Se usa tanto desde el admin/staff (`POST
 * /store/reservations/:id/reschedule-requests`) como desde el ecommerce
 * (`POST /ecommerce/reservations/:id/reschedule-requests`).
 *
 * El backend decide a qué ruta enrutar el reschedule según
 * `settings.reservations.allow_direct_reschedule`:
 *
 *   - flag `true`  → el controller admin llama `reschedule()` directo
 *     (legacy); el ecommerce endpoint redirige internamente.
 *   - flag `false` → ambos controllers llaman `requestReschedule()` y
 *     devuelven 202 con el `request_id` en el body.
 */
export class CreateRescheduleRequestDto {
  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  /**
   * Razón libre que el cliente (o el admin) escribió para pedir el
   * reagendamiento. Se persiste en `booking_reschedule_requests.reason`
   * y se muestra al admin en la cola para ayudarlo a decidir.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}