import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { dispatch_route_status_enum } from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { DispatchRoutesService } from '../../../domains/store/dispatch-routes/dispatch-routes.service';
import { RouteFlowService } from '../../../domains/store/dispatch-routes/route-flow/route-flow.service';
import { DispatchNotesService } from '../../../domains/store/dispatch-notes/dispatch-notes.service';
import { DispatchRouteQueryDto } from '../../../domains/store/dispatch-routes/dto/dispatch-route-query.dto';
import { SettleStopDto } from '../../../domains/store/dispatch-routes/dto/settle-stop.dto';
import { ReleaseStopDto } from '../../../domains/store/dispatch-routes/dto/release-stop.dto';
import { CloseDispatchRouteDto } from '../../../domains/store/dispatch-routes/dto/close-dispatch-route.dto';
import { VoidDispatchRouteDto } from '../../../domains/store/dispatch-routes/dto/void-dispatch-route.dto';
import { CreateFromOrderDto } from '../../../domains/store/dispatch-notes/dto/create-from-order.dto';
import { CreateFromOrdersBatchDto } from '../../../domains/store/dispatch-notes/dto/create-from-orders-batch.dto';
import { UpdateDispatchNoteDto } from '../../../domains/store/dispatch-notes/dto/update-dispatch-note.dto';

export interface DispatchToolDeps {
  dispatchRoutesService: DispatchRoutesService;
  routeFlowService: RouteFlowService;
  dispatchNotesService: DispatchNotesService;
}

const ROUTE_STATUSES = Object.values(dispatch_route_status_enum);
// Parada binaria: terminal = entregada, rechazada o liberada. `partial` solo
// existe como lectura histórica; ninguna liquidación puede producirlo.
const TERMINAL_STOP_STATUSES = ['delivered', 'rejected', 'released'];
const SETTLE_RESULTS = ['delivered', 'rejected'];
const TRANSITION_ACTIONS = [
  'dispatch',
  'start',
  'settle',
  'release',
  'close',
  'void',
];
const NOTE_ACTIONS = [
  'create_from_order',
  'create_from_orders_batch',
  'update',
  'remove',
];

function toolError(
  message: string,
  nextStep?: string,
  code?: string,
): string {
  return JSON.stringify({
    error: message,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(code ? { code } : {}),
  });
}

function previewError(
  target: string,
  message: string,
  domain = 'dispatch',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

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

function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as
      | { message?: unknown; error_code?: string }
      | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return {
      ...(response?.error_code && { code: response.error_code }),
      message,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactRoute(r: any) {
  const driver = r.is_primary_driver_external
    ? (r.external_driver_name ?? null)
    : [r.driver_user?.first_name, r.driver_user?.last_name]
        .filter(Boolean)
        .join(' ') || null;
  return {
    route_id: r.id,
    route_number: r.route_number,
    route_code: r.route_code ?? null,
    status: r.status,
    planned_date: r.planned_date ?? null,
    driver,
    vehicle_plate: r.vehicle?.plate ?? null,
    stops_count:
      r._count?.stops ?? (Array.isArray(r.stops) ? r.stops.length : undefined),
    total_to_collect: toNumberOrNull(r.total_to_collect),
    total_collected: toNumberOrNull(r.total_collected),
    total_prepaid: toNumberOrNull(r.total_prepaid),
    cash_variance: toNumberOrNull(r.cash_variance),
  };
}

function compactStop(s: any) {
  const note = s.dispatch_note ?? null;
  return {
    stop_id: s.id,
    stop_sequence: s.stop_sequence,
    status: s.status,
    result: s.result ?? null,
    is_extra_route: s.is_extra_route ?? false,
    is_prepaid: s.is_prepaid ?? false,
    dispatch_note_id: s.dispatch_note_id,
    dispatch_number: note?.dispatch_number ?? null,
    customer: note?.customer_name ?? note?.customer ?? null,
    grand_total: toNumberOrNull(note?.grand_total),
    collected_amount: toNumberOrNull(s.collected_amount),
    anticipo_amount: toNumberOrNull(s.anticipo_amount),
    change_amount: toNumberOrNull(s.change_amount),
    withholding_amount: toNumberOrNull(s.withholding_amount),
    payment_method: s.payment_method ?? null,
    settled_at: s.settled_at ?? null,
    released_at: s.released_at ?? null,
  };
}

function compactNote(n: any) {
  return {
    dispatch_note_id: n.id,
    dispatch_number: n.dispatch_number,
    status: n.status,
    direction: n.direction ?? null,
    subtype: n.subtype ?? null,
    customer: n.customer_name ?? null,
    grand_total: toNumberOrNull(n.grand_total),
    order_id: n.order_id ?? n.sales_order_id ?? null,
    emission_date: n.emission_date ?? null,
    agreed_delivery_date: n.agreed_delivery_date ?? null,
    items_count: Array.isArray(n.dispatch_note_items)
      ? n.dispatch_note_items.length
      : undefined,
  };
}

/**
 * D-1 / D-3 / D-5 — Dispatch P0 (paso 8 reportes-ops, track B).
 *
 * La ruta es un AGREGADO que orquesta: los writes delegan en
 * `RouteFlowService` / `DispatchNotesService`, que emiten
 * `payment.received` / `refund.completed` / `cash_register.movement` — la tool
 * jamás duplica contabilidad, caja ni cartera.
 *
 * Cadenas de validación: D-3 exige D-1 (estado ruta/paradas) previo; D-5 lee
 * la remisión (`findOne`) en preview y re-verifica borrador en el handler.
 * Parada binaria: pago TOTAL o `rejected`; `result=partial` se rechaza en el
 * borde con DISPATCH_ROUTE_PARTIAL_DISABLED, sin llegar al servicio.
 */
export function createDispatchTools(deps: DispatchToolDeps): RegisteredTool[] {
  const { dispatchRoutesService, routeFlowService, dispatchNotesService } =
    deps;

  async function loadRouteOrPreviewError(
    routeId: number,
  ): Promise<{ ok: true; route: any } | { ok: false; preview: ToolPreview }> {
    try {
      const route = await dispatchRoutesService.findOne(routeId);
      return { ok: true, route };
    } catch (error) {
      const info = describeError(error);
      return {
        ok: false,
        preview: previewError(
          `Planilla #${routeId}`,
          info.message ||
            `La planilla ${routeId} no existe en esta tienda.`,
        ),
      };
    }
  }

  function findStop(route: any, stopId: number): any | null {
    return (
      (route.stops ?? []).find((s: any) => Number(s.id) === stopId) ?? null
    );
  }

  function nonTerminalStops(route: any): any[] {
    return (route.stops ?? []).filter(
      (s: any) => !TERMINAL_STOP_STATUSES.includes(String(s.status)),
    );
  }

  return [
    // ─── D-1: list_dispatch_routes (READ) ────────────────────────────────
    {
      name: 'list_dispatch_routes',
      version: '1',
      domain: 'dispatch',
      readOnly: true,
      description:
        'Lista planillas de despacho (rutas DSD) con filtros por estado, conductor, vehículo o fecha, o devuelve el detalle de una planilla (paradas + conciliación) cuando pasas route_id. Con include_stats agrega el conteo por estado y con include_monitor el monitor económico por ruta (recaudo, flete, margen). Es la cadena obligatoria antes de transition_route_stop: lee primero el estado de la ruta y sus paradas.',
      parameters: {
        type: 'object',
        properties: {
          route_id: {
            type: 'number',
            description:
              'Devuelve el detalle de UNA planilla: paradas con su remisión, montos cobrados y conciliación. Úsalo antes de proponer dispatch/start/settle/release/close/void.',
          },
          status: {
            type: 'string',
            enum: ROUTE_STATUSES,
            description:
              'Filtra el listado por estado (draft, dispatched, in_transit, closed, voided).',
          },
          search: {
            type: 'string',
            description:
              'Texto libre: número de planilla, código de ruta o conductor externo.',
          },
          vehicle_id: { type: 'number', description: 'Filtra por vehículo.' },
          driver_user_id: {
            type: 'number',
            description: 'Filtra por conductor interno.',
          },
          date_from: {
            type: 'string',
            description:
              'Fecha planeada desde (YYYY-MM-DD). Requiere date_to.',
          },
          date_to: {
            type: 'string',
            description: 'Fecha planeada hasta (YYYY-MM-DD).',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máximo 50).',
          },
          include_stats: {
            type: 'boolean',
            description:
              'Agrega el conteo de planillas por estado y los totales agregados (por defecto false).',
          },
          include_monitor: {
            type: 'boolean',
            description:
              'Agrega el monitor económico por ruta: recaudo, ingreso de flete, costo de transporte y margen (por defecto false).',
          },
        },
      },
      requiredPermissions: ['store:dispatch_routes:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: las planillas están acotadas por tenant.',
          });
        }

        if (
          args.status !== undefined &&
          !ROUTE_STATUSES.includes(args.status)
        ) {
          return JSON.stringify({
            error: `status "${args.status}" inválido. Valores válidos: ${ROUTE_STATUSES.join(', ')}.`,
          });
        }

        try {
          const routeId = toPositiveInt(args.route_id);
          if (args.route_id !== undefined && !routeId) {
            return JSON.stringify({ error: 'route_id inválido.' });
          }

          // Detalle: la cadena de validación de D-3.
          if (routeId) {
            const route = await dispatchRoutesService.findOne(routeId);
            const stops = (route.stops ?? []).map(compactStop);
            const pendientes = stops.filter(
              (s: any) => !TERMINAL_STOP_STATUSES.includes(String(s.status)),
            ).length;
            return JSON.stringify({
              planilla: {
                ...compactRoute(route),
                dispatch_started_at: route.dispatch_started_at ?? null,
                closed_at: route.closed_at ?? null,
                declared_cash: toNumberOrNull(route.declared_cash),
                paradas: stops,
                paradas_sin_liquidar: pendientes,
                conciliacion: route.reconciliation ?? null,
              },
            });
          }

          const query: DispatchRouteQueryDto = {
            page: Math.max(Number(args.page) || 1, 1),
            limit: Math.min(Math.max(Number(args.limit) || 10, 1), 50),
            ...(args.status ? { status: args.status } : {}),
            ...(args.search ? { search: String(args.search) } : {}),
            ...(args.vehicle_id
              ? { vehicle_id: Number(args.vehicle_id) }
              : {}),
            ...(args.driver_user_id
              ? { driver_user_id: Number(args.driver_user_id) }
              : {}),
            ...(args.date_from ? { date_from: String(args.date_from) } : {}),
            ...(args.date_to ? { date_to: String(args.date_to) } : {}),
          };
          const [result, stats, monitor] = await Promise.all([
            dispatchRoutesService.findAll(query),
            args.include_stats
              ? dispatchRoutesService.getStats()
              : Promise.resolve(null),
            args.include_monitor
              ? dispatchRoutesService.getMonitor({
                  page: query.page,
                  limit: query.limit,
                })
              : Promise.resolve(null),
          ]);
          const rows = (result.data ?? []).map(compactRoute);

          return JSON.stringify({
            resumen: `${rows.length} planilla(s) de ${result.pagination?.total ?? rows.length} en total`,
            pagina: result.pagination?.page ?? 1,
            paginas: result.pagination?.totalPages ?? 1,
            planillas: rows,
            ...(stats ? { stats } : {}),
            ...(monitor
              ? {
                  monitor: {
                    filas: monitor.data ?? [],
                    paginacion: monitor.pagination ?? null,
                  },
                }
              : {}),
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo leer las planillas: ${info.message}`,
            next_step:
              'Verifica el route_id con list_dispatch_routes sin filtros: la planilla puede no existir en esta tienda.',
          });
        }
      },
    },

    // ─── D-3: transition_route_stop (WRITE) ─────────────────────────────
    {
      name: 'transition_route_stop',
      version: '1',
      domain: 'dispatch',
      description:
        'Avanza una planilla por su máquina de estados: dispatch (draft→dispatched), start (parada pending→in_progress), settle (liquida con delivered/rejected + montos), release (libera la remisión para reasignarla), close (cierra con declared_cash y calcula cash_variance) y void (anula). Lee PRIMERO la planilla con list_dispatch_routes + route_id. La parada es binaria: pago TOTAL o rejected — partial se rechaza y en ruta no hay crédito.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: TRANSITION_ACTIONS,
            description:
              'Transición: dispatch, start, settle, release, close o void.',
          },
          route_id: {
            type: 'number',
            description: 'ID de la planilla (resuélvelo con list_dispatch_routes).',
          },
          stop_id: {
            type: 'number',
            description:
              'ID de la parada (requerido para start, settle y release).',
          },
          result: {
            type: 'string',
            enum: ['delivered', 'rejected'],
            description:
              'Resultado del settle: delivered (pago total o prepaga) o rejected (no recibió o no pagó completo).',
          },
          collected_amount: {
            type: 'number',
            description: 'Efectivo cobrado en la parada (settle).',
          },
          anticipo_amount: {
            type: 'number',
            description: 'Anticipo aplicado en la parada (settle).',
          },
          change_amount: {
            type: 'number',
            description:
              'Vueltas entregadas al cliente; se registran como refund (settle).',
          },
          withholding_amount: {
            type: 'number',
            description:
              'Retención total sufrida retefuente+reteiva+reteica (settle). Debe igualar la suma del desglose.',
          },
          withholding_breakdown: {
            type: 'object',
            description:
              'Desglose {retefuente, reteiva, reteica}. Obligatorio si el cliente es agente retenedor y el resultado es delivered.',
            properties: {
              retefuente: { type: 'number' },
              reteiva: { type: 'number' },
              reteica: { type: 'number' },
            },
          },
          payment_method: {
            type: 'string',
            description: 'cash (por defecto), transfer o card (settle).',
          },
          notes: { type: 'string', description: 'Notas (settle/close/void).' },
          reason: {
            type: 'string',
            description:
              'Motivo (requerido para release y void, mínimo 3 caracteres en void).',
          },
          declared_cash: {
            type: 'number',
            description:
              'Efectivo físico que trae el conductor (requerido para close, ≥0).',
          },
        },
        required: ['action', 'route_id'],
      },
      requiredPermissions: [
        'store:dispatch_routes:dispatch',
        'store:dispatch_routes:settle',
        'store:dispatch_routes:release_stop',
        'store:dispatch_routes:close',
        'store:dispatch_routes:void',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (!TRANSITION_ACTIONS.includes(action)) {
          return previewError(
            'Planilla',
            `action "${action}" inválida. Usa ${TRANSITION_ACTIONS.join(', ')}.`,
          );
        }
        // Borde binario: `partial` no existe como resultado de liquidación.
        // Se rechaza aquí (y de nuevo en el handler) sin tocar el servicio.
        if (String((args as any).result ?? '') === 'partial') {
          return previewError(
            'Planilla',
            'Las entregas parciales no están habilitadas en ruta (DISPATCH_ROUTE_PARTIAL_DISABLED): el pago debe ser total. Marca delivered con pago completo o rejected.',
          );
        }
        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Planilla',
            'Sin tienda ni organización en contexto.',
          );
        }
        const routeId = toPositiveInt(args.route_id);
        if (!routeId) {
          return previewError('Planilla', 'route_id inválido.');
        }

        try {
          const loaded = await loadRouteOrPreviewError(routeId);
          if (!loaded.ok) return loaded.preview;
          const route = loaded.route;
          const subject = `Planilla ${route.route_number ?? `#${routeId}`}`;
          const needsStop = ['start', 'settle', 'release'].includes(action);
          let stop: any = null;
          if (needsStop) {
            const stopId = toPositiveInt(args.stop_id);
            if (!stopId) {
              return previewError(
                subject,
                `${action} exige stop_id: léelo en list_dispatch_routes con route_id ${routeId}.`,
              );
            }
            stop = findStop(route, stopId);
            if (!stop) {
              return previewError(
                subject,
                `La parada ${stopId} no pertenece a esta planilla.`,
              );
            }
          }
          const stopSubject = stop
            ? ` — parada ${stop.stop_sequence ?? `#${stop.id}`} (${stop.dispatch_note?.dispatch_number ?? `remisión #${stop.dispatch_note_id}`})`
            : '';

          switch (action) {
            case 'dispatch': {
              if (route.status !== 'draft') {
                return previewError(
                  subject,
                  `Solo se puede despachar desde 'draft' (actual: '${route.status}').`,
                );
              }
              if ((route.stops ?? []).length === 0) {
                return previewError(subject, 'La planilla no tiene paradas.');
              }
              return {
                status: 'ok',
                target: `${subject} (${route.stops.length} parada(s))`,
                changes: [
                  {
                    field: 'status',
                    label: 'Estado',
                    from: 'draft',
                    to: 'dispatched (bloquea la lista de paradas)',
                  },
                ],
                message:
                  'Al despachar se confirman las remisiones en borrador y se reconcilian las órdenes vinculadas.',
                domain: 'dispatch',
              };
            }
            case 'start': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return previewError(
                  `${subject}${stopSubject}`,
                  `No se puede iniciar liquidación en planilla '${route.status}'. Despáchala primero.`,
                );
              }
              if (stop.status !== 'pending') {
                return previewError(
                  `${subject}${stopSubject}`,
                  `La parada está '${stop.status}'; solo se inicia desde 'pending'.`,
                );
              }
              return {
                status: 'ok',
                target: `${subject}${stopSubject}`,
                changes: [
                  {
                    field: 'stop_status',
                    label: 'Parada',
                    from: 'pending',
                    to: 'in_progress',
                  },
                  ...(route.status === 'dispatched'
                    ? [
                        {
                          field: 'route_status',
                          label: 'Planilla',
                          from: 'dispatched',
                          to: 'in_transit (automático al primer start)',
                        },
                      ]
                    : []),
                ],
                domain: 'dispatch',
              };
            }
            case 'settle': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return previewError(
                  `${subject}${stopSubject}`,
                  `No se puede liquidar en planilla '${route.status}'.`,
                );
              }
              if (TERMINAL_STOP_STATUSES.includes(String(stop.status))) {
                return previewError(
                  `${subject}${stopSubject}`,
                  `La parada ya está '${stop.status}'.`,
                );
              }
              const result = String(args.result ?? '');
              if (!SETTLE_RESULTS.includes(result)) {
                return previewError(
                  `${subject}${stopSubject}`,
                  `result "${result || '—'}" inválido: usa delivered (pago total) o rejected.`,
                );
              }
              const validated = toValidatedDto(SettleStopDto, {
                result,
                ...(args.collected_amount !== undefined
                  ? { collected_amount: args.collected_amount }
                  : {}),
                ...(args.anticipo_amount !== undefined
                  ? { anticipo_amount: args.anticipo_amount }
                  : {}),
                ...(args.change_amount !== undefined
                  ? { change_amount: args.change_amount }
                  : {}),
                ...(args.withholding_amount !== undefined
                  ? { withholding_amount: args.withholding_amount }
                  : {}),
                ...(args.withholding_breakdown !== undefined
                  ? { withholding_breakdown: args.withholding_breakdown }
                  : {}),
                ...(args.payment_method
                  ? { payment_method: String(args.payment_method) }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
              });
              if (!validated.ok) {
                return previewError(
                  `${subject}${stopSubject}`,
                  validated.message,
                );
              }
              const collected = Number(args.collected_amount ?? 0);
              const anticipo = Number(args.anticipo_amount ?? 0);
              const withholding = Number(args.withholding_amount ?? 0);
              const grandTotal = toNumberOrNull(
                stop.dispatch_note?.grand_total,
              );
              const changes = [
                {
                  field: 'result',
                  label: 'Resultado',
                  from: stop.status,
                  to: result,
                },
                {
                  field: 'collected_amount',
                  label: 'Cobrado',
                  from: Number(stop.collected_amount ?? 0),
                  to: collected,
                },
              ];
              if (result === 'delivered' && grandTotal !== null) {
                const covered = collected + anticipo + withholding;
                if (covered < grandTotal && !stop.is_prepaid) {
                  return {
                    status: 'error',
                    target: `${subject}${stopSubject}`,
                    changes,
                    message: `Pago incompleto: cubre ${covered} de ${grandTotal}. En ruta no hay crédito ni parciales: cobra el total o marca rejected.`,
                    domain: 'dispatch',
                  };
                }
              }
              return {
                status: 'ok',
                target: `${subject}${stopSubject}`,
                changes,
                message:
                  result === 'delivered'
                    ? 'Al liquidar se emite payment.received (caja/cartera/comisiones) y, si hay vueltas, refund.completed. Sin crédito en ruta.'
                    : 'Rejected no mueve caja: la remisión queda sin cobro y la ruta puede cerrar igual.',
                domain: 'dispatch',
              };
            }
            case 'release': {
              if (TERMINAL_STOP_STATUSES.includes(String(stop.status))) {
                return previewError(
                  `${subject}${stopSubject}`,
                  `La parada ya está '${stop.status}'.`,
                );
              }
              const reason = String(args.reason ?? '').trim();
              if (!reason) {
                return previewError(
                  `${subject}${stopSubject}`,
                  'release exige reason: el motivo queda en la auditoría.',
                );
              }
              return {
                status: 'ok',
                target: `${subject}${stopSubject}`,
                changes: [
                  {
                    field: 'stop_status',
                    label: 'Parada',
                    from: stop.status,
                    to: `released ("${reason}")`,
                  },
                ],
                message:
                  'La remisión queda libre para reasignarla a otra planilla.',
                domain: 'dispatch',
              };
            }
            case 'close': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return previewError(
                  subject,
                  `Solo se cierra desde 'dispatched' o 'in_transit' (actual: '${route.status}').`,
                );
              }
              const pending = nonTerminalStops(route);
              if (pending.length > 0) {
                return previewError(
                  subject,
                  `Hay ${pending.length} parada(s) sin liquidar. Liquida o libera todas las paradas antes de cerrar (mezclar delivered/rejected/released sí está permitido).`,
                );
              }
              const declared = toNumberOrNull(args.declared_cash);
              if (declared === null || declared < 0) {
                return previewError(
                  subject,
                  'close exige declared_cash (efectivo físico del conductor, ≥0).',
                );
              }
              const cashCollected = (route.stops ?? [])
                .filter((s: any) => (s.payment_method ?? 'cash') === 'cash')
                .reduce(
                  (sum: number, s: any) =>
                    sum + Number(s.collected_amount ?? 0),
                  0,
                );
              const variance =
                Math.round((declared - cashCollected) * 100) / 100;
              return {
                status: variance === 0 ? 'ok' : 'warning',
                target: subject,
                changes: [
                  {
                    field: 'status',
                    label: 'Estado',
                    from: route.status,
                    to: 'closed (inmutable)',
                  },
                  {
                    field: 'declared_cash',
                    label: 'Efectivo declarado',
                    from: null,
                    to: declared,
                  },
                  {
                    field: 'cash_variance',
                    label: 'Varianza proyectada',
                    from: null,
                    to: variance,
                  },
                ],
                message:
                  variance === 0
                    ? 'El cierre cuadra exacto.'
                    : variance > 0
                      ? `Sobrante proyectado de ${variance}: el conductor trae más de lo cobrado.`
                      : `Faltante proyectado de ${Math.abs(variance)}: el conductor trae menos de lo cobrado.`,
                domain: 'dispatch',
              };
            }
            case 'void': {
              if (['closed', 'voided'].includes(route.status)) {
                return previewError(
                  subject,
                  `No se puede anular una planilla '${route.status}'.`,
                );
              }
              const reason = String(args.reason ?? '').trim();
              if (reason.length < 3) {
                return previewError(
                  subject,
                  'void exige reason de al menos 3 caracteres.',
                );
              }
              return {
                status: 'warning',
                target: subject,
                changes: [
                  {
                    field: 'status',
                    label: 'Estado',
                    from: route.status,
                    to: `voided ("${reason}")`,
                  },
                ],
                message: 'Anular es terminal: la planilla sale del flujo.',
                domain: 'dispatch',
              };
            }
            default:
              return previewError(subject, `action "${action}" no soportada.`);
          }
        } catch (error) {
          const info = describeError(error);
          return previewError(
            `Planilla #${routeId}`,
            `No se pudo proyectar la transición: ${info.message}`,
          );
        }
      },
      handler: async (args, context) => {
        const action = String(args.action ?? '');
        if (!TRANSITION_ACTIONS.includes(action)) {
          return toolError(
            `action "${action}" inválida. Usa ${TRANSITION_ACTIONS.join(', ')}.`,
          );
        }
        if (String((args as any).result ?? '') === 'partial') {
          return toolError(
            'Las entregas parciales no están habilitadas en ruta: el pago debe ser total. Marca delivered con pago completo o rejected.',
            'Si el cliente no pagó completo, liquida con result rejected.',
            'DISPATCH_ROUTE_PARTIAL_DISABLED',
          );
        }
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error: 'Sin tienda ni organización en contexto.',
          });
        }
        const routeId = toPositiveInt(args.route_id);
        if (!routeId) return JSON.stringify({ error: 'route_id inválido.' });

        try {
          // Re-verificación: el preview es proyección, no transacción — el
          // mundo pudo moverse entre la aprobación y el apply.
          const route = await dispatchRoutesService.findOne(routeId);
          const needsStop = ['start', 'settle', 'release'].includes(action);
          let stop: any = null;
          if (needsStop) {
            const stopId = toPositiveInt(args.stop_id);
            if (!stopId) {
              return toolError(
                `${action} exige stop_id.`,
                `Lee los stop_id en list_dispatch_routes con route_id ${routeId}.`,
              );
            }
            stop = findStop(route, stopId);
            if (!stop) {
              return toolError(
                `La parada ${stopId} no pertenece a la planilla ${route.route_number ?? routeId}.`,
                `Lee las paradas vigentes con list_dispatch_routes + route_id ${routeId}: la planilla pudo cambiar tras el preview.`,
              );
            }
            if (
              action !== 'release' &&
              action === 'start' &&
              stop.status !== 'pending'
            ) {
              return toolError(
                `La parada ya no está 'pending' (actual: '${stop.status}').`,
                'Re-lee la planilla y propón la transición que corresponda al estado actual.',
              );
            }
            if (
              ['settle', 'release'].includes(action) &&
              TERMINAL_STOP_STATUSES.includes(String(stop.status))
            ) {
              return toolError(
                `La parada ya está '${stop.status}'.`,
                'Re-lee la planilla: otra sesión pudo liquidarla tras el preview.',
              );
            }
          }

          switch (action) {
            case 'dispatch': {
              if (route.status !== 'draft') {
                return toolError(
                  `La planilla ya no está 'draft' (actual: '${route.status}').`,
                  'Re-lee la planilla y continúa desde su estado actual.',
                );
              }
              const updated = await routeFlowService.dispatch(routeId);
              return JSON.stringify({
                planilla: updated.route_number ?? routeId,
                transicion: 'draft → dispatched',
                paradas: (updated.stops ?? []).length,
                next_step:
                  'En ruta, marca cada parada con start y liquídala con settle (o libérala con release).',
              });
            }
            case 'start': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return toolError(
                  `La planilla está '${route.status}': primero despáchala.`,
                );
              }
              const updated = await routeFlowService.startStop(
                routeId,
                Number(stop.id),
              );
              return JSON.stringify({
                planilla: route.route_number ?? routeId,
                parada: stop.stop_sequence ?? stop.id,
                transicion: 'pending → in_progress',
                estado_parada: updated.status,
                ...(route.status === 'dispatched'
                  ? { planilla_auto: 'dispatched → in_transit' }
                  : {}),
              });
            }
            case 'settle': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return toolError(
                  `La planilla está '${route.status}': no se puede liquidar.`,
                );
              }
              const result = String(args.result ?? '');
              if (!SETTLE_RESULTS.includes(result)) {
                return toolError(
                  `result "${result || '—'}" inválido: usa delivered o rejected.`,
                );
              }
              const validated = toValidatedDto(SettleStopDto, {
                result,
                ...(args.collected_amount !== undefined
                  ? { collected_amount: args.collected_amount }
                  : {}),
                ...(args.anticipo_amount !== undefined
                  ? { anticipo_amount: args.anticipo_amount }
                  : {}),
                ...(args.change_amount !== undefined
                  ? { change_amount: args.change_amount }
                  : {}),
                ...(args.withholding_amount !== undefined
                  ? { withholding_amount: args.withholding_amount }
                  : {}),
                ...(args.withholding_breakdown !== undefined
                  ? { withholding_breakdown: args.withholding_breakdown }
                  : {}),
                ...(args.payment_method
                  ? { payment_method: String(args.payment_method) }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const updated = await routeFlowService.settleStop(
                routeId,
                Number(stop.id),
                validated.dto,
              );
              return JSON.stringify({
                planilla: route.route_number ?? routeId,
                parada: stop.stop_sequence ?? stop.id,
                remision: stop.dispatch_note?.dispatch_number ?? null,
                resultado: updated.result ?? result,
                cobrado: Number(updated.collected_amount ?? 0),
                vueltas: Number(updated.change_amount ?? 0),
                retencion: Number(updated.withholding_amount ?? 0),
                next_step:
                  'Cuando todas las paradas estén liquidadas o liberadas, cierra con close + declared_cash.',
              });
            }
            case 'release': {
              const reason = String(args.reason ?? '').trim();
              if (!reason) {
                return toolError('release exige reason con el motivo.');
              }
              const validated = toValidatedDto(ReleaseStopDto, { reason });
              if (!validated.ok) return toolError(validated.message);
              await routeFlowService.releaseStop(
                routeId,
                Number(stop.id),
                validated.dto,
              );
              return JSON.stringify({
                planilla: route.route_number ?? routeId,
                parada: stop.stop_sequence ?? stop.id,
                remision: stop.dispatch_note?.dispatch_number ?? null,
                transicion: `${stop.status} → released`,
                next_step:
                  'La remisión quedó libre: puedes asignarla a otra planilla en borrador.',
              });
            }
            case 'close': {
              if (!['dispatched', 'in_transit'].includes(route.status)) {
                return toolError(
                  `La planilla está '${route.status}': solo se cierra desde dispatched o in_transit.`,
                );
              }
              const pending = nonTerminalStops(route);
              if (pending.length > 0) {
                return toolError(
                  `Hay ${pending.length} parada(s) sin liquidar. Liquida o libera todas las paradas antes de cerrar.`,
                  'Lista las paradas pendientes con list_dispatch_routes + route_id.',
                );
              }
              const validated = toValidatedDto(CloseDispatchRouteDto, {
                ...(args.declared_cash !== undefined
                  ? { declared_cash: args.declared_cash }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const updated = await routeFlowService.close(
                routeId,
                validated.dto,
              );
              return JSON.stringify({
                planilla: updated.route_number ?? routeId,
                transicion: '→ closed',
                declarado: Number(updated.declared_cash ?? 0),
                recaudado: Number(updated.total_collected ?? 0),
                varianza: Number(updated.cash_variance ?? 0),
              });
            }
            case 'void': {
              if (['closed', 'voided'].includes(route.status)) {
                return toolError(
                  `No se puede anular una planilla '${route.status}'.`,
                );
              }
              const validated = toValidatedDto(VoidDispatchRouteDto, {
                ...(args.reason !== undefined
                  ? { reason: String(args.reason) }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const updated = await routeFlowService.void(
                routeId,
                validated.dto,
              );
              return JSON.stringify({
                planilla: updated.route_number ?? routeId,
                transicion: '→ voided',
              });
            }
            default:
              return toolError(`action "${action}" no soportada.`);
          }
        } catch (error) {
          const info = describeError(error);
          return toolError(
            `No se pudo ejecutar ${action} sobre la planilla ${routeId}: ${info.message}`,
            'Re-lee la planilla con list_dispatch_routes + route_id y ajusta la propuesta a su estado actual.',
            info.code,
          );
        }
      },
    },

    // ─── D-5: manage_dispatch_notes (WRITE) ─────────────────────────────
    {
      name: 'manage_dispatch_notes',
      version: '1',
      domain: 'dispatch',
      description:
        'Gestiona remisiones (dispatch_notes): create_from_order crea una remisión desde UNA orden con sus líneas, create_from_orders_batch crea remisiones en lote (quick-accept de lo pendiente por defecto, resultado parcial por orden), update edita una remisión en borrador y remove elimina una remisión en borrador. La lectura previa vive en el preview (lee la remisión/órdenes antes de proponer) y el handler la re-verifica.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: NOTE_ACTIONS,
            description:
              'Acción: create_from_order, create_from_orders_batch, update o remove.',
          },
          order_id: {
            type: 'number',
            description: 'ID de la orden (requerido para create_from_order).',
          },
          items: {
            type: 'array',
            description:
              'Líneas a despachar (requerido para create_from_order): order_item_id + dispatched_quantity, opcional location_id y lot_serial.',
            items: {
              type: 'object',
              properties: {
                order_item_id: { type: 'number' },
                dispatched_quantity: { type: 'number' },
                location_id: { type: 'number' },
                lot_serial: { type: 'string' },
              },
              required: ['order_item_id', 'dispatched_quantity'],
            },
          },
          orders: {
            type: 'array',
            description:
              'IDs de órdenes del lote (create_from_orders_batch, 1 a 100). Sin items_by_order se despacha todo lo pendiente de cada una.',
            items: { type: 'number' },
          },
          items_by_order: {
            type: 'object',
            description:
              'Mapa order_id → líneas a despachar para sobreescribir el quick-accept en órdenes puntuales del lote.',
          },
          batch_key: {
            type: 'string',
            description:
              'Clave de idempotencia del lote: si ya se aplicó, todo sale skipped.',
          },
          atomic: {
            type: 'boolean',
            description:
              'Si true, el lote falla completo ante el primer error (por defecto false: resultado parcial).',
          },
          target_status: {
            type: 'string',
            enum: ['draft', 'confirmed'],
            description:
              'Estado inicial de las remisiones creadas (por defecto el del servicio).',
          },
          route_assignment: {
            type: 'object',
            description:
              'Asignación a ruta: {mode: none|existing|new, route_id?, new_route?}. En new, new_route exige driver_user_id + planned_date.',
            properties: {
              mode: { type: 'string' },
              route_id: { type: 'number' },
              new_route: { type: 'object' },
            },
          },
          direction: { type: 'string', description: 'outbound o inbound.' },
          subtype: {
            type: 'string',
            description:
              'customer_delivery, customer_return, transfer_out, transfer_in o purchase_receipt.',
          },
          reason: {
            type: 'string',
            description:
              'Motivo (sale, sample, warranty, replenishment, normal_purchase, ...).',
          },
          dispatch_note_id: {
            type: 'number',
            description: 'ID de la remisión (requerido para update y remove).',
          },
          dispatch_location_id: {
            type: 'number',
            description: 'Bodega de despacho (create/update).',
          },
          agreed_delivery_date: {
            type: 'string',
            description: 'Fecha pactada de entrega YYYY-MM-DD (update).',
          },
          notes: { type: 'string', description: 'Notas (create/update).' },
          internal_notes: {
            type: 'string',
            description: 'Notas internas (update).',
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:dispatch_notes:create',
        'store:dispatch_notes:update',
        'store:dispatch_notes:delete',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (!NOTE_ACTIONS.includes(action)) {
          return previewError(
            'Remisión',
            `action "${action}" inválida. Usa ${NOTE_ACTIONS.join(', ')}.`,
          );
        }
        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Remisión',
            'Sin tienda ni organización en contexto.',
          );
        }

        try {
          switch (action) {
            case 'create_from_order': {
              const orderId = toPositiveInt(args.order_id);
              if (!orderId) {
                return previewError(
                  'Nueva remisión',
                  'create_from_order exige order_id.',
                );
              }
              const items = Array.isArray(args.items) ? args.items : [];
              if (!items.length) {
                return previewError(
                  'Nueva remisión',
                  'create_from_order exige items con order_item_id + dispatched_quantity.',
                );
              }
              const validated = toValidatedDto(CreateFromOrderDto, {
                ...(args.direction
                  ? { direction: String(args.direction) }
                  : {}),
                ...(args.subtype ? { subtype: String(args.subtype) } : {}),
                ...(args.reason ? { reason: String(args.reason) } : {}),
                ...(args.dispatch_location_id !== undefined
                  ? { dispatch_location_id: args.dispatch_location_id }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
                ...(args.target_status
                  ? { target_status: String(args.target_status) }
                  : {}),
                ...(args.route_assignment !== undefined
                  ? { route_assignment: args.route_assignment }
                  : {}),
                items,
              });
              if (!validated.ok) {
                return previewError('Nueva remisión', validated.message);
              }
              const totalUnits = items.reduce(
                (sum: number, l: any) =>
                  sum + Number(l?.dispatched_quantity ?? 0),
                0,
              );
              const routeMode =
                (args.route_assignment as any)?.mode ?? 'none';
              return {
                status: 'ok',
                target: `Nueva remisión desde orden #${orderId}`,
                changes: [
                  {
                    field: 'items',
                    label: 'Líneas',
                    from: null,
                    to: `${items.length} línea(s), ${totalUnits} unidad(es)`,
                  },
                  {
                    field: 'target_status',
                    label: 'Estado inicial',
                    from: null,
                    to: String(args.target_status ?? 'confirmed'),
                  },
                  {
                    field: 'route_assignment',
                    label: 'Ruta',
                    from: null,
                    to:
                      routeMode === 'none'
                        ? 'sin asignar (queda disponible para planilla)'
                        : routeMode,
                  },
                ],
                message:
                  'El servicio valida stock y dirección de entrega al crear.',
                domain: 'dispatch',
              };
            }
            case 'create_from_orders_batch': {
              const orders = Array.isArray(args.orders)
                ? args.orders.map(Number).filter((n) => Number.isInteger(n))
                : [];
              if (!orders.length || orders.length > 100) {
                return previewError(
                  'Lote de remisiones',
                  'create_from_orders_batch exige orders con 1 a 100 IDs.',
                );
              }
              const validated = toValidatedDto(CreateFromOrdersBatchDto, {
                orders,
                ...(args.items_by_order !== undefined
                  ? { items_by_order: args.items_by_order }
                  : {}),
                ...(args.batch_key
                  ? { batch_key: String(args.batch_key) }
                  : {}),
                ...(args.atomic !== undefined ? { atomic: args.atomic } : {}),
                ...(args.target_status
                  ? { target_status: String(args.target_status) }
                  : {}),
                ...(args.route_assignment !== undefined
                  ? { route_assignment: args.route_assignment }
                  : {}),
              });
              if (!validated.ok) {
                return previewError('Lote de remisiones', validated.message);
              }
              const stock = await dispatchNotesService
                .validateFromOrdersBatch(orders)
                .catch(() => null);
              const issues = stock?.issues ?? [];
              return {
                status: issues.length ? 'warning' : 'ok',
                target: `Lote de ${orders.length} remisión(es) desde órdenes`,
                changes: [
                  {
                    field: 'orders',
                    label: 'Órdenes',
                    from: null,
                    to:
                      orders.length <= 10
                        ? orders.join(', ')
                        : `${orders.slice(0, 10).join(', ')}… (${orders.length})`,
                  },
                  {
                    field: 'mode',
                    label: 'Modo',
                    from: null,
                    to: args.atomic
                      ? 'atómico (falla todo ante el primer error)'
                      : 'parcial (cada orden reporta created/failed/skipped)',
                  },
                ],
                message: issues.length
                  ? `Stock corto en ${issues.length} línea(s): ${issues
                      .slice(0, 5)
                      .map(
                        (i: any) =>
                          `orden #${i.order_id} producto #${i.product_id} faltan ${i.missing_units}`,
                      )
                      .join('; ')}${issues.length > 5 ? '…' : ''}. Esas órdenes fallarán salvo que atomic=false las marque failed y el resto avance.`
                  : 'Stock validado para todo el lote.',
                domain: 'dispatch',
              };
            }
            case 'update':
            case 'remove': {
              const noteId = toPositiveInt(args.dispatch_note_id);
              if (!noteId) {
                return previewError(
                  'Remisión',
                  `${action} exige dispatch_note_id.`,
                );
              }
              let note: any;
              try {
                note = await dispatchNotesService.findOne(noteId);
              } catch (error) {
                const info = describeError(error);
                return previewError(
                  `Remisión #${noteId}`,
                  info.message ||
                    `La remisión ${noteId} no existe en esta tienda.`,
                );
              }
              if (note.status !== 'draft') {
                return previewError(
                  `Remisión ${note.dispatch_number ?? `#${noteId}`}`,
                  `Solo se puede ${action === 'update' ? 'editar' : 'eliminar'} en borrador (actual: '${note.status}').`,
                );
              }
              if (action === 'remove') {
                return {
                  status: 'warning',
                  target: `Remisión ${note.dispatch_number ?? `#${noteId}`} — ${note.customer_name ?? 'sin cliente'}`,
                  changes: [
                    {
                      field: 'status',
                      label: 'Remisión',
                      from: 'draft',
                      to: 'eliminada (borrado físico)',
                    },
                  ],
                  message: 'Eliminar es irreversible.',
                  domain: 'dispatch',
                };
              }
              const patch: Record<string, unknown> = {
                ...(args.notes !== undefined
                  ? { notes: String(args.notes) }
                  : {}),
                ...(args.internal_notes !== undefined
                  ? { internal_notes: String(args.internal_notes) }
                  : {}),
                ...(args.agreed_delivery_date !== undefined
                  ? { agreed_delivery_date: String(args.agreed_delivery_date) }
                  : {}),
                ...(args.dispatch_location_id !== undefined
                  ? { dispatch_location_id: args.dispatch_location_id }
                  : {}),
              };
              if (!Object.keys(patch).length) {
                return previewError(
                  `Remisión ${note.dispatch_number ?? `#${noteId}`}`,
                  'update exige al menos un campo: notes, internal_notes, agreed_delivery_date o dispatch_location_id.',
                );
              }
              const validated = toValidatedDto(UpdateDispatchNoteDto, patch);
              if (!validated.ok) {
                return previewError(
                  `Remisión ${note.dispatch_number ?? `#${noteId}`}`,
                  validated.message,
                );
              }
              const LABELS: Record<string, string> = {
                notes: 'Notas',
                internal_notes: 'Notas internas',
                agreed_delivery_date: 'Entrega pactada',
                dispatch_location_id: 'Bodega',
              };
              return {
                status: 'ok',
                target: `Remisión ${note.dispatch_number ?? `#${noteId}`} — ${note.customer_name ?? 'sin cliente'}`,
                changes: Object.entries(patch).map(([field, to]) => ({
                  field,
                  label: LABELS[field] ?? field,
                  from: note[field] ?? null,
                  to,
                })),
                domain: 'dispatch',
              };
            }
            default:
              return previewError('Remisión', `action "${action}" no soportada.`);
          }
        } catch (error) {
          const info = describeError(error);
          return previewError(
            'Remisión',
            `No se pudo proyectar la operación: ${info.message}`,
          );
        }
      },
      handler: async (args, context) => {
        const action = String(args.action ?? '');
        if (!NOTE_ACTIONS.includes(action)) {
          return toolError(
            `action "${action}" inválida. Usa ${NOTE_ACTIONS.join(', ')}.`,
          );
        }
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error: 'Sin tienda ni organización en contexto.',
          });
        }

        try {
          switch (action) {
            case 'create_from_order': {
              const orderId = toPositiveInt(args.order_id);
              if (!orderId) {
                return toolError('create_from_order exige order_id.');
              }
              const validated = toValidatedDto(CreateFromOrderDto, {
                ...(args.direction
                  ? { direction: String(args.direction) }
                  : {}),
                ...(args.subtype ? { subtype: String(args.subtype) } : {}),
                ...(args.reason ? { reason: String(args.reason) } : {}),
                ...(args.dispatch_location_id !== undefined
                  ? { dispatch_location_id: args.dispatch_location_id }
                  : {}),
                ...(args.notes ? { notes: String(args.notes) } : {}),
                ...(args.target_status
                  ? { target_status: String(args.target_status) }
                  : {}),
                ...(args.route_assignment !== undefined
                  ? { route_assignment: args.route_assignment }
                  : {}),
                ...(args.items !== undefined ? { items: args.items } : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const created = await dispatchNotesService.createFromOrder(
                orderId,
                validated.dto,
              );
              return JSON.stringify({
                remision: compactNote(created),
                next_step:
                  'La remisión quedó disponible para asignarla a una planilla en borrador.',
              });
            }
            case 'create_from_orders_batch': {
              const validated = toValidatedDto(CreateFromOrdersBatchDto, {
                ...(args.orders !== undefined ? { orders: args.orders } : {}),
                ...(args.items_by_order !== undefined
                  ? { items_by_order: args.items_by_order }
                  : {}),
                ...(args.batch_key
                  ? { batch_key: String(args.batch_key) }
                  : {}),
                ...(args.atomic !== undefined ? { atomic: args.atomic } : {}),
                ...(args.target_status
                  ? { target_status: String(args.target_status) }
                  : {}),
                ...(args.route_assignment !== undefined
                  ? { route_assignment: args.route_assignment }
                  : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const batch = await dispatchNotesService.createFromOrdersBatch(
                validated.dto,
              );
              const created = batch.results.filter(
                (r) => r.status === 'created',
              ).length;
              const failed = batch.results.filter(
                (r) => r.status === 'failed',
              );
              return JSON.stringify({
                creadas: created,
                de: batch.results.length,
                parcial: batch.partial,
                resultados: batch.results,
                ...(failed.length
                  ? {
                      next_step: `Revisa ${failed.length} orden(es) fallida(s) en resultados y corrige stock o datos antes de reintentar.`,
                    }
                  : {}),
              });
            }
            case 'update':
            case 'remove': {
              const noteId = toPositiveInt(args.dispatch_note_id);
              if (!noteId) {
                return toolError(`${action} exige dispatch_note_id.`);
              }
              // Re-verificación: la remisión pudo salir de borrador (confirmar,
              // asignar a ruta) entre el preview y el apply.
              const note = await dispatchNotesService.findOne(noteId);
              if (note.status !== 'draft') {
                return toolError(
                  `La remisión ${note.dispatch_number ?? noteId} ya no está en borrador (actual: '${note.status}').`,
                  'Las remisiones confirmadas no se editan ni eliminan: anúlalas por el flujo de remisiones si aplica.',
                );
              }
              if (action === 'remove') {
                await dispatchNotesService.remove(noteId);
                return JSON.stringify({
                  remision: note.dispatch_number ?? noteId,
                  eliminada: true,
                });
              }
              const validated = toValidatedDto(UpdateDispatchNoteDto, {
                ...(args.notes !== undefined
                  ? { notes: String(args.notes) }
                  : {}),
                ...(args.internal_notes !== undefined
                  ? { internal_notes: String(args.internal_notes) }
                  : {}),
                ...(args.agreed_delivery_date !== undefined
                  ? { agreed_delivery_date: String(args.agreed_delivery_date) }
                  : {}),
                ...(args.dispatch_location_id !== undefined
                  ? { dispatch_location_id: args.dispatch_location_id }
                  : {}),
              });
              if (!validated.ok) return toolError(validated.message);
              const updated = await dispatchNotesService.update(
                noteId,
                validated.dto,
              );
              return JSON.stringify({ remision: compactNote(updated) });
            }
            default:
              return toolError(`action "${action}" no soportada.`);
          }
        } catch (error) {
          const info = describeError(error);
          return toolError(
            `No se pudo ejecutar ${action}: ${info.message}`,
            'Verifica los IDs y el estado borrador de la remisión antes de reintentar.',
            info.code,
          );
        }
      },
    },
  ];
}
