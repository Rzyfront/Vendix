import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { LodgingBookingEngineService } from '../../../domains/store/hospitality/reservations/booking-engine/booking-engine.service';
import { BookingSearchDto } from '../../../domains/store/hospitality/reservations/booking-engine/booking-engine.dto';

export interface LodgingToolDeps {
  bookingEngine: LodgingBookingEngineService;
}

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({ error, ...(nextStep ? { next_step: nextStep } : {}) });
}

function errorMessage(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string' ? response : (response?.message ?? error.message);
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

/**
 * Hospitality Suite (H9.1) — Vexi quotes a stay without opening the rack.
 *
 * Read-only. It runs the same search the hotel's booking engine shows
 * (`LodgingBookingEngineService.search`, H6.6), which prices every room type
 * with the desk quote (`LodgingReservationsService.quote`: default rate plan
 * or base price, availability and H2.3 restrictions). So the answer matches
 * what the screens show, and the store scoping comes from the same service.
 */
export function createLodgingTools(deps: LodgingToolDeps): RegisteredTool[] {
  const { bookingEngine } = deps;

  return [
    {
      name: 'quote_lodging_availability',
      version: '1',
      domain: 'lodging',
      readOnly: true,
      description:
        'Hotel: cotiza una estadía. Con llegada, salida y huéspedes devuelve, por tipo de habitación que les cabe, cuántas habitaciones hay libres, el total de la estadía, el promedio por noche, el anticipo que se cobra al reservar, la política de cancelación y la restricción que impide venderla (por ejemplo estancia mínima). No reserva nada. Para "dobles" o "suites" filtra por el nombre del tipo en la respuesta.',
      parameters: {
        type: 'object',
        properties: {
          arrival_date: { type: 'string', description: 'Llegada (YYYY-MM-DD).' },
          departure_date: {
            type: 'string',
            description: 'Salida (YYYY-MM-DD), el día en que se va: "del 10 al 13" son 3 noches.',
          },
          adults: { type: 'number', description: 'Adultos (mínimo 1).' },
          children: { type: 'number', description: 'Niños (por defecto 0).' },
        },
        required: ['arrival_date', 'departure_date', 'adults'],
      },
      requiredPermissions: ['store:lodging:reservations:read'],
      discovery: {
        synonyms: ['disponibilidad hotel', 'cotizar habitación', 'tarifa estadía', 'cupo habitaciones'],
        examples: [
          {
            intent: '¿Tengo dobles del 10 al 13 para 2 adultos y cuánto cuesta?',
            arguments: { arrival_date: '2026-11-10', departure_date: '2026-11-13', adults: 2 },
          },
        ],
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return guidedError('Sin tienda en contexto: la disponibilidad siempre es de un hotel.');
        }
        const dto = plainToInstance(
          BookingSearchDto,
          {
            arrival_date: args.arrival_date,
            departure_date: args.departure_date,
            adults: args.adults,
            children: args.children ?? 0,
          },
          { enableImplicitConversion: true },
        );
        if (validateSync(dto).length > 0) {
          return guidedError(
            'Datos de la estadía inválidos.',
            'Pide llegada y salida en formato YYYY-MM-DD y al menos 1 adulto (máximo 30 adultos y 30 niños).',
          );
        }
        try {
          const result = await bookingEngine.search(dto);
          return JSON.stringify({
            arrival_date: result.arrival_date,
            departure_date: result.departure_date,
            nights: result.nights,
            currency: result.currency,
            room_types: result.room_types.map((type) => ({
              name: type.name,
              available_rooms: type.available,
              can_sell: type.bookable,
              reason_not_sellable: type.unavailable_reason,
              total_amount: type.total_amount,
              nightly_average: type.nightly_average,
              amount_due_now: type.amount_due_now,
              rate_plan: type.rate_plan?.name ?? null,
              cancellation_policy: type.cancellation_policy,
              max_adults: type.max_adults,
              max_children: type.max_children,
            })),
            ...(result.room_types.length === 0
              ? { note: 'Ningún tipo de habitación activo admite esa cantidad de huéspedes.' }
              : {}),
          });
        } catch (error) {
          return guidedError(errorMessage(error));
        }
      },
    },
  ];
}
