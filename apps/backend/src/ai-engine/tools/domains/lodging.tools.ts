import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolExecutionContext, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { LodgingBookingEngineService } from '../../../domains/store/hospitality/reservations/booking-engine/booking-engine.service';
import { BookingSearchDto } from '../../../domains/store/hospitality/reservations/booking-engine/booking-engine.dto';
import { LodgingReservationsService } from '../../../domains/store/hospitality/reservations/reservations.service';

export interface LodgingToolDeps {
  bookingEngine: Pick<LodgingBookingEngineService, 'search'>;
  reservations: Pick<LodgingReservationsService, 'create'>;
  /** Full name of a customer of the current store, or null when it is not one. */
  findCustomerName: (customer_id: number) => Promise<string | null>;
}

type SearchResult = Awaited<ReturnType<LodgingBookingEngineService['search']>>;
type SearchRoomType = SearchResult['room_types'][number];

const NEW_STAY = 'Nueva reserva de hotel';

function searchDto(args: Record<string, unknown>): BookingSearchDto | null {
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
  return validateSync(dto).length > 0 ? null : dto;
}

const INVALID_STAY_STEP =
  'Pide llegada y salida en formato YYYY-MM-DD y al menos 1 adulto (máximo 30 adultos y 30 niños).';

/** "doble" picks "Doble"; "doble" with "Doble" and "Doble superior" picks the exact one. */
function pickRoomType(
  types: SearchRoomType[],
  wanted: string,
): { type: SearchRoomType } | { error: string } {
  const key = wanted.trim().toLocaleLowerCase('es');
  const names = types.map((t) => t.name).join(', ');
  const exact = types.filter((t) => t.name.toLocaleLowerCase('es') === key);
  const matches = exact.length ? exact : types.filter((t) => t.name.toLocaleLowerCase('es').includes(key));
  if (matches.length === 1) return { type: matches[0] };
  if (!types.length) return { error: 'Ningún tipo de habitación activo admite esa cantidad de huéspedes.' };
  return matches.length === 0
    ? { error: `No hay un tipo de habitación "${wanted}" para esos huéspedes. Tipos disponibles: ${names}.` }
    : { error: `"${wanted}" coincide con varios tipos: ${matches.map((t) => t.name).join(', ')}. Pide cuál.` };
}

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  return `${currency === 'COP' ? '$' : `${currency} `}${value.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
}

interface PlannedStay {
  dto: BookingSearchDto;
  customer_id: number;
  customer_name: string;
  result: SearchResult;
  type: SearchRoomType;
}

/**
 * Resolves the stay the receptionist asked for: the room type by name, the
 * guest of this store and the same quote the booking screens show. Run by
 * both the preview and the handler, so the apply re-verifies everything.
 */
async function planStay(
  deps: LodgingToolDeps,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<PlannedStay | { error: string; next_step?: string }> {
  if (!context.store_id) {
    return { error: 'Sin tienda en contexto: las reservas siempre son de un hotel.' };
  }
  const dto = searchDto(args);
  if (!dto) return { error: 'Datos de la estadía inválidos.', next_step: INVALID_STAY_STEP };
  const customer_id = Number(args.customer_id);
  if (!Number.isInteger(customer_id) || customer_id <= 0) {
    return { error: 'Falta el huésped titular.', next_step: 'Búscalo con find_customer y usa su id.' };
  }
  const customer_name = await deps.findCustomerName(customer_id);
  if (!customer_name) {
    return {
      error: 'Ese huésped no es cliente de este hotel.',
      next_step: 'Búscalo con find_customer o créalo primero.',
    };
  }
  const result = await deps.bookingEngine.search(dto);
  const picked = pickRoomType(result.room_types, String(args.room_type ?? ''));
  if ('error' in picked) return { error: picked.error };
  return { dto, customer_id, customer_name, result, type: picked.type };
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
  const { bookingEngine, reservations } = deps;

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
        const dto = searchDto(args);
        if (!dto) {
          return guidedError('Datos de la estadía inválidos.', INVALID_STAY_STEP);
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
    /**
     * H9.2 — "resérvale la doble a Juan Pérez". The preview is the proposal
     * the receptionist confirms: guest, dates, room type, total, deposit due
     * now and cancellation policy, from the same quote as H9.1. Nothing is
     * created until "Confirmar"; the handler re-runs the quote and books
     * through `LodgingReservationsService.create` (availability lock,
     * restrictions, policy snapshot), the same path as the reservation form.
     */
    {
      name: 'book_lodging_stay',
      version: '1',
      domain: 'lodging',
      description:
        'Hotel: crea una reserva confirmada de UNA habitación para un huésped. Antes cotiza con quote_lodging_availability y busca al huésped con find_customer (customer_id). La persona ve la propuesta con el total, el anticipo y la política de cancelación y la confirma; si el tipo no se puede vender en esas fechas (sin cupo o restricción como estancia mínima) no se reserva.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: 'Huésped titular (id de find_customer).' },
          room_type: {
            type: 'string',
            description: 'Nombre del tipo de habitación tal como lo devuelve quote_lodging_availability (por ejemplo "Doble").',
          },
          arrival_date: { type: 'string', description: 'Llegada (YYYY-MM-DD).' },
          departure_date: {
            type: 'string',
            description: 'Salida (YYYY-MM-DD), el día en que se va: "del 10 al 13" son 3 noches.',
          },
          adults: { type: 'number', description: 'Adultos (mínimo 1).' },
          children: { type: 'number', description: 'Niños (por defecto 0).' },
          notes: { type: 'string', description: 'Nota para recepción. Opcional.' },
        },
        required: ['customer_id', 'room_type', 'arrival_date', 'departure_date', 'adults'],
      },
      requiredPermissions: ['store:lodging:reservations:write'],
      requiresConfirmation: true,
      discovery: {
        synonyms: ['reservar habitación', 'crear reserva hotel', 'apartar habitación', 'reservarle al huésped'],
        examples: [
          {
            intent: 'Resérvale la doble a Juan Pérez del 10 al 13 para 2 adultos',
            arguments: {
              customer_id: 42,
              room_type: 'Doble',
              arrival_date: '2026-11-10',
              departure_date: '2026-11-13',
              adults: 2,
            },
          },
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        let plan: Awaited<ReturnType<typeof planStay>>;
        try {
          plan = await planStay(deps, args, context);
        } catch (error) {
          return { status: 'error', target: NEW_STAY, changes: [], message: errorMessage(error), domain: 'lodging' };
        }
        if ('error' in plan) {
          return { status: 'error', target: NEW_STAY, changes: [], message: plan.error, domain: 'lodging' };
        }
        const { dto, result, type, customer_name } = plan;
        const money = (amount: string) => formatMoney(amount, result.currency);
        const guests = `${dto.adults} adulto${dto.adults === 1 ? '' : 's'}${
          dto.children ? ` y ${dto.children} niño${dto.children === 1 ? '' : 's'}` : ''
        }`;
        return {
          status: type.bookable ? 'ok' : 'error',
          target: `Reserva de ${customer_name}`,
          domain: 'lodging',
          changes: [
            { field: 'room_type', label: 'Habitación', from: null, to: type.name },
            {
              field: 'stay',
              label: 'Estadía',
              from: null,
              to: `${result.arrival_date} al ${result.departure_date} · ${result.nights} noche${result.nights === 1 ? '' : 's'}`,
            },
            { field: 'guests', label: 'Huéspedes', from: null, to: guests },
            { field: 'total_amount', label: 'Total', from: null, to: money(type.total_amount) },
            { field: 'amount_due_now', label: 'Anticipo al reservar', from: null, to: money(type.amount_due_now) },
            {
              field: 'cancellation_policy',
              label: 'Política de cancelación',
              from: null,
              to: type.cancellation_policy ?? 'Sin política de cancelación',
            },
          ],
          ...(type.bookable ? {} : { message: `No se puede reservar: ${type.unavailable_reason}.` }),
        };
      },
      handler: async (args, context) => {
        try {
          const plan = await planStay(deps, args, context);
          if ('error' in plan) return guidedError(plan.error, plan.next_step);
          const { dto, type, result } = plan;
          if (!type.bookable) {
            return guidedError(
              `No se puede reservar ${type.name}: ${type.unavailable_reason}.`,
              'Ofrece otras fechas u otro tipo con quote_lodging_availability.',
            );
          }
          const reservation = await reservations.create({
            arrival_date: dto.arrival_date,
            departure_date: dto.departure_date,
            customer_id: plan.customer_id,
            rooms: [
              {
                unit_type_id: type.id,
                adults: dto.adults,
                children: dto.children ?? 0,
                ...(type.rate_plan ? { rate_plan_id: type.rate_plan.id } : {}),
              },
            ],
            ...(args.notes ? { notes: String(args.notes).trim().slice(0, 1000) } : {}),
          });
          return JSON.stringify({
            reservation_number: reservation.reservation_number,
            guest: plan.customer_name,
            room_type: type.name,
            arrival_date: result.arrival_date,
            departure_date: result.departure_date,
            nights: result.nights,
            total_amount: reservation.total_amount.toString(),
            amount_due_now: type.amount_due_now,
            cancellation_policy: type.cancellation_policy,
            status: 'Confirmada',
          });
        } catch (error) {
          return guidedError(errorMessage(error));
        }
      },
    },
  ];
}
