import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { ReservationsService } from '../../../domains/store/reservations/reservations.service';
import { AvailabilityService } from '../../../domains/store/reservations/availability.service';
import { CreateBookingDto } from '../../../domains/store/reservations/dto/create-booking.dto';
import { BookingQueryDto } from '../../../domains/store/reservations/dto/booking-query.dto';
import { RescheduleBookingDto } from '../../../domains/store/reservations/dto/reschedule-booking.dto';
import {
  ApproveRescheduleRequestDto,
  RejectRescheduleRequestDto,
} from '../../../domains/store/reservations/dto/decide-reschedule-request.dto';
import { ProvidersService } from '../../../domains/store/reservations/providers/providers.service';
import { ProviderScheduleService } from '../../../domains/store/reservations/providers/provider-schedule.service';
import { BusinessHoursService } from '../../../domains/store/reservations/business-hours/business-hours.service';
import { CreateProviderDto } from '../../../domains/store/reservations/providers/dto/create-provider.dto';
import { UpdateProviderDto } from '../../../domains/store/reservations/providers/dto/update-provider.dto';
import { AssignServiceDto } from '../../../domains/store/reservations/providers/dto/assign-service.dto';
import {
  ProviderScheduleItemDto,
  UpsertProviderScheduleDto,
} from '../../../domains/store/reservations/providers/dto/upsert-provider-schedule.dto';
import { CreateProviderExceptionDto } from '../../../domains/store/reservations/providers/dto/create-provider-exception.dto';
import { UpsertBusinessHoursDto } from '../../../domains/store/reservations/business-hours/dto/upsert-business-hours.dto';
import { booking_status_enum, order_channel_enum } from '@prisma/client';

export interface ReservationsToolDeps {
  reservationsService: ReservationsService;
  availabilityService: AvailabilityService;
  providersService: ProvidersService;
  providerScheduleService: ProviderScheduleService;
  businessHoursService: BusinessHoursService;
}

// Derivados de los enums Prisma generados — nunca copias a mano.
const BOOKING_STATUSES: readonly booking_status_enum[] = Object.values(
  booking_status_enum,
);
const BOOKING_CHANNELS: readonly order_channel_enum[] = Object.values(
  order_channel_enum,
);

/** Transiciones de O-50 con el método dueño en `ReservationsService`. */
const BOOKING_TRANSITIONS = [
  'confirm',
  'start',
  'cancel',
  'complete',
  'no_show',
  'check_in',
] as const;

type BookingTransition = (typeof BOOKING_TRANSITIONS)[number];

/** O-51: reagendar directo o decidir una solicitud pendiente. */
const RESCHEDULE_ACTIONS = ['reschedule', 'approve', 'reject'] as const;

/**
 * O-51: estados que aceptan reprogramación (espejo del gate en
 * `ReservationsService.reschedule`). El preview anticipa el rechazo en vez
 * de prometer un cambio imposible.
 */
const RESCHEDULABLE_BOOKING_STATUSES = ['pending', 'confirmed'] as const;

/** O-52: configuración de proveedores y calendario maestro. */
const PROVIDER_ACTIONS = [
  'create',
  'update',
  'assign_service',
  'remove_service',
  'set_schedule',
  'add_exception',
  'remove_exception',
  'set_business_hours',
] as const;

/** O-52: nombre legible del día para previews con sujeto humano. */
const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Máximo de slots que se serializan antes de truncar. */
const MAX_SLOTS = 30;

function clamp(value: any, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function validateEnum<const T extends string>(
  value: any,
  allowed: readonly T[],
  field: string,
): T | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = String(value);
  const match = allowed.find((option) => option === parsed);
  if (match === undefined) {
    return {
      error: `${field} "${parsed}" no existe. Valores válidos: ${allowed.join(', ')}.`,
    };
  }
  return match;
}

function isError(value: any): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value;
}

/**
 * Valida un DTO como el `ValidationPipe` global del HTTP (`whitelist` +
 * `forbidNonWhitelisted`). Mismo helper que `writes.tools.ts`.
 */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

function describeError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    if (typeof response === 'string') return response;
    const raw = response?.message;
    return Array.isArray(raw) ? raw.join('; ') : String(raw ?? error.message);
  }
  return (error as any)?.message ?? 'error desconocido';
}

function bookingCustomerName(booking: any): string {
  const customer = booking?.customer;
  if (customer) {
    const full = [customer.first_name, customer.last_name]
      .filter(Boolean)
      .join(' ');
    if (full.trim()) return full.trim();
    if (customer.email) return customer.email;
    if (customer.phone) return customer.phone;
  }
  return 'Venta anónima (sin cliente)';
}

/** "Corte de cabello — Marcela Ríos — 2026-09-12 10:00": sujeto humano. */
function bookingSubject(booking: any): string {
  const service = booking?.product?.name ?? `servicio #${booking?.product_id}`;
  return `${service} — ${bookingCustomerName(booking)} — ${booking?.date ?? '?'} ${booking?.start_time ?? ''}`.trim();
}

/** Fila compacta para listados. */
function compactBooking(booking: any) {
  return {
    booking_id: booking.id,
    numero: booking.booking_number ?? null,
    cliente: bookingCustomerName(booking),
    customer_id: booking.customer_id ?? null,
    servicio: booking.product?.name ?? null,
    product_id: booking.product_id ?? null,
    fecha: booking.date ?? null,
    inicio: booking.start_time ?? null,
    fin: booking.end_time ?? null,
    estado: booking.status,
    proveedor:
      booking.provider?.display_name ??
      [booking.provider?.employee?.first_name, booking.provider?.employee?.last_name]
        .filter(Boolean)
        .join(' ') ??
      null,
  };
}

export function createReservationsTools(
  deps: ReservationsToolDeps,
): RegisteredTool[] {
  const {
    reservationsService,
    availabilityService,
    providersService,
    providerScheduleService,
    businessHoursService,
  } = deps;

  const noStore = (what: string) =>
    JSON.stringify({
      error: `Sin tienda en contexto: ${what} está acotado por tienda.`,
    });

  const invalidBookingId = (raw: any) =>
    JSON.stringify({
      error: `booking_id inválido: "${raw}". Usa list_bookings para obtener uno válido.`,
      next_step: 'Lista las reservas con list_bookings y usa su booking_id.',
    });

  return [
    // ─── O-46 list_bookings ────────────────────────────────────────────
    {
      name: 'list_bookings',
      version: '1',
      domain: 'reservations',
      readOnly: true,
      description:
        'Lista las reservas/citas de la tienda filtradas por estado, cliente, servicio o rango de fechas, con paginación. Úsala para "¿qué citas hay mañana?", "muéstrame las reservas pendientes" o "las citas de este cliente". Devuelve filas compactas: para el detalle de una llama después a get_booking con su booking_id.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: BOOKING_STATUSES,
            description: 'Filtra por estado de la reserva.',
          },
          customer_id: {
            type: 'number',
            description:
              'Reservas de un cliente concreto. Obtén el id con find_customer.',
          },
          product_id: {
            type: 'number',
            description: 'Reservas de un servicio concreto.',
          },
          channel: {
            type: 'string',
            enum: BOOKING_CHANNELS,
            description: 'Filtra por canal de origen.',
          },
          date_from: {
            type: 'string',
            description: 'Inicio del rango YYYY-MM-DD. Opcional.',
          },
          date_to: {
            type: 'string',
            description: 'Fin del rango YYYY-MM-DD. Opcional.',
          },
          search: {
            type: 'string',
            description:
              'Texto libre contra número de reserva y notas.',
          },
          page: {
            type: 'number',
            description: 'Página, empezando en 1. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Filas por página. Por defecto 10, máximo 50.',
          },
        },
      },
      requiredPermissions: ['store:reservations:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el listado de reservas');

        const status = validateEnum(args.status, BOOKING_STATUSES, 'status');
        if (isError(status)) return JSON.stringify(status);

        const channel = validateEnum(args.channel, BOOKING_CHANNELS, 'channel');
        if (isError(channel)) return JSON.stringify(channel);

        const from = args.date_from ? String(args.date_from) : undefined;
        const to = args.date_to ? String(args.date_to) : undefined;
        if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
          return JSON.stringify({
            error: `Las fechas deben venir en formato YYYY-MM-DD. Recibido: date_from="${from ?? ''}", date_to="${to ?? ''}".`,
          });
        }
        if (from && to && from > to) {
          return JSON.stringify({
            error: `El rango está invertido: date_from (${from}) es posterior a date_to (${to}).`,
          });
        }

        const page = clamp(args.page, 1, 1000);
        const limit = clamp(args.limit, 10, 50);

        try {
          const query: BookingQueryDto = {
            page,
            limit,
            ...(args.search ? { search: String(args.search) } : {}),
            ...(status ? { status } : {}),
            ...(args.customer_id
              ? { customer_id: Number(args.customer_id) }
              : {}),
            ...(args.product_id ? { product_id: Number(args.product_id) } : {}),
            ...(channel ? { channel } : {}),
            ...(from ? { date_from: from } : {}),
            ...(to ? { date_to: to } : {}),
          };
          const result = await reservationsService.findAll(query);
          const data = (result.data ?? []).map(compactBooking);
          const { total, totalPages } = result.pagination;

          return JSON.stringify({
            paginacion: {
              total_reservas: total,
              pagina: page,
              por_pagina: limit,
              total_paginas: totalPages,
              hay_mas: page < totalPages,
            },
            mostrando: data.length,
            ...(page < totalPages && {
              nota: `Se muestran ${data.length} de ${total} reservas. Pide la página ${page + 1} si necesitas más, pero resume en vez de enumerar todo.`,
            }),
            data,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudieron listar las reservas: ${describeError(error)}`,
          });
        }
      },
    },

    // ─── O-47 get_booking ─────────────────────────────────────────────
    {
      name: 'get_booking',
      version: '1',
      domain: 'reservations',
      readOnly: true,
      description:
        'Detalle completo de UNA reserva: cliente, servicio y variante, proveedor asignado, fecha y hora, estado, notas y orden vinculada. Úsala para "¿de qué es esa cita?", "¿a qué hora es?" o antes de proponer cualquier cambio sobre la reserva. Requiere el booking_id: si solo tienes fecha o cliente, lista antes con list_bookings.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: {
            type: 'number',
            description:
              'Identificador interno de la reserva, tal como lo devuelve list_bookings.',
          },
        },
        required: ['booking_id'],
      },
      requiredPermissions: ['store:reservations:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el detalle de una reserva');

        const bookingId = Number(args.booking_id);
        if (!Number.isFinite(bookingId) || bookingId < 1) {
          return invalidBookingId(args.booking_id);
        }

        try {
          const booking: any = await reservationsService.findOne(bookingId);
          return JSON.stringify({
            reserva: {
              booking_id: booking.id,
              numero: booking.booking_number ?? null,
              estado: booking.status,
              canal: booking.channel ?? null,
              fecha: booking.date ?? null,
              inicio: booking.start_time ?? null,
              fin: booking.end_time ?? null,
              notas: booking.notes ?? null,
              creada: booking.created_at ?? null,
            },
            cliente: {
              customer_id: booking.customer_id ?? null,
              nombre: bookingCustomerName(booking),
              email: booking.customer?.email ?? null,
              telefono: booking.customer?.phone ?? null,
            },
            servicio: {
              product_id: booking.product_id ?? null,
              nombre: booking.product?.name ?? null,
              duracion_minutos:
                booking.product?.service_duration_minutes ?? null,
              variante: booking.product_variants?.name ?? null,
              variant_sku: booking.product_variants?.sku ?? null,
            },
            proveedor: booking.provider
              ? {
                  provider_id: booking.provider.id,
                  nombre:
                    booking.provider.display_name ??
                    [booking.provider.employee?.first_name, booking.provider.employee?.last_name]
                      .filter(Boolean)
                      .join(' ') ??
                    null,
                }
              : null,
            orden_vinculada: booking.order
              ? {
                  order_id: booking.order.id,
                  numero: booking.order.order_number,
                }
              : null,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se encontró la reserva ${bookingId} en esta tienda: ${describeError(error)}`,
            next_step: 'Lista las reservas con list_bookings para obtener un booking_id válido.',
          });
        }
      },
    },

    // ─── O-48 check_booking_availability ────────────────────────────────
    {
      name: 'check_booking_availability',
      version: '1',
      domain: 'reservations',
      readOnly: true,
      description:
        'Disponibilidad de un servicio: o verifica UN horario concreto (pasa start_time y end_time) o lista los slots libres en un rango de fechas. Es el paso OBLIGATORIO antes de manage_bookings: nunca propongas una reserva sin haber confirmado que el slot está libre. Respeta duración/buffer de la variante cuando pasas product_variant_id.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Servicio a consultar (producto con reserva).',
          },
          date_from: {
            type: 'string',
            description:
              'Fecha YYYY-MM-DD a consultar, o inicio del rango. Obligatoria.',
          },
          date_to: {
            type: 'string',
            description:
              'Fin del rango YYYY-MM-DD. Por defecto el mismo date_from.',
          },
          start_time: {
            type: 'string',
            description:
              'Hora HH:mm para verificar un slot concreto. Exige end_time.',
          },
          end_time: {
            type: 'string',
            description:
              'Hora HH:mm de fin del slot concreto. Exige start_time.',
          },
          provider_id: {
            type: 'number',
            description: 'Limita la consulta a un proveedor concreto. Opcional.',
          },
          product_variant_id: {
            type: 'number',
            description:
              'Variante del servicio (usa su duración/buffer efectivas). Opcional.',
          },
        },
        required: ['product_id', 'date_from'],
      },
      requiredPermissions: ['store:reservations:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la disponibilidad de reservas');

        const productId = Number(args.product_id);
        if (!Number.isFinite(productId) || productId < 1) {
          return JSON.stringify({
            error: `product_id inválido: "${args.product_id}".`,
            next_step: 'Pasa el id del servicio a consultar.',
          });
        }
        const from = String(args.date_from ?? '');
        const to = String(args.date_to ?? from);
        if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
          return JSON.stringify({
            error: `Las fechas deben venir en formato YYYY-MM-DD. Recibido: date_from="${from}", date_to="${to}".`,
          });
        }
        if (from > to) {
          return JSON.stringify({
            error: `El rango está invertido: date_from (${from}) es posterior a date_to (${to}).`,
          });
        }
        const start = args.start_time ? String(args.start_time) : undefined;
        const end = args.end_time ? String(args.end_time) : undefined;
        if ((start && !end) || (!start && end)) {
          return JSON.stringify({
            error:
              'start_time y end_time vienen en pareja: para verificar un slot concreto pasa ambas horas HH:mm.',
            next_step: 'Pasa start_time y end_time, u omite ambas para listar slots libres.',
          });
        }
        if ((start && !HH_MM.test(start)) || (end && !HH_MM.test(end))) {
          return JSON.stringify({
            error: `Las horas deben venir en formato HH:mm de 24h. Recibido: start_time="${start ?? ''}", end_time="${end ?? ''}".`,
          });
        }
        const providerId =
          args.provider_id !== undefined && args.provider_id !== null
            ? Number(args.provider_id)
            : undefined;
        const variantId =
          args.product_variant_id !== undefined &&
          args.product_variant_id !== null
            ? Number(args.product_variant_id)
            : undefined;

        try {
          if (start && end) {
            const free = await availabilityService.isSlotAvailable(
              productId,
              from,
              start,
              end,
              providerId,
            );
            if (free) {
              return JSON.stringify({
                disponible: true,
                slot: { fecha: from, inicio: start, fin: end },
                next_step:
                  'El slot está libre: puedes proponer la reserva con manage_bookings.',
              });
            }
            const alternatives = await availabilityService.getAvailableSlots(
              productId,
              from,
              from,
              {
                ...(providerId !== undefined ? { provider_id: providerId } : {}),
                ...(variantId !== undefined ? { product_variant_id: variantId } : {}),
              },
            );
            return JSON.stringify({
              disponible: false,
              slot: { fecha: from, inicio: start, fin: end },
              alternativas: alternatives.slice(0, 8).map((slot) => ({
                fecha: slot.date,
                inicio: slot.start_time,
                fin: slot.end_time,
                proveedores_disponibles: slot.total_available,
              })),
              next_step:
                'Ese horario está ocupado: ofrece al usuario una de las alternativas.',
            });
          }

          const slots = await availabilityService.getAvailableSlots(
            productId,
            from,
            to,
            {
              ...(providerId !== undefined ? { provider_id: providerId } : {}),
              ...(variantId !== undefined ? { product_variant_id: variantId } : {}),
            },
          );
          const page = slots.slice(0, MAX_SLOTS);
          return JSON.stringify({
            rango: { desde: from, hasta: to },
            slots_libres: slots.length,
            mostrando: page.length,
            ...(slots.length > page.length && {
              nota: `Se muestran ${page.length} de ${slots.length} slots: acota el rango de fechas en vez de pedirlos todos.`,
            }),
            slots: page.map((slot) => ({
              fecha: slot.date,
              inicio: slot.start_time,
              fin: slot.end_time,
              proveedores_disponibles: slot.total_available,
            })),
            next_step:
              slots.length > 0
                ? 'Elige un slot con el usuario y crea la reserva con manage_bookings.'
                : 'No hay slots libres en el rango: prueba otras fechas.',
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo consultar la disponibilidad: ${describeError(error)}`,
          });
        }
      },
    },

    // ─── O-49 manage_bookings ─────────────────────────────────────────
    {
      name: 'manage_bookings',
      version: '1',
      domain: 'reservations',
      description:
        'Crea una reserva (action=create): verifica disponibilidad con check_booking_availability PRIMERO y nunca la salta. Si el slot se ocupó entre el preview y la aprobación, el handler lo rechaza con alternativas en vez de sobre-reservar. (Reprogramar llega como P1 en reschedule_booking: aquí solo se crea.)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create'],
            description: 'Acción a ejecutar. Hoy solo create.',
          },
          product_id: {
            type: 'number',
            description: 'Servicio a reservar.',
          },
          date: {
            type: 'string',
            description: 'Fecha YYYY-MM-DD de la reserva.',
          },
          start_time: {
            type: 'string',
            description: 'Hora de inicio HH:mm (24h).',
          },
          end_time: {
            type: 'string',
            description: 'Hora de fin HH:mm (24h).',
          },
          customer_id: {
            type: 'number',
            description:
              'Cliente dueño de la reserva (find_customer). Sin cliente queda como venta anónima.',
          },
          provider_id: {
            type: 'number',
            description: 'Proveedor que atiende. Opcional.',
          },
          product_variant_id: {
            type: 'number',
            description: 'Variante del servicio. Opcional.',
          },
          notes: { type: 'string', description: 'Notas. Opcional.' },
          channel: {
            type: 'string',
            enum: BOOKING_CHANNELS,
            description: 'Canal de origen. Opcional.',
          },
          table_id: {
            type: 'number',
            description: 'Mesa a marcar como reservada. Opcional.',
          },
          order_id: {
            type: 'number',
            description: 'Orden vinculada. Opcional.',
          },
          service_location_type: {
            type: 'string',
            enum: ['home', 'shop'],
            description: 'Dónde se presta el servicio. Opcional.',
          },
          service_address_id: {
            type: 'number',
            description:
              'Dirección del cliente cuando service_location_type es home.',
          },
        },
        required: [
          'action',
          'product_id',
          'date',
          'start_time',
          'end_time',
        ],
      },
      requiredPermissions: ['store:reservations:create'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Nueva reserva',
            changes: [],
            message: 'Sin tienda en contexto: las reservas están acotadas por tienda.',
          };
        }
        if (String(args.action ?? '') !== 'create') {
          return {
            status: 'error',
            target: 'Nueva reserva',
            changes: [],
            message:
              'manage_bookings hoy solo crea (action=create). Reprogramar llega en reschedule_booking (P1).',
          };
        }
        const validated = toValidatedDto(CreateBookingDto, {
          ...(args.product_id !== undefined && {
            product_id: Number(args.product_id),
          }),
          ...(args.date ? { date: String(args.date) } : {}),
          ...(args.start_time ? { start_time: String(args.start_time) } : {}),
          ...(args.end_time ? { end_time: String(args.end_time) } : {}),
          ...(args.customer_id !== undefined && args.customer_id !== null && {
            customer_id: Number(args.customer_id),
          }),
          ...(args.provider_id !== undefined && args.provider_id !== null && {
            provider_id: Number(args.provider_id),
          }),
          ...(args.product_variant_id !== undefined &&
            args.product_variant_id !== null && {
              product_variant_id: Number(args.product_variant_id),
            }),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          ...(args.channel ? { channel: String(args.channel) } : {}),
          ...(args.table_id !== undefined && args.table_id !== null && {
            table_id: Number(args.table_id),
          }),
          ...(args.order_id !== undefined && args.order_id !== null && {
            order_id: Number(args.order_id),
          }),
          ...(args.service_location_type
            ? { service_location_type: String(args.service_location_type) }
            : {}),
          ...(args.service_address_id !== undefined &&
            args.service_address_id !== null && {
              service_address_id: Number(args.service_address_id),
            }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Nueva reserva',
            changes: [],
            message: validated.message,
          };
        }
        const dto = validated.dto;
        const date = String(dto.date).slice(0, 10);
        let free: boolean;
        try {
          free = await availabilityService.isSlotAvailable(
            dto.product_id,
            date,
            dto.start_time,
            dto.end_time,
            dto.provider_id,
          );
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Nueva reserva',
            changes: [],
            message: `No se pudo verificar la disponibilidad: ${describeError(error)}`,
          };
        }
        if (!free) {
          const alternatives = await availabilityService
            .getAvailableSlots(dto.product_id, date, date, {
              ...(dto.provider_id !== undefined
                ? { provider_id: dto.provider_id }
                : {}),
              ...(dto.product_variant_id !== undefined
                ? { product_variant_id: dto.product_variant_id }
                : {}),
            })
            .catch(() => []);
          const options = alternatives
            .slice(0, 5)
            .map((slot) => `${slot.start_time}–${slot.end_time}`)
            .join(', ');
          return {
            status: 'error',
            target: `Nueva reserva ${date} ${dto.start_time}–${dto.end_time}`,
            changes: [],
            message:
              `Ese horario ya está ocupado${options ? `; libres ese día: ${options}` : ''}. ` +
              'Elige otro slot (check_booking_availability) y vuelve a proponer.',
          };
        }
        return {
          status: 'ok',
          target: `Nueva reserva ${date} ${dto.start_time}–${dto.end_time}`,
          changes: [
            {
              field: 'horario',
              label: 'Horario',
              from: null,
              to: `${date} ${dto.start_time}–${dto.end_time}`,
            },
            {
              field: 'servicio',
              label: 'Servicio',
              from: null,
              to: `Servicio #${dto.product_id}${dto.product_variant_id ? `, variante #${dto.product_variant_id}` : ''}`,
            },
            {
              field: 'cliente',
              label: 'Cliente',
              from: null,
              to: dto.customer_id
                ? `Cliente #${dto.customer_id}`
                : 'Venta anónima (sin cliente)',
            },
            ...(dto.provider_id
              ? [
                  {
                    field: 'proveedor',
                    label: 'Proveedor',
                    from: null,
                    to: `Proveedor #${dto.provider_id}`,
                  },
                ]
              : []),
          ],
          domain: 'reservations',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la creación de reservas');
        if (String(args.action ?? '') !== 'create') {
          return JSON.stringify({
            error: 'manage_bookings hoy solo crea (action=create).',
            next_step: 'Usa action=create, o espera reschedule_booking (P1) para reprogramar.',
          });
        }
        const validated = toValidatedDto(CreateBookingDto, {
          ...(args.product_id !== undefined && {
            product_id: Number(args.product_id),
          }),
          ...(args.date ? { date: String(args.date) } : {}),
          ...(args.start_time ? { start_time: String(args.start_time) } : {}),
          ...(args.end_time ? { end_time: String(args.end_time) } : {}),
          ...(args.customer_id !== undefined && args.customer_id !== null && {
            customer_id: Number(args.customer_id),
          }),
          ...(args.provider_id !== undefined && args.provider_id !== null && {
            provider_id: Number(args.provider_id),
          }),
          ...(args.product_variant_id !== undefined &&
            args.product_variant_id !== null && {
              product_variant_id: Number(args.product_variant_id),
            }),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          ...(args.channel ? { channel: String(args.channel) } : {}),
          ...(args.table_id !== undefined && args.table_id !== null && {
            table_id: Number(args.table_id),
          }),
          ...(args.order_id !== undefined && args.order_id !== null && {
            order_id: Number(args.order_id),
          }),
          ...(args.service_location_type
            ? { service_location_type: String(args.service_location_type) }
            : {}),
          ...(args.service_address_id !== undefined &&
            args.service_address_id !== null && {
              service_address_id: Number(args.service_address_id),
            }),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer la reserva.',
          });
        }
        const dto = validated.dto;
        const date = String(dto.date).slice(0, 10);
        try {
          const free = await availabilityService.isSlotAvailable(
            dto.product_id,
            date,
            dto.start_time,
            dto.end_time,
            dto.provider_id,
          );
          if (!free) {
            const alternatives = await availabilityService
              .getAvailableSlots(dto.product_id, date, date, {
                ...(dto.provider_id !== undefined
                  ? { provider_id: dto.provider_id }
                  : {}),
                ...(dto.product_variant_id !== undefined
                  ? { product_variant_id: dto.product_variant_id }
                  : {}),
              })
              .catch(() => []);
            return JSON.stringify({
              error: `El slot ${date} ${dto.start_time}–${dto.end_time} se ocupó antes de aplicar.`,
              alternativas: alternatives.slice(0, 8).map((slot) => ({
                fecha: slot.date,
                inicio: slot.start_time,
                fin: slot.end_time,
                proveedores_disponibles: slot.total_available,
              })),
              next_step:
                'Elige una alternativa con check_booking_availability y vuelve a proponer.',
            });
          }
          const created: any = await reservationsService.create(dto);
          return JSON.stringify({
            reserva_creada: {
              booking_id: created.id,
              numero: created.booking_number ?? null,
              estado: created.status,
              fecha: created.date ?? date,
              inicio: created.start_time ?? dto.start_time,
              fin: created.end_time ?? dto.end_time,
            },
            next_step:
              'La reserva quedó creada. Usa transition_booking (confirm) para confirmarla.',
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo crear la reserva: ${describeError(error)}`,
            next_step:
              'Verifica disponibilidad con check_booking_availability y reintenta.',
          });
        }
      },
    },

    // ─── O-50 transition_booking ───────────────────────────────────────
    {
      name: 'transition_booking',
      version: '1',
      domain: 'reservations',
      description:
        'Mueve una reserva en su ciclo de vida: confirm (pending→confirmed), start (→in_progress), cancel, complete, no_show o check_in (registra la llegada desde el staff). Lee primero get_booking para conocer el estado actual: cada transición parte de un estado válido y el service rechaza las que no aplican.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: {
            type: 'number',
            description:
              'Identificador interno de la reserva. Lista con list_bookings.',
          },
          action: {
            type: 'string',
            enum: BOOKING_TRANSITIONS,
            description:
              'Transición: confirm, start, cancel, complete, no_show o check_in.',
          },
        },
        required: ['booking_id', 'action'],
      },
      requiredPermissions: ['store:reservations:update'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Mover reserva',
            changes: [],
            message: 'Sin tienda en contexto: las reservas están acotadas por tienda.',
          };
        }
        const bookingId = Number(args.booking_id);
        if (!Number.isFinite(bookingId) || bookingId < 1) {
          return {
            status: 'error',
            target: 'Mover reserva',
            changes: [],
            message: `booking_id inválido: "${args.booking_id}". Usa list_bookings para obtener uno válido.`,
          };
        }
        const action = String(args.action ?? '');
        if (!(BOOKING_TRANSITIONS as readonly string[]).includes(action)) {
          return {
            status: 'error',
            target: 'Mover reserva',
            changes: [],
            message: `action "${action}" no existe. Valores válidos: ${BOOKING_TRANSITIONS.join(', ')}.`,
          };
        }
        let booking: any;
        try {
          booking = await reservationsService.findOne(bookingId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Mover reserva',
            changes: [],
            message: `No se encontró la reserva ${bookingId} en esta tienda: ${describeError(error)}`,
          };
        }
        return {
          status: action === 'cancel' || action === 'no_show' ? 'warning' : 'ok',
          target: `Reserva ${booking.booking_number ?? `#${booking.id}`}: ${bookingSubject(booking)}`,
          changes: [
            {
              field: 'transicion',
              label: 'Transición',
              from: booking.status,
              to: action,
            },
          ],
          ...(action === 'cancel' || action === 'no_show'
            ? {
                message:
                  'Esta transición cierra la reserva: verifica con el usuario que es lo que quiere.',
              }
            : {}),
          domain: 'reservations',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('las transiciones de reservas');
        const bookingId = Number(args.booking_id);
        if (!Number.isFinite(bookingId) || bookingId < 1) {
          return invalidBookingId(args.booking_id);
        }
        const action = String(args.action ?? '') as BookingTransition;
        if (!(BOOKING_TRANSITIONS as readonly string[]).includes(action)) {
          return JSON.stringify({
            error: `action "${args.action}" no existe. Valores válidos: ${BOOKING_TRANSITIONS.join(', ')}.`,
            next_step: 'Elige una transición válida y reintenta.',
          });
        }
        try {
          const before: any = await reservationsService.findOne(bookingId);
          let after: any;
          switch (action) {
            case 'confirm':
              after = await reservationsService.confirm(bookingId);
              break;
            case 'start':
              after = await reservationsService.start(bookingId);
              break;
            case 'cancel':
              after = await reservationsService.cancel(bookingId);
              break;
            case 'complete':
              after = await reservationsService.complete(bookingId);
              break;
            case 'no_show':
              after = await reservationsService.noShow(bookingId);
              break;
            case 'check_in':
              after = await reservationsService.checkIn(bookingId, 'staff');
              break;
            default:
              return JSON.stringify({
                error: `action "${args.action}" no existe.`,
                next_step: 'Elige una transición válida y reintenta.',
              });
          }
          return JSON.stringify({
            transicion: {
              booking_id: bookingId,
              numero: after?.booking_number ?? before?.booking_number ?? null,
              estado_anterior: before?.status ?? null,
              estado: after?.status ?? null,
            },
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo mover la reserva: ${describeError(error)}`,
            next_step:
              'Lee la reserva con get_booking: cada transición parte de un estado válido.',
          });
        }
      },
    },

    // ─── O-51 reschedule_booking ───────────────────────────────────────
    {
      name: 'reschedule_booking',
      version: '1',
      domain: 'reservations',
      description:
        'Reprograma una reserva (action=reschedule) o decide una solicitud pendiente (approve/reject). Cadena OBLIGATORIA: lee primero get_booking para conocer estado y horario actual. Solo pending/confirmed se mueven; el slot nuevo se verifica libre (excluyendo la propia reserva) en el preview y se re-verifica al aplicar. Si la tienda exige aprobación, reschedule crea una solicitud pendiente en vez de mover la cita.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: RESCHEDULE_ACTIONS,
            description:
              'reschedule: mover la cita (exige booking_id + date + start_time + end_time). approve/reject: decidir una solicitud (exige request_id; reject exige decision_reason).',
          },
          booking_id: {
            type: 'number',
            description:
              'Reserva a mover. Lista con list_bookings, detalla con get_booking.',
          },
          date: {
            type: 'string',
            description: 'Nueva fecha YYYY-MM-DD.',
          },
          start_time: {
            type: 'string',
            description: 'Nueva hora de inicio HH:mm (24h).',
          },
          end_time: {
            type: 'string',
            description: 'Nueva hora de fin HH:mm (24h).',
          },
          reason: {
            type: 'string',
            description:
              'Motivo del cambio. Opcional; queda en la solicitud si la tienda exige aprobación.',
          },
          request_id: {
            type: 'number',
            description:
              'Solicitud pendiente a decidir (approve/reject).',
          },
          decision_reason: {
            type: 'string',
            description:
              'Obligatorio al rechazar (el cliente lo recibe; mínimo 3 caracteres). Opcional al aprobar.',
          },
        },
        required: ['action'],
      },
      requiredPermissions: ['store:reservations:update'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Reprogramar reserva',
            changes: [],
            message: 'Sin tienda en contexto: las reservas están acotadas por tienda.',
          };
        }
        const action = String(args.action ?? '');
        if (!(RESCHEDULE_ACTIONS as readonly string[]).includes(action)) {
          return {
            status: 'error',
            target: 'Reprogramar reserva',
            changes: [],
            message: `action "${action}" no existe. Valores válidos: ${RESCHEDULE_ACTIONS.join(', ')}.`,
          };
        }
        if (action === 'reschedule') {
          const bookingId = Number(args.booking_id);
          if (!Number.isFinite(bookingId) || bookingId < 1) {
            return {
              status: 'error',
              target: 'Reprogramar reserva',
              changes: [],
              message: `booking_id inválido: "${args.booking_id}". Usa list_bookings para obtener uno válido.`,
            };
          }
          const validated = toValidatedDto(RescheduleBookingDto, {
            ...(args.date ? { date: String(args.date) } : {}),
            ...(args.start_time
              ? { start_time: String(args.start_time) }
              : {}),
            ...(args.end_time ? { end_time: String(args.end_time) } : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: 'Reprogramar reserva',
              changes: [],
              message: validated.message,
            };
          }
          let booking: any;
          try {
            booking = await reservationsService.findOne(bookingId);
          } catch (error: any) {
            return {
              status: 'error',
              target: 'Reprogramar reserva',
              changes: [],
              message: `No se encontró la reserva ${bookingId} en esta tienda: ${describeError(error)}`,
            };
          }
          if (
            !(RESCHEDULABLE_BOOKING_STATUSES as readonly string[]).includes(
              booking.status,
            )
          ) {
            return {
              status: 'error',
              target: `Reprogramar ${bookingSubject(booking)}`,
              changes: [],
              message: `La reserva está en estado '${booking.status}': solo se reprograma desde '${RESCHEDULABLE_BOOKING_STATUSES.join("' o '")}'.`,
            };
          }
          const dto = validated.dto;
          const date = String(dto.date).slice(0, 10);
          let free: boolean;
          try {
            free = await availabilityService.isSlotAvailable(
              booking.product_id,
              date,
              dto.start_time,
              dto.end_time,
              booking.provider_id ?? undefined,
              booking.id,
            );
          } catch (error: any) {
            return {
              status: 'error',
              target: `Reprogramar ${bookingSubject(booking)}`,
              changes: [],
              message: `No se pudo verificar la disponibilidad: ${describeError(error)}`,
            };
          }
          if (!free) {
            const alternatives = await availabilityService
              .getAvailableSlots(booking.product_id, date, date, {
                ...(booking.provider_id !== undefined &&
                booking.provider_id !== null
                  ? { provider_id: booking.provider_id }
                  : {}),
              })
              .catch(() => []);
            const options = alternatives
              .slice(0, 5)
              .map((slot) => `${slot.start_time}–${slot.end_time}`)
              .join(', ');
            return {
              status: 'error',
              target: `Reprogramar ${bookingSubject(booking)}`,
              changes: [],
              message:
                `El horario ${date} ${dto.start_time}–${dto.end_time} está ocupado${options ? `; libres ese día: ${options}` : ''}. ` +
                'Elige otro slot (check_booking_availability) y vuelve a proponer.',
            };
          }
          return {
            status: 'ok',
            target: `Reprogramar ${bookingSubject(booking)}`,
            changes: [
              {
                field: 'horario',
                label: 'Horario',
                from: `${String(booking.date).slice(0, 10)} ${booking.start_time}–${booking.end_time}`,
                to: `${date} ${dto.start_time}–${dto.end_time}`,
              },
            ],
            message:
              'Si la tienda exige aprobación, esto crea una solicitud pendiente en vez de mover la cita.',
            domain: 'reservations',
          };
        }
        const requestId = Number(args.request_id);
        if (!Number.isFinite(requestId) || requestId < 1) {
          return {
            status: 'error',
            target: 'Decidir solicitud de reagenda',
            changes: [],
            message: `request_id inválido: "${args.request_id}".`,
          };
        }
        if (action === 'reject') {
          const validated = toValidatedDto(RejectRescheduleRequestDto, {
            ...(args.decision_reason
              ? { decision_reason: String(args.decision_reason) }
              : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: 'Rechazar solicitud de reagenda',
              changes: [],
              message: validated.message,
            };
          }
        }
        let request: any;
        try {
          request = await reservationsService.getRescheduleRequestForAgent(
            context.store_id,
            requestId,
          );
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Decidir solicitud de reagenda',
            changes: [],
            message: `No se pudo leer la solicitud ${requestId}: ${describeError(error)}`,
          };
        }
        if (!request) {
          return {
            status: 'error',
            target: 'Decidir solicitud de reagenda',
            changes: [],
            message: `La solicitud ${requestId} no existe en esta tienda.`,
          };
        }
        if (request.status !== 'pending') {
          return {
            status: 'error',
            target: `Solicitud #${requestId}`,
            changes: [],
            message: `La solicitud ya está en estado '${request.status}': solo las pendientes se deciden.`,
          };
        }
        const booking = request.booking ?? {};
        const from = `${String(booking.date ?? '?').slice(0, 10)} ${booking.start_time ?? ''}–${booking.end_time ?? ''}`.trim();
        const to = `${String(request.requested_date).slice(0, 10)} ${request.requested_start_time}–${request.requested_end_time}`;
        if (action === 'approve') {
          return {
            status: 'ok',
            target: `Aprobar reagenda #${requestId}: ${booking.product?.name ?? 'servicio'} — ${bookingCustomerName({ customer: booking.customer })}`,
            changes: [
              {
                field: 'solicitud',
                label: 'Solicitud',
                from: 'pending',
                to: 'approved',
              },
              { field: 'horario', label: 'Horario', from, to },
            ],
            domain: 'reservations',
          };
        }
        return {
          status: 'warning',
          target: `Rechazar reagenda #${requestId}: ${booking.product?.name ?? 'servicio'} — ${bookingCustomerName({ customer: booking.customer })}`,
          changes: [
            {
              field: 'solicitud',
              label: 'Solicitud',
              from: 'pending',
              to: 'rejected',
            },
            {
              field: 'motivo',
              label: 'Motivo (lo recibe el cliente)',
              from: null,
              to: String(args.decision_reason),
            },
          ],
          message: 'La reserva queda en su horario original.',
          domain: 'reservations',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la reprogramación de reservas');
        const action = String(args.action ?? '');
        if (!(RESCHEDULE_ACTIONS as readonly string[]).includes(action)) {
          return JSON.stringify({
            error: `action "${action}" no existe. Valores válidos: ${RESCHEDULE_ACTIONS.join(', ')}.`,
            next_step: 'Elige reschedule, approve o reject y reintenta.',
          });
        }
        if (action === 'reschedule') {
          const bookingId = Number(args.booking_id);
          if (!Number.isFinite(bookingId) || bookingId < 1) {
            return JSON.stringify({
              error: `booking_id inválido: "${args.booking_id}".`,
              next_step: 'Lista las reservas con list_bookings y usa su booking_id.',
            });
          }
          const validated = toValidatedDto(RescheduleBookingDto, {
            ...(args.date ? { date: String(args.date) } : {}),
            ...(args.start_time
              ? { start_time: String(args.start_time) }
              : {}),
            ...(args.end_time ? { end_time: String(args.end_time) } : {}),
          });
          if (!validated.ok) {
            return JSON.stringify({
              error: validated.message,
              next_step: 'Corrige los campos indicados y vuelve a proponer.',
            });
          }
          try {
            const before: any =
              await reservationsService.findOne(bookingId);
            if (
              !(RESCHEDULABLE_BOOKING_STATUSES as readonly string[]).includes(
                before.status,
              )
            ) {
              return JSON.stringify({
                error: `La reserva cambió a estado '${before.status}': solo se reprograma desde '${RESCHEDULABLE_BOOKING_STATUSES.join("' o '")}'.`,
                next_step: 'Lee la reserva con get_booking para ver su estado actual.',
              });
            }
            const dto = validated.dto;
            const date = String(dto.date).slice(0, 10);
            const free = await availabilityService.isSlotAvailable(
              before.product_id,
              date,
              dto.start_time,
              dto.end_time,
              before.provider_id ?? undefined,
              before.id,
            );
            if (!free) {
              const alternatives = await availabilityService
                .getAvailableSlots(before.product_id, date, date, {
                  ...(before.provider_id !== undefined &&
                  before.provider_id !== null
                    ? { provider_id: before.provider_id }
                    : {}),
                })
                .catch(() => []);
              return JSON.stringify({
                error: `El slot ${date} ${dto.start_time}–${dto.end_time} se ocupó antes de aplicar.`,
                alternativas: alternatives.slice(0, 8).map((slot) => ({
                  fecha: slot.date,
                  inicio: slot.start_time,
                  fin: slot.end_time,
                  proveedores_disponibles: slot.total_available,
                })),
                next_step:
                  'Elige una alternativa con check_booking_availability y vuelve a proponer.',
              });
            }
            const after: any = await reservationsService.reschedule(
              bookingId,
              dto,
            );
            // El service enruta según la política de la tienda: si movió la
            // cita, la fecha/hora volvió cambiada; si exige aprobación, la
            // devuelve intacta y crea la solicitud pendiente.
            const moved =
              String(after?.date ?? '').slice(0, 10) === date &&
              after?.start_time === dto.start_time &&
              after?.end_time === dto.end_time;
            if (!moved) {
              return JSON.stringify({
                solicitud_creada: {
                  booking_id: bookingId,
                  numero: after?.booking_number ?? null,
                  horario_actual: `${String(after?.date ?? '').slice(0, 10)} ${after?.start_time ?? ''}–${after?.end_time ?? ''}`.trim(),
                  horario_solicitado: `${date} ${dto.start_time}–${dto.end_time}`,
                },
                nota: 'La tienda exige aprobación: la cita NO se movió y quedó una solicitud pendiente. Decídela con action=approve o reject.',
              });
            }
            return JSON.stringify({
              reprogramacion: {
                booking_id: bookingId,
                numero: after?.booking_number ?? null,
                horario_anterior: `${String(before.date).slice(0, 10)} ${before.start_time}–${before.end_time}`,
                horario: `${date} ${dto.start_time}–${dto.end_time}`,
                estado: after?.status ?? null,
              },
            });
          } catch (error: any) {
            return JSON.stringify({
              error: `No se pudo reprogramar: ${describeError(error)}`,
              next_step:
                'Lee la reserva con get_booking y verifica el slot con check_booking_availability.',
            });
          }
        }
        const userId = Number(context.user_id);
        if (!Number.isFinite(userId) || userId < 1) {
          return JSON.stringify({
            error: 'Sin usuario en contexto: decidir una solicitud exige saber quién la decide (auditoría).',
            next_step: 'Reintenta desde una sesión autenticada.',
          });
        }
        const requestId = Number(args.request_id);
        if (!Number.isFinite(requestId) || requestId < 1) {
          return JSON.stringify({
            error: `request_id inválido: "${args.request_id}".`,
            next_step: 'Pasa el id de la solicitud pendiente a decidir.',
          });
        }
        try {
          const current: any =
            await reservationsService.getRescheduleRequestForAgent(
              context.store_id as number,
              requestId,
            );
          if (!current) {
            return JSON.stringify({
              error: `La solicitud ${requestId} no existe en esta tienda.`,
              next_step: 'Verifica el request_id y reintenta.',
            });
          }
          if (current.status !== 'pending') {
            return JSON.stringify({
              error: `La solicitud ya está en estado '${current.status}': solo las pendientes se deciden.`,
              next_step: 'Pide una solicitud pendiente y reintenta.',
            });
          }
          if (action === 'approve') {
            const validated = toValidatedDto(ApproveRescheduleRequestDto, {
              ...(args.decision_reason
                ? { decision_reason: String(args.decision_reason) }
                : {}),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige el motivo y reintenta.',
              });
            }
            await reservationsService.approveRescheduleRequest(requestId, {
              decidedByUserId: userId,
              ...(validated.dto.decision_reason
                ? { decisionReason: validated.dto.decision_reason }
                : {}),
            });
            return JSON.stringify({
              decision: {
                request_id: requestId,
                resultado: 'approved',
                booking_id: current.booking_id,
                horario_aplicado: `${String(current.requested_date).slice(0, 10)} ${current.requested_start_time}–${current.requested_end_time}`,
              },
              nota: 'La solicitud quedó aprobada y la reserva se movió al slot solicitado.',
            });
          }
          const validated = toValidatedDto(RejectRescheduleRequestDto, {
            ...(args.decision_reason
              ? { decision_reason: String(args.decision_reason) }
              : {}),
          });
          if (!validated.ok) {
            return JSON.stringify({
              error: validated.message,
              next_step: 'Indica un motivo de al menos 3 caracteres y reintenta.',
            });
          }
          await reservationsService.rejectRescheduleRequest(requestId, {
            decidedByUserId: userId,
            decisionReason: validated.dto.decision_reason,
          });
          return JSON.stringify({
            decision: {
              request_id: requestId,
              resultado: 'rejected',
              booking_id: current.booking_id,
              motivo: validated.dto.decision_reason,
            },
            nota: 'La solicitud quedó rechazada y la reserva sigue en su horario original.',
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo decidir la solicitud: ${describeError(error)}`,
            next_step: 'Verifica que la solicitud siga pendiente y reintenta.',
          });
        }
      },
    },

    // ─── O-52 manage_booking_providers ──────────────────────────────────
    {
      name: 'manage_booking_providers',
      version: '1',
      domain: 'reservations',
      description:
        'Configuración de reservas: crea/edita proveedores (quién atiende), les asigna o quita servicios, define su horario semanal y sus excepciones (vacaciones, días no disponibles), y edita el calendario maestro de la tienda (business_hours) contra el que se intersecta toda disponibilidad. Es configuración, no operación diaria: usala cuando el usuario pida cambiar el equipo o los horarios.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: PROVIDER_ACTIONS,
            description:
              'create/update: alta y edición de proveedor. assign_service/remove_service: vínculo proveedor↔servicio. set_schedule: reemplaza el horario semanal. add_exception/remove_exception: días no disponibles. set_business_hours: reemplaza el calendario maestro de la tienda.',
          },
          provider_id: {
            type: 'number',
            description: 'Proveedor objetivo (todo salvo create y set_business_hours).',
          },
          employee_id: {
            type: 'number',
            description: 'Empleado a dar de alta como proveedor (solo create).',
          },
          display_name: {
            type: 'string',
            description: 'Nombre visible del proveedor.',
          },
          avatar_url: { type: 'string', description: 'Foto. Opcional.' },
          bio: { type: 'string', description: 'Presentación. Opcional.' },
          is_active: {
            type: 'boolean',
            description: 'Activa o desactiva al proveedor (solo update).',
          },
          sort_order: {
            type: 'number',
            description: 'Orden en listados (solo update).',
          },
          product_id: {
            type: 'number',
            description: 'Servicio a asignar o quitar (assign/remove_service).',
          },
          schedule: {
            type: 'array',
            description:
              'Horario semanal COMPLETO que reemplaza al actual: [{day_of_week 0-6 (0=domingo), start_time HH:mm, end_time HH:mm, block_order?, is_active?}].',
            items: { type: 'object' },
          },
          exception: {
            type: 'object',
            description:
              'Excepción a crear: {date YYYY-MM-DD, is_unavailable? (default true), custom_start_time?, custom_end_time?, reason?}.',
          },
          exception_id: {
            type: 'number',
            description: 'Excepción a eliminar (remove_exception).',
          },
          business_hours: {
            type: 'array',
            description:
              'Calendario maestro COMPLETO: [{day_of_week 0-6, start_time HH:mm, end_time HH:mm, is_active?}]. Los días omitidos se DESACTIVAN.',
            items: { type: 'object' },
          },
        },
        required: ['action'],
      },
      // AND fail-closed: la mayoría de acciones son `reservations:update`,
      // pero `set_business_hours` toca el calendario maestro, cuyo dueño HTTP
      // exige `business_hours:write`. El registry solo sabe AND, así que la
      // tool exige ambos y nadie configura horarios por la puerta de atrás.
      requiredPermissions: [
        'store:reservations:update',
        'store:business_hours:write',
      ],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Configurar proveedores',
            changes: [],
            message: 'Sin tienda en contexto: los proveedores están acotados por tienda.',
          };
        }
        const action = String(args.action ?? '');
        if (!(PROVIDER_ACTIONS as readonly string[]).includes(action)) {
          return {
            status: 'error',
            target: 'Configurar proveedores',
            changes: [],
            message: `action "${action}" no existe. Valores válidos: ${PROVIDER_ACTIONS.join(', ')}.`,
          };
        }
        const providerName = (provider: any): string =>
          provider?.display_name ??
          [provider?.employee?.first_name, provider?.employee?.last_name]
            .filter(Boolean)
            .join(' ') ??
          `Proveedor #${provider?.id ?? args.provider_id}`;
        const needProvider = async (): Promise<any | ToolPreview> => {
          const providerId = Number(args.provider_id);
          if (!Number.isFinite(providerId) || providerId < 1) {
            return {
              status: 'error',
              target: 'Configurar proveedores',
              changes: [],
              message: `provider_id inválido: "${args.provider_id}".`,
            };
          }
          try {
            return await providersService.findOne(providerId);
          } catch (error: any) {
            return {
              status: 'error',
              target: 'Configurar proveedores',
              changes: [],
              message: `No se encontró el proveedor ${providerId} en esta tienda: ${describeError(error)}`,
            };
          }
        };
        const isPreview = (value: any): value is ToolPreview =>
          !!value && typeof value === 'object' && 'status' in value;

        if (action === 'create') {
          const validated = toValidatedDto(CreateProviderDto, {
            ...(args.employee_id !== undefined &&
              args.employee_id !== null && {
                employee_id: Number(args.employee_id),
              }),
            ...(args.display_name
              ? { display_name: String(args.display_name) }
              : {}),
            ...(args.avatar_url ? { avatar_url: String(args.avatar_url) } : {}),
            ...(args.bio ? { bio: String(args.bio) } : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: 'Nuevo proveedor',
              changes: [],
              message: validated.message,
            };
          }
          return {
            status: 'ok',
            target: `Nuevo proveedor${validated.dto.display_name ? `: ${validated.dto.display_name}` : ''}`,
            changes: [
              {
                field: 'empleado',
                label: 'Empleado',
                from: null,
                to: `Empleado #${validated.dto.employee_id}`,
              },
              ...(validated.dto.display_name
                ? [
                    {
                      field: 'nombre',
                      label: 'Nombre visible',
                      from: null,
                      to: validated.dto.display_name,
                    },
                  ]
                : []),
            ],
            domain: 'reservations',
          };
        }
        if (action === 'update') {
          const provider = await needProvider();
          if (isPreview(provider)) return provider;
          const validated = toValidatedDto(UpdateProviderDto, {
            ...(args.display_name
              ? { display_name: String(args.display_name) }
              : {}),
            ...(args.avatar_url ? { avatar_url: String(args.avatar_url) } : {}),
            ...(args.bio ? { bio: String(args.bio) } : {}),
            ...(args.is_active !== undefined && args.is_active !== null
              ? { is_active: args.is_active === true }
              : {}),
            ...(args.sort_order !== undefined && args.sort_order !== null
              ? { sort_order: Number(args.sort_order) }
              : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: `Editar ${providerName(provider)}`,
              changes: [],
              message: validated.message,
            };
          }
          const dto = validated.dto as Record<string, any>;
          const labels: Record<string, string> = {
            display_name: 'Nombre visible',
            avatar_url: 'Foto',
            bio: 'Presentación',
            is_active: 'Activo',
            sort_order: 'Orden',
          };
          const changes = Object.keys(labels)
            .filter(
              (field) => dto[field] !== undefined && dto[field] !== null,
            )
            .map((field) => ({
              field,
              label: labels[field],
              from: provider[field] ?? null,
              to: dto[field],
            }));
          if (!changes.length) {
            return {
              status: 'error',
              target: `Editar ${providerName(provider)}`,
              changes: [],
              message:
                'No hay nada que cambiar: pasa al menos uno de display_name, avatar_url, bio, is_active o sort_order.',
            };
          }
          return {
            status: 'ok',
            target: `Editar ${providerName(provider)}`,
            changes,
            domain: 'reservations',
          };
        }
        if (action === 'assign_service' || action === 'remove_service') {
          const provider = await needProvider();
          if (isPreview(provider)) return provider;
          const productId = Number(args.product_id);
          if (!Number.isFinite(productId) || productId < 1) {
            return {
              status: 'error',
              target: `${action === 'assign_service' ? 'Asignar' : 'Quitar'} servicio`,
              changes: [],
              message: `product_id inválido: "${args.product_id}".`,
            };
          }
          if (action === 'assign_service') {
            const validated = toValidatedDto(AssignServiceDto, {
              product_id: productId,
            });
            if (!validated.ok) {
              return {
                status: 'error',
                target: 'Asignar servicio',
                changes: [],
                message: validated.message,
              };
            }
          }
          return {
            status: action === 'remove_service' ? 'warning' : 'ok',
            target: `${action === 'assign_service' ? 'Asignar' : 'Quitar'} servicio #${productId} ${action === 'assign_service' ? 'a' : 'de'} ${providerName(provider)}`,
            changes: [
              {
                field: 'servicio',
                label: 'Servicio',
                from: action === 'assign_service' ? null : `Servicio #${productId}`,
                to: action === 'assign_service' ? `Servicio #${productId}` : null,
              },
            ],
            ...(action === 'remove_service'
              ? {
                  message:
                    'El proveedor dejará de ofrecerse para ese servicio en la disponibilidad.',
                }
              : {}),
            domain: 'reservations',
          };
        }
        if (action === 'set_schedule') {
          const provider = await needProvider();
          if (isPreview(provider)) return provider;
          const rawItems = Array.isArray(args.schedule) ? args.schedule : [];
          const validated = toValidatedDto(UpsertProviderScheduleDto, {
            items: rawItems.map((row: any) => ({
              ...(row?.day_of_week !== undefined && {
                day_of_week: Number(row.day_of_week),
              }),
              ...(row?.block_order !== undefined && {
                block_order: Number(row.block_order),
              }),
              ...(row?.start_time ? { start_time: String(row.start_time) } : {}),
              ...(row?.end_time ? { end_time: String(row.end_time) } : {}),
              ...(row?.is_active !== undefined
                ? { is_active: row.is_active === true }
                : {}),
            })),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: `Horario de ${providerName(provider)}`,
              changes: [],
              message: validated.message,
            };
          }
          const summary = validated.dto.items
            .map(
              (item) =>
                `${DAY_NAMES[item.day_of_week]} ${item.start_time}–${item.end_time}${item.is_active === false ? ' (inactivo)' : ''}`,
            )
            .join(', ');
          return {
            status: 'ok',
            target: `Horario de ${providerName(provider)}`,
            changes: [
              {
                field: 'horario',
                label: 'Horario semanal (reemplaza al actual)',
                from: 'actual',
                to: summary,
              },
            ],
            domain: 'reservations',
          };
        }
        if (action === 'add_exception') {
          const provider = await needProvider();
          if (isPreview(provider)) return provider;
          const raw = (args.exception ?? {}) as Record<string, any>;
          const validated = toValidatedDto(CreateProviderExceptionDto, {
            ...(raw.date ? { date: String(raw.date) } : {}),
            ...(raw.is_unavailable !== undefined
              ? { is_unavailable: raw.is_unavailable === true }
              : {}),
            ...(raw.custom_start_time
              ? { custom_start_time: String(raw.custom_start_time) }
              : {}),
            ...(raw.custom_end_time
              ? { custom_end_time: String(raw.custom_end_time) }
              : {}),
            ...(raw.reason ? { reason: String(raw.reason) } : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: `Excepción de ${providerName(provider)}`,
              changes: [],
              message: validated.message,
            };
          }
          return {
            status: 'ok',
            target: `No disponible ${validated.dto.date} — ${providerName(provider)}`,
            changes: [
              {
                field: 'excepcion',
                label: 'Día no disponible',
                from: null,
                to: `${validated.dto.date}${validated.dto.reason ? ` (${validated.dto.reason})` : ''}`,
              },
            ],
            domain: 'reservations',
          };
        }
        if (action === 'remove_exception') {
          const exceptionId = Number(args.exception_id);
          if (!Number.isFinite(exceptionId) || exceptionId < 1) {
            return {
              status: 'error',
              target: 'Eliminar excepción',
              changes: [],
              message: `exception_id inválido: "${args.exception_id}".`,
            };
          }
          return {
            status: 'warning',
            target: `Eliminar excepción #${exceptionId}`,
            changes: [
              {
                field: 'excepcion',
                label: 'Excepción',
                from: `#${exceptionId}`,
                to: null,
              },
            ],
            message: 'El día volverá a regirse por el horario semanal normal.',
            domain: 'reservations',
          };
        }
        // set_business_hours
        const rawItems = Array.isArray(args.business_hours)
          ? args.business_hours
          : [];
        const validated = toValidatedDto(UpsertBusinessHoursDto, {
          items: rawItems.map((row: any) => ({
            ...(row?.day_of_week !== undefined && {
              day_of_week: Number(row.day_of_week),
            }),
            ...(row?.start_time ? { start_time: String(row.start_time) } : {}),
            ...(row?.end_time ? { end_time: String(row.end_time) } : {}),
            ...(row?.is_active !== undefined
              ? { is_active: row.is_active === true }
              : {}),
          })),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Calendario maestro de la tienda',
            changes: [],
            message: validated.message,
          };
        }
        for (const item of validated.dto.items) {
          if (item.start_time >= item.end_time) {
            return {
              status: 'error',
              target: 'Calendario maestro de la tienda',
              changes: [],
              message: `Día ${item.day_of_week} (${DAY_NAMES[item.day_of_week]}): end_time (${item.end_time}) debe ser mayor que start_time (${item.start_time}).`,
            };
          }
        }
        const sent = new Set(validated.dto.items.map((item) => item.day_of_week));
        const omitted = [0, 1, 2, 3, 4, 5, 6]
          .filter((day) => !sent.has(day))
          .map((day) => DAY_NAMES[day]);
        return {
          status: 'warning',
          target: 'Calendario maestro de la tienda',
          changes: validated.dto.items.map((item) => ({
            field: `dia_${item.day_of_week}`,
            label: DAY_NAMES[item.day_of_week],
            from: 'actual',
            to:
              item.is_active === false
                ? 'cerrado'
                : `${item.start_time}–${item.end_time}`,
          })),
          message:
            `Reemplaza TODO el calendario: ${omitted.length ? `los días omitidos (${omitted.join(', ')}) se DESACTIVAN` : 'los 7 días quedan definidos'}. ` +
            'Ningún proveedor podrá reservarse fuera de estas ventanas.',
          domain: 'reservations',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id)
          return noStore('la configuración de proveedores');
        const action = String(args.action ?? '');
        if (!(PROVIDER_ACTIONS as readonly string[]).includes(action)) {
          return JSON.stringify({
            error: `action "${action}" no existe. Valores válidos: ${PROVIDER_ACTIONS.join(', ')}.`,
            next_step: 'Elige una acción válida y reintenta.',
          });
        }
        const providerName = (provider: any): string =>
          provider?.display_name ??
          [provider?.employee?.first_name, provider?.employee?.last_name]
            .filter(Boolean)
            .join(' ') ??
          `Proveedor #${provider?.id ?? args.provider_id}`;
        try {
          if (action === 'create') {
            const validated = toValidatedDto(CreateProviderDto, {
              ...(args.employee_id !== undefined &&
                args.employee_id !== null && {
                  employee_id: Number(args.employee_id),
                }),
              ...(args.display_name
                ? { display_name: String(args.display_name) }
                : {}),
              ...(args.avatar_url
                ? { avatar_url: String(args.avatar_url) }
                : {}),
              ...(args.bio ? { bio: String(args.bio) } : {}),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige los campos indicados y vuelve a proponer.',
              });
            }
            const created: any = await providersService.create(validated.dto);
            return JSON.stringify({
              proveedor_creado: {
                provider_id: created?.id ?? null,
                nombre: providerName(created),
              },
              next_step:
                'Asígnale servicios (assign_service) y horario (set_schedule) para que aparezca disponible.',
            });
          }
          if (action === 'set_business_hours') {
            const rawItems = Array.isArray(args.business_hours)
              ? args.business_hours
              : [];
            const validated = toValidatedDto(UpsertBusinessHoursDto, {
              items: rawItems.map((row: any) => ({
                ...(row?.day_of_week !== undefined && {
                  day_of_week: Number(row.day_of_week),
                }),
                ...(row?.start_time
                  ? { start_time: String(row.start_time) }
                  : {}),
                ...(row?.end_time ? { end_time: String(row.end_time) } : {}),
                ...(row?.is_active !== undefined
                  ? { is_active: row.is_active === true }
                  : {}),
              })),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige los días indicados y vuelve a proponer.',
              });
            }
            for (const item of validated.dto.items) {
              if (item.start_time >= item.end_time) {
                return JSON.stringify({
                  error: `Día ${item.day_of_week} (${DAY_NAMES[item.day_of_week]}): end_time debe ser mayor que start_time.`,
                  next_step: 'Corrige el día indicado y reintenta.',
                });
              }
            }
            await businessHoursService.upsertAll(
              context.store_id as number,
              validated.dto,
            );
            return JSON.stringify({
              calendario_maestro: {
                dias_definidos: validated.dto.items.length,
              },
              nota: 'El calendario maestro quedó reemplazado: los días omitidos se desactivaron.',
            });
          }
          // Resto de acciones: re-verifican que el proveedor siga existiendo.
          const providerId = Number(args.provider_id);
          if (!Number.isFinite(providerId) || providerId < 1) {
            return JSON.stringify({
              error: `provider_id inválido: "${args.provider_id}".`,
              next_step: 'Pasa el id del proveedor a configurar.',
            });
          }
          const provider: any =
            await providersService.findOne(providerId);
          if (action === 'update') {
            const validated = toValidatedDto(UpdateProviderDto, {
              ...(args.display_name
                ? { display_name: String(args.display_name) }
                : {}),
              ...(args.avatar_url
                ? { avatar_url: String(args.avatar_url) }
                : {}),
              ...(args.bio ? { bio: String(args.bio) } : {}),
              ...(args.is_active !== undefined && args.is_active !== null
                ? { is_active: args.is_active === true }
                : {}),
              ...(args.sort_order !== undefined && args.sort_order !== null
                ? { sort_order: Number(args.sort_order) }
                : {}),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige los campos indicados y vuelve a proponer.',
              });
            }
            const dto = validated.dto as Record<string, any>;
            if (
              !['display_name', 'avatar_url', 'bio', 'is_active', 'sort_order'].some(
                (field) => dto[field] !== undefined && dto[field] !== null,
              )
            ) {
              return JSON.stringify({
                error: 'No hay nada que cambiar.',
                next_step:
                  'Pasa al menos uno de display_name, avatar_url, bio, is_active o sort_order.',
              });
            }
            const updated: any = await providersService.update(
              providerId,
              validated.dto,
            );
            return JSON.stringify({
              proveedor_actualizado: {
                provider_id: providerId,
                nombre: providerName(updated ?? provider),
              },
            });
          }
          if (action === 'assign_service') {
            const productId = Number(args.product_id);
            if (!Number.isFinite(productId) || productId < 1) {
              return JSON.stringify({
                error: `product_id inválido: "${args.product_id}".`,
                next_step: 'Pasa el id del servicio a asignar.',
              });
            }
            await providersService.assignService(providerId, productId);
            return JSON.stringify({
              asignacion: {
                provider_id: providerId,
                proveedor: providerName(provider),
                product_id: productId,
              },
              nota: 'El proveedor ya ofrece ese servicio en la disponibilidad.',
            });
          }
          if (action === 'remove_service') {
            const productId = Number(args.product_id);
            if (!Number.isFinite(productId) || productId < 1) {
              return JSON.stringify({
                error: `product_id inválido: "${args.product_id}".`,
                next_step: 'Pasa el id del servicio a quitar.',
              });
            }
            await providersService.removeService(providerId, productId);
            return JSON.stringify({
              remocion: {
                provider_id: providerId,
                proveedor: providerName(provider),
                product_id: productId,
              },
              nota: 'El proveedor dejó de ofrecerse para ese servicio.',
            });
          }
          if (action === 'set_schedule') {
            const rawItems = Array.isArray(args.schedule) ? args.schedule : [];
            const validated = toValidatedDto(UpsertProviderScheduleDto, {
              items: rawItems.map((row: any) => ({
                ...(row?.day_of_week !== undefined && {
                  day_of_week: Number(row.day_of_week),
                }),
                ...(row?.block_order !== undefined && {
                  block_order: Number(row.block_order),
                }),
                ...(row?.start_time
                  ? { start_time: String(row.start_time) }
                  : {}),
                ...(row?.end_time ? { end_time: String(row.end_time) } : {}),
                ...(row?.is_active !== undefined
                  ? { is_active: row.is_active === true }
                  : {}),
              })),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige el horario indicado y vuelve a proponer.',
              });
            }
            await providerScheduleService.upsertSchedule(
              providerId,
              validated.dto.items,
            );
            return JSON.stringify({
              horario: {
                provider_id: providerId,
                proveedor: providerName(provider),
                bloques: validated.dto.items.length,
              },
              nota: 'El horario semanal quedó reemplazado.',
            });
          }
          if (action === 'add_exception') {
            const raw = (args.exception ?? {}) as Record<string, any>;
            const validated = toValidatedDto(CreateProviderExceptionDto, {
              ...(raw.date ? { date: String(raw.date) } : {}),
              ...(raw.is_unavailable !== undefined
                ? { is_unavailable: raw.is_unavailable === true }
                : {}),
              ...(raw.custom_start_time
                ? { custom_start_time: String(raw.custom_start_time) }
                : {}),
              ...(raw.custom_end_time
                ? { custom_end_time: String(raw.custom_end_time) }
                : {}),
              ...(raw.reason ? { reason: String(raw.reason) } : {}),
            });
            if (!validated.ok) {
              return JSON.stringify({
                error: validated.message,
                next_step: 'Corrige la excepción indicada y vuelve a proponer.',
              });
            }
            const created: any =
              await providerScheduleService.createException(
                providerId,
                validated.dto,
              );
            return JSON.stringify({
              excepcion_creada: {
                exception_id: created?.id ?? null,
                provider_id: providerId,
                fecha: validated.dto.date,
              },
            });
          }
          // remove_exception
          const exceptionId = Number(args.exception_id);
          if (!Number.isFinite(exceptionId) || exceptionId < 1) {
            return JSON.stringify({
              error: `exception_id inválido: "${args.exception_id}".`,
              next_step: 'Pasa el id de la excepción a eliminar.',
            });
          }
          await providerScheduleService.deleteException(exceptionId);
          return JSON.stringify({
            excepcion_eliminada: { exception_id: exceptionId },
            nota: 'El día vuelve a regirse por el horario semanal normal.',
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo aplicar el cambio: ${describeError(error)}`,
            next_step: 'Verifica los ids (proveedor, servicio, excepción) y reintenta.',
          });
        }
      },
    },
  ];
}
