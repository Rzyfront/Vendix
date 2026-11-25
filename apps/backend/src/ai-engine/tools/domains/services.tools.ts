import { ConflictException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { ProductsService } from '../../../domains/store/products/products.service';
import {
  CreateProductDto,
  UpdateProductDto,
} from '../../../domains/store/products/dto';
import {
  BookingMode,
  ProductType,
  ServiceModality,
  ServicePricingType,
} from '../../../domains/store/products/dto/product-enums';
import { ProvidersService } from '../../../domains/store/reservations/providers/providers.service';
import { providerDisplayName } from '../../../domains/store/reservations/providers/provider-name.util';
import { ServicePlansService } from '../../../domains/store/reservations/service-plans/service-plans.service';
import {
  CreatePlanActivityDto,
  CreatePlanDepartureDto,
  ReplacePlanPaxPricesDto,
  UpdatePlanActivityDto,
  UpdatePlanDepartureDto,
} from '../../../domains/store/reservations/service-plans/dto/service-plan.dto';

/**
 * Configuración de servicios reservables y del modo Plan de varios días desde
 * Vex. Sin lógica propia de negocio: valida con los DTOs del HTTP y delega en
 * `ProductsService` (campos del servicio y del plan), `ProvidersService`
 * (prestadores asignados) y `ServicePlansService` (tramos, eventos/salidas e
 * itinerario). Las tareas del CRM por actividad las genera el listener del
 * plan al confirmarse cada reserva, igual que por HTTP.
 */
export interface ServiceToolDeps {
  productsService: ProductsService;
  providersService: ProvidersService;
  servicePlansService: ServicePlansService;
}

const SERVICE_ACTIONS = ['create', 'update'] as const;
const PLAN_ACTIONS = [
  'set_plan',
  'add_departure',
  'update_departure',
  'remove_departure',
  'set_itinerary',
  'assign_activity_provider',
] as const;

const DURATION_UNITS = { minute: 1, hour: 60, day: 1440 } as const;
type DurationUnit = keyof typeof DURATION_UNITS;

const BOOKING_MODES = Object.values(BookingMode) as string[];
const PRICING_TYPES = Object.values(ServicePricingType) as string[];
const MODALITIES = Object.values(ServiceModality) as string[];
const DEPARTURE_MODES = ['fixed', 'on_demand', 'both'] as const;

/** Máximo de salidas que una sola propuesta puede crear (p. ej. sábados de un año). */
const MAX_DEPARTURES_PER_CALL = 60;
const MAX_ACTIVITIES_PER_CALL = 60;

/** Campos simples del servicio: argumento de la tool → etiqueta legible. */
const SERVICE_FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  base_price: 'Precio base (sin impuestos)',
  is_on_sale: 'En oferta',
  sale_price: 'Precio de oferta',
  available_for_ecommerce: 'Visible en la tienda en línea',
  is_featured: 'Destacado',
  service_duration_minutes: 'Duración (minutos)',
  service_duration_unit: 'Unidad de duración',
  booking_mode: 'Modo de reserva',
  service_pricing_type: 'Tipo de cobro',
  service_modality: 'Modalidad',
  requires_booking: 'Requiere reserva',
  requires_station: 'Requiere estación',
  rental_pricing_mode: 'Cobro del alquiler de estación',
  is_recurring: 'Servicio recurrente',
  recurrence_interval_days: 'Se repite cada (días)',
  preparation_time_minutes: 'Tiempo de preparación (min)',
  service_instructions: 'Instrucciones para el cliente',
  is_consultation: 'Es consulta',
  send_preconsultation: 'Envía preconsulta',
  consultation_template_id: 'Plantilla de consulta',
  preconsultation_template_id: 'Plantilla de preconsulta',
  plan_duration_days: 'Días del plan',
  plan_duration_nights: 'Noches del plan',
  plan_departure_mode: 'Modo de eventos del plan',
  plan_min_pax: 'Mínimo de personas',
  plan_max_pax: 'Máximo de personas',
  plan_includes: 'El plan incluye',
  plan_excludes: 'El plan no incluye',
  plan_recommendations: 'Recomendaciones',
};

const PLAN_ARG_TO_FIELD: Record<string, string> = {
  duration_days: 'plan_duration_days',
  duration_nights: 'plan_duration_nights',
  departure_mode: 'plan_departure_mode',
  min_pax: 'plan_min_pax',
  max_pax: 'plan_max_pax',
  includes: 'plan_includes',
  excludes: 'plan_excludes',
  recommendations: 'plan_recommendations',
};

const ACTIVITY_FIELDS = [
  'activity_id',
  'day_number',
  'title',
  'start_time',
  'description',
  'provider_id',
  'supplier_id',
  'supplier_name',
  'supplier_contact',
  'cost',
  'creates_task',
  'is_public',
] as const;

type Failure = { ok: false; message: string; nextStep?: string };
type Success<T> = { ok: true; value: T };
type Resolution<T> = Success<T> | Failure;

const fail = (message: string, nextStep?: string): Failure => ({
  ok: false,
  message,
  ...(nextStep ? { nextStep } : {}),
});

/** Valida como el `ValidationPipe` global del HTTP (`whitelist` + `forbidNonWhitelisted`). */
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
  const collect = (list: typeof errors): string[] =>
    list.flatMap((entry) => [
      ...Object.values(entry.constraints ?? {}),
      ...collect(entry.children ?? []),
    ]);
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${collect(errors).join('; ') || 'revisa los campos enviados'}.`,
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
  return (error as { message?: string })?.message ?? 'error desconocido';
}

const has = (value: unknown) => value !== undefined && value !== null;

/**
 * Responsable de una actividad: interno (provider_id) XOR tercero (supplier_*).
 * Elegir uno limpia el otro, como el panel, para que el servicio no rechace por
 * conservar el responsable anterior (SERVICE_PLAN_020).
 */
function normalizeActivityOwner(fields: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fields };
  const internal = has(out.provider_id);
  const external = has(out.supplier_id) || has(out.supplier_name) || has(out.supplier_contact);
  if (internal && !external) {
    Object.assign(out, { supplier_id: null, supplier_name: null, supplier_contact: null });
  } else if (external && !internal) {
    out.provider_id = null;
  }
  return out;
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'products' };
}

function toolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    next_step: nextStep ?? 'Corrige los datos indicados y vuelve a proponer.',
  });
}

/** `3 días` / `90 min` legible a partir de minutos + unidad de presentación. */
function durationLabel(minutes: number, unit?: string | null): string {
  if (unit === 'day' && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'día' : 'días'}`;
  }
  if (unit === 'hour' && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }
  return `${minutes} min`;
}

/**
 * Campos del plan (objeto `plan` de la tool) → campos del producto. `pax_prices`
 * va aparte porque lo guarda `ServicePlansService.replacePaxPrices`.
 */
function planProductFields(
  plan: Record<string, any> | undefined,
): Resolution<{ fields: Record<string, unknown>; paxPrices?: ReplacePlanPaxPricesDto }> {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: true, value: { fields: {} } };
  }
  const unknown = Object.keys(plan).filter(
    (key) => !(key in PLAN_ARG_TO_FIELD) && key !== 'pax_prices',
  );
  if (unknown.length) {
    return fail(
      `plan no admite: ${unknown.join(', ')}. Campos válidos: ${[...Object.keys(PLAN_ARG_TO_FIELD), 'pax_prices'].join(', ')}.`,
    );
  }
  if (
    has(plan.departure_mode) &&
    !(DEPARTURE_MODES as readonly string[]).includes(String(plan.departure_mode))
  ) {
    return fail(
      `plan.departure_mode "${plan.departure_mode}" no existe. Valores válidos: ${DEPARTURE_MODES.join(', ')} (fixed = solo salidas con fecha y cupo; on_demand = el cliente elige la fecha; both = ambas).`,
    );
  }
  const fields: Record<string, unknown> = {};
  for (const [arg, field] of Object.entries(PLAN_ARG_TO_FIELD)) {
    if (plan[arg] !== undefined) fields[field] = plan[arg];
  }
  let paxPrices: ReplacePlanPaxPricesDto | undefined;
  if (plan.pax_prices !== undefined) {
    if (!Array.isArray(plan.pax_prices)) {
      return fail('plan.pax_prices debe ser una lista [{min_pax, max_pax, price}].');
    }
    const validated = toValidatedDto(ReplacePlanPaxPricesDto, {
      tiers: plan.pax_prices,
    });
    if (!validated.ok) return fail(validated.message);
    for (const tier of validated.dto.tiers) {
      if (tier.min_pax > tier.max_pax) {
        return fail(
          `El tramo ${tier.min_pax}-${tier.max_pax} personas tiene el mínimo mayor que el máximo.`,
        );
      }
    }
    paxPrices = validated.dto;
  }
  return { ok: true, value: { fields, ...(paxPrices ? { paxPrices } : {}) } };
}

function tiersLabel(dto: ReplacePlanPaxPricesDto): string {
  if (!dto.tiers.length) return 'sin tramos';
  return dto.tiers
    .map((tier) => `${tier.min_pax}-${tier.max_pax} pers: ${tier.price}`)
    .join(', ');
}

interface ServiceWrite {
  action: 'create' | 'update';
  /** false = solo prestadores/tramos: no hay campos del producto que escribir. */
  hasProductFields: boolean;
  productId: number | null;
  label: string;
  dto: CreateProductDto | UpdateProductDto;
  current: Record<string, any> | null;
  providerIds: number[];
  providerNames: string[];
  paxPrices?: ReplacePlanPaxPricesDto;
  warnings: string[];
  changes: ToolPreview['changes'];
}

export function createServiceTools(deps: ServiceToolDeps): RegisteredTool[] {
  const { productsService, providersService, servicePlansService } = deps;

  /** Producto de servicio vigente de la tienda o un fallo guiado. */
  async function loadService(
    rawId: unknown,
  ): Promise<Resolution<Record<string, any>>> {
    const productId = positiveInt(rawId);
    if (!productId) {
      return fail(
        `product_id inválido: "${rawId ?? ''}".`,
        'Usa find_product para obtener el product_id del servicio.',
      );
    }
    let product: any;
    try {
      product = await productsService.findOne(productId);
    } catch {
      return fail(
        `No existe un producto activo con id ${productId} en esta tienda.`,
        'Usa find_product con el nombre del servicio para obtener su product_id.',
      );
    }
    if (product?.product_type !== ProductType.SERVICE) {
      return fail(
        `"${product?.name ?? productId}" no es un servicio (es ${product?.product_type ?? 'desconocido'}).`,
        'Para productos que no son servicio usa update_product.',
      );
    }
    return { ok: true, value: product };
  }

  /** Arma y valida el DTO de `manage_service`; no escribe nada. */
  async function resolveServiceWrite(
    args: Record<string, any>,
  ): Promise<Resolution<ServiceWrite>> {
    const action = String(args.action ?? '');
    if (!(SERVICE_ACTIONS as readonly string[]).includes(action)) {
      return fail(
        `action "${action}" no existe. Valores válidos: ${SERVICE_ACTIONS.join(', ')}.`,
      );
    }

    let current: Record<string, any> | null = null;
    if (action === 'update') {
      const loaded = await loadService(args.product_id);
      if (!loaded.ok) return loaded;
      current = loaded.value;
    }

    const plain: Record<string, unknown> = {};
    const copy = (arg: string, field = arg) => {
      if (args[arg] !== undefined) plain[field] = args[arg];
    };
    [
      'name',
      'description',
      'base_price',
      'is_on_sale',
      'sale_price',
      'available_for_ecommerce',
      'is_featured',
      'requires_booking',
      'requires_station',
      'rental_pricing_mode',
      'is_recurring',
      'recurrence_interval_days',
      'service_instructions',
      'is_consultation',
      'send_preconsultation',
      'consultation_template_id',
      'preconsultation_template_id',
    ].forEach((field) => copy(field));
    copy('preparation_time', 'preparation_time_minutes');
    copy('preparation_time_minutes');

    // Enums: rechazo legible antes del DTO.
    const enumChecks: Array<[string, string[], string]> = [
      ['booking_mode', BOOKING_MODES, 'provider_required = el cliente reserva con un prestador; free_booking = reserva libre sin prestador'],
      ['service_pricing_type', PRICING_TYPES, 'per_hour = por hora; per_session = por sesión; package = paquete/plan; subscription = suscripción'],
      ['service_modality', MODALITIES, 'in_person, virtual o hybrid'],
    ];
    for (const [field, allowed, help] of enumChecks) {
      if (args[field] === undefined) continue;
      if (!allowed.includes(String(args[field]))) {
        return fail(
          `${field} "${args[field]}" no existe. Valores válidos: ${allowed.join(', ')} (${help}).`,
        );
      }
      plain[field] = String(args[field]);
    }

    // Duración: minutos directos, o cantidad + unidad (minute/hour/day).
    if (args.duration !== undefined || args.duration_unit !== undefined) {
      const unit = String(args.duration_unit ?? 'minute') as DurationUnit;
      if (!(unit in DURATION_UNITS)) {
        return fail(
          `duration_unit "${args.duration_unit}" no existe. Valores válidos: minute, hour, day.`,
        );
      }
      if (args.duration === undefined) {
        return fail('duration_unit viaja con duration (ej. duration: 3, duration_unit: "day").');
      }
      const amount = Number(args.duration);
      if (!Number.isFinite(amount) || amount <= 0) {
        return fail(`La duración debe ser mayor que 0. Recibido: "${args.duration}".`);
      }
      const minutes = Math.round(amount * DURATION_UNITS[unit]);
      plain.service_duration_minutes = minutes;
      plain.service_duration_unit = unit;
    }
    if (args.duration_minutes !== undefined) {
      if (plain.service_duration_minutes !== undefined) {
        return fail('Envía duration_minutes o duration + duration_unit, no ambos.');
      }
      const minutes = Number(args.duration_minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return fail(
          `duration_minutes debe ser mayor que 0. Recibido: "${args.duration_minutes}".`,
        );
      }
      plain.service_duration_minutes = Math.round(minutes);
      // La unidad es solo presentación: minutos directos se muestran en minutos
      // (solo se toca si la guardada es otra; null ya se lee como minutos).
      if (current?.service_duration_unit && current.service_duration_unit !== 'minute') {
        plain.service_duration_unit = 'minute';
      }
    }

    const plan = planProductFields(args.plan);
    if (!plan.ok) return plan;
    if (
      args.plan !== undefined &&
      (args.plan === null || typeof args.plan !== 'object' || Array.isArray(args.plan))
    ) {
      return fail('plan debe ser un objeto: {duration_days, duration_nights?, departure_mode?, min_pax?, max_pax?, pax_prices?}.');
    }
    const hasPlan = Object.keys(plan.value.fields).length > 0 || !!plan.value.paxPrices;
    if (hasPlan) {
      const pricing = plain.service_pricing_type ?? current?.service_pricing_type;
      if (plain.service_pricing_type !== undefined && plain.service_pricing_type !== 'package') {
        return fail(
          'El modo Plan exige service_pricing_type = package; no lo combines con otro tipo de cobro.',
        );
      }
      if (pricing !== 'package') plain.service_pricing_type = 'package';
      Object.assign(plain, plan.value.fields);
    }

    if (action === 'create') {
      plain.product_type = ProductType.SERVICE;
      // Un servicio creado desde aquí es reservable salvo que se pida lo contrario.
      if (plain.requires_booking === undefined) plain.requires_booking = true;
      if (!has(plain.name)) return fail('Falta name: el nombre del servicio.');
      if (!has(plain.base_price)) {
        return fail('Falta base_price: el precio del servicio sin impuestos (puede ser 0 si se cobra por tramos del plan).');
      }
    }

    const validated =
      action === 'create'
        ? toValidatedDto(CreateProductDto, plain)
        : toValidatedDto(UpdateProductDto, plain);
    if (!validated.ok) return fail(validated.message);
    const dto = validated.dto as Record<string, any>;

    // Prestadores a asignar: deben existir en la tienda.
    const providerIds: number[] = [];
    const providerNames: string[] = [];
    if (args.provider_ids !== undefined) {
      if (!Array.isArray(args.provider_ids)) {
        return fail('provider_ids debe ser una lista de ids de prestadores.');
      }
      for (const raw of args.provider_ids) {
        const id = positiveInt(raw);
        if (!id) return fail(`provider_id inválido en provider_ids: "${raw}".`);
        if (providerIds.includes(id)) continue;
        try {
          const provider = await providersService.findOne(id);
          providerIds.push(id);
          providerNames.push(providerDisplayName(provider) || `Prestador #${id}`);
        } catch {
          return fail(
            `No existe el prestador ${id} en esta tienda.`,
            'Lista los prestadores (manage_booking_providers / find) y usa un id válido.',
          );
        }
      }
    }

    // Prestadores que ya atienden el servicio: no son cambio ni falta de prestador.
    let alreadyAssigned: number[] = [];
    if (current) {
      try {
        alreadyAssigned = ((await providersService.getProvidersForService(current.id)) ?? []).map(
          (provider: { id: number }) => provider.id,
        );
      } catch {
        alreadyAssigned = [];
      }
    }
    const newProviderNames = providerNames.filter(
      (_name, index) => !alreadyAssigned.includes(providerIds[index]),
    );

    const changes: ToolPreview['changes'] = Object.keys(SERVICE_FIELD_LABELS)
      .filter((field) => dto[field] !== undefined)
      .filter((field) => !current || current[field] !== dto[field])
      .map((field) => ({
        field,
        label: SERVICE_FIELD_LABELS[field],
        from: current ? (current[field] ?? null) : null,
        to: dto[field],
      }));
    if (plan.value.paxPrices) {
      changes.push({
        field: 'pax_prices',
        label: 'Precio por tamaño de grupo (reemplaza los tramos)',
        from: current ? 'actual' : null,
        to: tiersLabel(plan.value.paxPrices),
      });
    }
    if (newProviderNames.length) {
      changes.push({
        field: 'provider_ids',
        label: 'Prestadores asignados',
        from: null,
        to: newProviderNames.join(', '),
      });
    }
    if (action === 'update' && !changes.length) {
      return fail(
        'No hay nada que cambiar: los valores enviados ya son los actuales o no se envió ningún campo.',
      );
    }

    // Reglas del dominio que la persona debe ver antes de aprobar.
    const warnings: string[] = [];
    const effective = (field: string) =>
      dto[field] !== undefined ? dto[field] : current?.[field];
    // Sin modo explícito, una estación con tarifa por tiempo queda en reserva
    // libre (lo decide ProductsService); el resto, con prestador (default de BD).
    const stationRate =
      effective('requires_station') === true &&
      effective('rental_pricing_mode') === 'station_rate';
    const bookingMode =
      effective('booking_mode') ??
      (stationRate ? BookingMode.FREE_BOOKING : BookingMode.PROVIDER_REQUIRED);
    const requiresBooking = effective('requires_booking') === true;
    if (requiresBooking && bookingMode === BookingMode.PROVIDER_REQUIRED) {
      const assigned = new Set([...providerIds, ...alreadyAssigned]).size;
      if (!assigned) {
        warnings.push(
          'El modo de reserva exige prestador y el servicio no tiene ninguno asignado: nadie podrá reservarlo hasta que pases provider_ids (o uses booking_mode free_booking).',
        );
      }
    }
    if (dto.service_duration_minutes === undefined && !current?.service_duration_minutes && requiresBooking && !hasPlan && action === 'create') {
      warnings.push('El servicio no tiene duración: define duration_minutes (o duration + duration_unit) para que la agenda calcule los horarios.');
    }
    const planDays = effective('plan_duration_days');
    if (hasPlan && !has(planDays)) {
      warnings.push('El plan no tiene días definidos (plan.duration_days): no se comportará como plan de varios días hasta definirlos.');
    }

    const name = String(dto.name ?? current?.name ?? 'servicio');
    return {
      ok: true,
      value: {
        action: action as 'create' | 'update',
        hasProductFields: Object.values(dto).some((value) => value !== undefined),
        productId: current?.id ?? null,
        label: action === 'create' ? `Nuevo servicio: ${name}` : `Editar servicio: ${name}`,
        dto: validated.dto,
        current,
        providerIds,
        providerNames,
        ...(plan.value.paxPrices ? { paxPrices: plan.value.paxPrices } : {}),
        warnings,
        changes,
      },
    };
  }

  /** Asigna prestadores de forma idempotente (ya asignado no es error). */
  async function assignProviders(productId: number, providerIds: number[]) {
    const result = { asignados: [] as number[], ya_asignados: [] as number[], fallidos: [] as Array<{ provider_id: number; error: string }> };
    for (const providerId of providerIds) {
      try {
        await providersService.assignService(providerId, productId);
        result.asignados.push(providerId);
      } catch (error) {
        if (error instanceof ConflictException) result.ya_asignados.push(providerId);
        else result.fallidos.push({ provider_id: providerId, error: describeError(error) });
      }
    }
    return result;
  }

  // ─── manage_service_plan: resolución de cada acción ──────────────────────

  interface PlanStep {
    target: string;
    changes: ToolPreview['changes'];
    warning?: string;
    apply: () => Promise<Record<string, unknown>>;
  }

  async function resolvePlanAction(
    args: Record<string, any>,
  ): Promise<Resolution<PlanStep>> {
    const action = String(args.action ?? '');
    if (!(PLAN_ACTIONS as readonly string[]).includes(action)) {
      return fail(
        `action "${action}" no existe. Valores válidos: ${PLAN_ACTIONS.join(', ')}. Para leer el plan usa get_service_plan.`,
      );
    }
    const loaded = await loadService(args.product_id);
    if (!loaded.ok) return loaded;
    const product = loaded.value;
    const productId: number = product.id;
    const name = String(product.name);
    const isPackage = product.service_pricing_type === 'package';

    if (action === 'set_plan') {
      const plan = planProductFields(args.plan);
      if (!plan.ok) return plan;
      const fields: Record<string, unknown> = { ...plan.value.fields };
      if (!Object.keys(fields).length && !plan.value.paxPrices) {
        return fail(
          'set_plan necesita plan con al menos un campo: {duration_days, duration_nights?, departure_mode?, min_pax?, max_pax?, includes?, excludes?, recommendations?, pax_prices?}.',
        );
      }
      if (!isPackage) fields.service_pricing_type = 'package';
      const validated = toValidatedDto(UpdateProductDto, fields);
      if (!validated.ok) return fail(validated.message);
      const dto = validated.dto as Record<string, any>;
      const changes: ToolPreview['changes'] = Object.keys(SERVICE_FIELD_LABELS)
        .filter((field) => dto[field] !== undefined && product[field] !== dto[field])
        .map((field) => ({
          field,
          label: SERVICE_FIELD_LABELS[field],
          from: product[field] ?? null,
          to: dto[field],
        }));
      if (plan.value.paxPrices) {
        changes.push({
          field: 'pax_prices',
          label: 'Precio por tamaño de grupo (reemplaza los tramos)',
          from: 'actual',
          to: tiersLabel(plan.value.paxPrices),
        });
      }
      if (!changes.length) return fail('El plan ya tiene esos valores: no hay nada que cambiar.');
      const days = dto.plan_duration_days ?? product.plan_duration_days;
      return {
        ok: true,
        value: {
          target: `Plan de ${name}`,
          changes,
          ...(!has(days)
            ? { warning: 'Sin plan.duration_days el servicio no se comporta como plan de varios días.' }
            : {}),
          apply: async () => {
            const hasProductFields = Object.keys(fields).length > 0;
            if (hasProductFields) {
              await productsService.update(productId, validated.dto, { lean: true });
            }
            const tiers = plan.value.paxPrices
              ? await servicePlansService.replacePaxPrices(productId, plan.value.paxPrices.tiers)
              : undefined;
            return {
              plan_actualizado: {
                product_id: productId,
                servicio: name,
                campos: changes.map((change) => change.field),
                ...(tiers ? { tramos: tiers } : {}),
              },
              next_step:
                'Agrega eventos con add_departure (fecha + cupo) si el plan tiene salidas fijas, y el itinerario con set_itinerary.',
            };
          },
        },
      };
    }

    // Eventos, itinerario y responsables solo existen en servicios tipo paquete.
    if (!isPackage) {
      return fail(
        `"${name}" no está en modo Plan (su tipo de cobro no es paquete).`,
        'Actívalo primero con set_plan (plan.duration_days, departure_mode, pax_prices).',
      );
    }

    if (action === 'add_departure') {
      const dates: string[] = [];
      if (Array.isArray(args.departure_dates)) dates.push(...args.departure_dates.map(String));
      if (has(args.departure_date)) dates.push(String(args.departure_date));
      const unique = [...new Set(dates.map((date) => date.slice(0, 10)))].sort();
      if (!unique.length) {
        return fail('Falta departure_date (YYYY-MM-DD) o departure_dates (lista) del evento.');
      }
      if (unique.length > MAX_DEPARTURES_PER_CALL) {
        return fail(`Máximo ${MAX_DEPARTURES_PER_CALL} eventos por propuesta; recibidos ${unique.length}. Divide la carga.`);
      }
      const dtos: CreatePlanDepartureDto[] = [];
      for (const date of unique) {
        const validated = toValidatedDto(CreatePlanDepartureDto, {
          departure_date: date,
          ...(args.capacity !== undefined ? { capacity: args.capacity } : {}),
          ...(args.price_override !== undefined ? { price_override: args.price_override } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });
        if (!validated.ok) return fail(`Evento ${date}: ${validated.message}`);
        dtos.push(validated.dto);
      }
      const departureMode = product.plan_departure_mode;
      return {
        ok: true,
        value: {
          target: `${unique.length === 1 ? 'Nuevo evento' : `${unique.length} eventos nuevos`} de ${name}`,
          changes: dtos.map((dto) => ({
            field: `evento_${dto.departure_date}`,
            label: `Evento ${dto.departure_date}`,
            from: null,
            to: `cupo ${dto.capacity}${has(dto.price_override) ? `, precio ${dto.price_override}` : ', precio por tramos'}`,
          })),
          ...(departureMode === 'on_demand'
            ? { warning: 'El plan está en modo fecha libre (on_demand): los eventos fijos no se ofrecen hasta cambiar departure_mode a fixed o both con set_plan.' }
            : {}),
          apply: async () => {
            const creados: unknown[] = [];
            const fallidos: Array<{ fecha: string; error: string }> = [];
            for (const dto of dtos) {
              try {
                creados.push(await servicePlansService.createDeparture(productId, dto));
              } catch (error) {
                fallidos.push({ fecha: dto.departure_date, error: describeError(error) });
              }
            }
            return {
              eventos_creados: creados,
              ...(fallidos.length ? { eventos_fallidos: fallidos } : {}),
              servicio: name,
            };
          },
        },
      };
    }

    if (action === 'update_departure' || action === 'remove_departure') {
      const departureId = positiveInt(args.departure_id);
      if (!departureId) {
        return fail(
          `departure_id inválido: "${args.departure_id ?? ''}".`,
          'Lee los eventos con get_service_plan y usa su id.',
        );
      }
      const plain: Record<string, unknown> =
        action === 'remove_departure'
          ? { status: 'cancelled' }
          : {
              ...(args.departure_date !== undefined ? { departure_date: args.departure_date } : {}),
              ...(args.capacity !== undefined ? { capacity: args.capacity } : {}),
              ...(args.price_override !== undefined ? { price_override: args.price_override } : {}),
              ...(args.status !== undefined ? { status: args.status } : {}),
              ...(args.notes !== undefined ? { notes: args.notes } : {}),
            };
      if (!Object.keys(plain).length) {
        return fail('No hay nada que cambiar: pasa departure_date, capacity, price_override, status o notes.');
      }
      const validated = toValidatedDto(UpdatePlanDepartureDto, plain);
      if (!validated.ok) return fail(validated.message);
      const dto = validated.dto as Record<string, any>;
      return {
        ok: true,
        value: {
          target: `${action === 'remove_departure' ? 'Cancelar' : 'Editar'} evento #${departureId} de ${name}`,
          changes: Object.keys(plain).map((field) => ({
            field,
            label: field === 'status' ? 'Estado' : field,
            from: 'actual',
            to: dto[field],
          })),
          ...(action === 'remove_departure'
            ? { warning: 'El evento queda cancelado (no se borra) y deja de ofrecerse. Si ya tiene cupos vendidos se rechaza: cancela o mueve esas reservas primero.' }
            : {}),
          apply: async () => ({
            evento: await servicePlansService.updateDeparture(productId, departureId, validated.dto),
            servicio: name,
          }),
        },
      };
    }

    if (action === 'assign_activity_provider') {
      const activityId = positiveInt(args.activity_id);
      if (!activityId) {
        return fail(
          `activity_id inválido: "${args.activity_id ?? ''}".`,
          'Lee el itinerario con get_service_plan y usa el id de la actividad.',
        );
      }
      const owner: Record<string, unknown> = {};
      for (const field of ['provider_id', 'supplier_id', 'supplier_name', 'supplier_contact']) {
        if (args[field] !== undefined) owner[field] = args[field];
      }
      if (!Object.keys(owner).length) {
        return fail('Pasa provider_id (prestador interno), supplier_id (proveedor registrado) o supplier_name/supplier_contact (tercero). Usa null para quitarlo.');
      }
      if (
        has(owner.provider_id) &&
        (has(owner.supplier_id) || has(owner.supplier_name) || has(owner.supplier_contact))
      ) {
        return fail('Una actividad tiene un responsable interno (provider_id) o un tercero (supplier_*), no los dos.');
      }
      const validated = toValidatedDto(UpdatePlanActivityDto, normalizeActivityOwner(owner));
      if (!validated.ok) return fail(validated.message);
      const who = has(owner.provider_id)
        ? `Prestador #${owner.provider_id}`
        : has(owner.supplier_id)
          ? `Proveedor #${owner.supplier_id}`
          : has(owner.supplier_name)
            ? String(owner.supplier_name)
            : 'sin responsable';
      return {
        ok: true,
        value: {
          target: `Responsable de la actividad #${activityId} de ${name}`,
          changes: [{ field: 'responsable', label: 'Responsable', from: 'actual', to: who }],
          apply: async () => ({
            actividad: await servicePlansService.updateActivity(productId, activityId, validated.dto),
            servicio: name,
          }),
        },
      };
    }

    // set_itinerary: agrega (sin activity_id), edita (con activity_id) y elimina (remove_activity_ids).
    const items = Array.isArray(args.activities) ? args.activities : [];
    const removeIds = Array.isArray(args.remove_activity_ids) ? args.remove_activity_ids : [];
    if (!items.length && !removeIds.length) {
      return fail('set_itinerary necesita activities (para agregar/editar) o remove_activity_ids (para eliminar).');
    }
    if (items.length + removeIds.length > MAX_ACTIVITIES_PER_CALL) {
      return fail(`Máximo ${MAX_ACTIVITIES_PER_CALL} actividades por propuesta.`);
    }
    if (!has(product.plan_duration_days)) {
      return fail(
        `"${name}" no tiene días definidos: el itinerario se carga por día.`,
        'Define plan.duration_days con set_plan antes de cargar el itinerario.',
      );
    }
    type ActivityOp =
      | { kind: 'create'; dto: CreatePlanActivityDto }
      | { kind: 'update'; id: number; dto: UpdatePlanActivityDto }
      | { kind: 'delete'; id: number };
    const ops: ActivityOp[] = [];
    for (const [index, raw] of items.entries()) {
      const row = (raw ?? {}) as Record<string, unknown>;
      const extra = Object.keys(row).filter((key) => !(ACTIVITY_FIELDS as readonly string[]).includes(key));
      if (extra.length) {
        return fail(
          `Actividad ${index + 1}: campos no admitidos (${extra.join(', ')}). Una actividad tiene day_number, title, start_time (HH:mm), description, provider_id o supplier_*, cost, creates_task e is_public; no tiene duración propia.`,
        );
      }
      const { activity_id: rawId, ...fields } = row;
      if (
        has(fields.provider_id) &&
        (has(fields.supplier_id) || has(fields.supplier_name) || has(fields.supplier_contact))
      ) {
        return fail(`Actividad ${index + 1}: tiene prestador interno y tercero a la vez; elige uno.`);
      }
      if (rawId !== undefined) {
        const id = positiveInt(rawId);
        if (!id) return fail(`Actividad ${index + 1}: activity_id inválido "${rawId}".`);
        const validated = toValidatedDto(UpdatePlanActivityDto, normalizeActivityOwner(fields));
        if (!validated.ok) return fail(`Actividad ${index + 1}: ${validated.message}`);
        ops.push({ kind: 'update', id, dto: validated.dto });
      } else {
        const validated = toValidatedDto(CreatePlanActivityDto, fields);
        if (!validated.ok) return fail(`Actividad ${index + 1}: ${validated.message}`);
        if (validated.dto.day_number > Number(product.plan_duration_days)) {
          return fail(
            `Actividad ${index + 1}: el plan dura ${product.plan_duration_days} días; el día ${validated.dto.day_number} no existe.`,
          );
        }
        ops.push({ kind: 'create', dto: validated.dto });
      }
    }
    for (const raw of removeIds) {
      const id = positiveInt(raw);
      if (!id) return fail(`remove_activity_ids trae un id inválido: "${raw}".`);
      ops.push({ kind: 'delete', id });
    }
    const withTasks = ops.filter(
      (op) => op.kind !== 'delete' && (op.dto as { creates_task?: boolean }).creates_task === true,
    ).length;
    return {
      ok: true,
      value: {
        target: `Itinerario de ${name}`,
        changes: ops.map((op) =>
          op.kind === 'create'
            ? {
                field: 'actividad_nueva',
                label: `Día ${op.dto.day_number}`,
                from: null,
                to: `${op.dto.start_time ? `${op.dto.start_time} ` : ''}${op.dto.title}${op.dto.creates_task ? ' (crea tarea)' : ''}`,
              }
            : op.kind === 'update'
              ? { field: `actividad_${op.id}`, label: `Actividad #${op.id}`, from: 'actual', to: Object.keys(op.dto).filter((k) => (op.dto as Record<string, unknown>)[k] !== undefined).join(', ') }
              : { field: `actividad_${op.id}`, label: `Actividad #${op.id}`, from: 'actual', to: null },
        ),
        ...(withTasks
          ? { warning: `${withTasks} actividad(es) crean tarea en el CRM: se generan al confirmar cada reserva del plan.` }
          : {}),
        apply: async () => {
          const aplicadas: unknown[] = [];
          const fallidas: Array<{ operacion: string; error: string }> = [];
          for (const op of ops) {
            try {
              if (op.kind === 'create') {
                aplicadas.push(await servicePlansService.createActivity(productId, op.dto));
              } else if (op.kind === 'update') {
                aplicadas.push(await servicePlansService.updateActivity(productId, op.id, op.dto));
              } else {
                aplicadas.push({ eliminada: (await servicePlansService.deleteActivity(productId, op.id)).id });
              }
            } catch (error) {
              fallidas.push({
                operacion: op.kind === 'create' ? `crear "${op.dto.title}"` : `${op.kind === 'update' ? 'editar' : 'eliminar'} #${op.id}`,
                error: describeError(error),
              });
            }
          }
          return {
            itinerario: aplicadas,
            ...(fallidas.length ? { fallidas } : {}),
            servicio: name,
            nota: 'Las actividades con creates_task generan su tarea del CRM cuando se confirma cada reserva del plan.',
          };
        },
      },
    };
  }

  return [
    // ─── manage_service ───────────────────────────────────────────────────
    {
      name: 'manage_service',
      version: '1',
      domain: 'reservations',
      description:
        'Crea o edita un SERVICIO reservable (citas, tours, alquileres): precio, duración (minutos u horas/días), modo de reserva (con prestador o libre), tipo de cobro, estación, recurrencia, consulta, instrucciones y prestadores asignados. Con `plan` activa en la misma llamada el modo Plan de varios días (días/noches, salidas fijas o fecha libre, precio por tamaño de grupo). Semántica PATCH en update. Para salidas, itinerario y actividades usa manage_service_plan; para productos que no son servicio, create_product/update_product.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: SERVICE_ACTIONS, description: 'create = nuevo servicio; update = editar uno existente (requiere product_id).' },
          product_id: { type: 'number', description: 'Servicio a editar (update). Obtenlo con find_product.' },
          name: { type: 'string', description: 'Nombre del servicio (obligatorio en create).' },
          description: { type: 'string', description: 'Descripción.' },
          base_price: { type: 'number', description: 'Precio SIN impuestos (obligatorio en create; 0 si se cobra por tramos del plan).' },
          is_on_sale: { type: 'boolean', description: 'En oferta.' },
          sale_price: { type: 'number', description: 'Precio de oferta sin impuestos.' },
          available_for_ecommerce: { type: 'boolean', description: 'Visible en la tienda en línea.' },
          is_featured: { type: 'boolean', description: 'Destacado.' },
          duration_minutes: { type: 'number', description: 'Duración en minutos (> 0).' },
          duration: { type: 'number', description: 'Duración en la unidad de duration_unit (alternativa a duration_minutes).' },
          duration_unit: { type: 'string', enum: Object.keys(DURATION_UNITS), description: 'minute, hour o day (se guarda en minutos).' },
          booking_mode: { type: 'string', enum: BOOKING_MODES, description: 'provider_required = se reserva con un prestador (necesita provider_ids); free_booking = reserva libre.' },
          service_pricing_type: { type: 'string', enum: PRICING_TYPES, description: 'per_hour, per_session, package (paquete/plan) o subscription.' },
          service_modality: { type: 'string', enum: MODALITIES, description: 'in_person, virtual o hybrid.' },
          requires_booking: { type: 'boolean', description: 'Se vende con reserva (default true al crear).' },
          requires_station: { type: 'boolean', description: 'Necesita una estación física (silla, cancha, cabina).' },
          rental_pricing_mode: { type: 'string', enum: ['fixed_price', 'station_rate'], description: 'Solo con requires_station: precio fijo del servicio o tarifa por tiempo de la estación.' },
          is_recurring: { type: 'boolean', description: 'Servicio recurrente.' },
          recurrence_interval_days: { type: 'number', description: 'Cada cuántos días se repite (1-365).' },
          preparation_time: { type: 'number', description: 'Minutos de preparación.' },
          service_instructions: { type: 'string', description: 'Instrucciones para el cliente.' },
          is_consultation: { type: 'boolean', description: 'Es una consulta (exige requires_booking y consultation_template_id).' },
          send_preconsultation: { type: 'boolean', description: 'Envía preconsulta (exige preconsultation_template_id).' },
          consultation_template_id: { type: 'number', description: 'Plantilla de consulta.' },
          preconsultation_template_id: { type: 'number', description: 'Plantilla de preconsulta.' },
          provider_ids: { type: 'array', items: { type: 'number' }, description: 'Prestadores que atienden el servicio (se suman a los ya asignados).' },
          plan: {
            type: 'object',
            description: 'Modo Plan de varios días (fija service_pricing_type = package): {duration_days, duration_nights?, departure_mode? fixed|on_demand|both, min_pax?, max_pax?, includes?, excludes?, recommendations?, pax_prices? [{min_pax, max_pax, price}] (reemplaza los tramos)}.',
          },
        },
        required: ['action'],
      },
      // AND fail-closed: crear y editar el producto (dueño HTTP: products) y
      // asignar prestadores (dueño HTTP: reservations:update).
      requiredPermissions: [
        'store:products:create',
        'store:products:update',
        'store:reservations:update',
      ],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return previewError('Configurar servicio', 'Sin tienda en contexto: los servicios están acotados por tienda.');
        }
        const resolved = await resolveServiceWrite(args);
        if (!resolved.ok) {
          return previewError(
            'Configurar servicio',
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
          );
        }
        const { label, changes, warnings } = resolved.value;
        return {
          status: warnings.length ? 'warning' : 'ok',
          target: label,
          changes,
          ...(warnings.length ? { message: warnings.join(' ') } : {}),
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return toolError('Sin tienda en contexto: los servicios están acotados por tienda.');
        }
        // Re-verificación: el servicio o los prestadores pudieron cambiar.
        const resolved = await resolveServiceWrite(args);
        if (!resolved.ok) return toolError(resolved.message, resolved.nextStep);
        const write = resolved.value;
        let productId = write.productId;
        try {
          if (write.action === 'create') {
            const created: any = await productsService.create(write.dto as CreateProductDto);
            productId = created?.id ?? null;
          } else if (write.hasProductFields) {
            await productsService.update(productId as number, write.dto as UpdateProductDto, { lean: true });
          }
        } catch (error) {
          return toolError(
            `No se pudo ${write.action === 'create' ? 'crear' : 'editar'} el servicio: ${describeError(error)}`,
          );
        }
        if (!productId) {
          return toolError('El servicio se creó pero no se obtuvo su id.', 'Búscalo con find_product.');
        }
        const pending: string[] = [];
        const failedFields = new Set<string>();
        let tramos: unknown;
        if (write.paxPrices) {
          try {
            tramos = await servicePlansService.replacePaxPrices(productId, write.paxPrices.tiers);
          } catch (error) {
            pending.push(`Precios por grupo no guardados: ${describeError(error)}`);
            failedFields.add('pax_prices');
          }
        }
        const providers = write.providerIds.length
          ? await assignProviders(productId, write.providerIds)
          : null;
        if (providers?.fallidos.length) {
          pending.push(`${providers.fallidos.length} prestador(es) no se asignaron.`);
          if (!providers.asignados.length && !providers.ya_asignados.length) failedFields.add('provider_ids');
        }
        return JSON.stringify({
          summary: `${write.label}: ${write.changes.length - failedFields.size} cambio(s) aplicado(s).${pending.length ? ` Pendiente: ${pending.join(' ')}` : ''}`,
          data: {
            product_id: productId,
            campos: write.changes
              .map((change) => change.field)
              .filter((field) => !failedFields.has(field)),
            ...(tramos ? { tramos } : {}),
            ...(providers ? { prestadores: providers } : {}),
          },
          ...(write.warnings.length ? { advertencias: write.warnings } : {}),
          next_step: write.dto.service_pricing_type === 'package' || write.current?.service_pricing_type === 'package'
            ? 'Carga eventos (add_departure) e itinerario (set_itinerary) con manage_service_plan.'
            : 'Revisa la disponibilidad con check_booking_availability.',
        });
      },
    },

    // ─── manage_service_plan ──────────────────────────────────────────────
    {
      name: 'manage_service_plan',
      version: '1',
      domain: 'reservations',
      description:
        'Modo Plan de varios días de un servicio (tours, paquetes, retiros): set_plan (días/noches, salidas fixed|on_demand|both, grupo mín/máx, precio por tamaño de grupo pax_prices), add_departure (uno o varios eventos con fecha y cupo, precio propio opcional), update_departure, remove_departure (cancela el evento, no lo borra), set_itinerary (agrega/edita/elimina actividades por día con hora y responsable; creates_task genera la tarea del CRM al confirmar cada reserva) y assign_activity_provider. Lee antes con get_service_plan para tener ids.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: PLAN_ACTIONS, description: 'Qué cambiar del plan.' },
          product_id: { type: 'number', description: 'Servicio del plan (find_product).' },
          plan: { type: 'object', description: 'set_plan: {duration_days, duration_nights?, departure_mode? fixed|on_demand|both, min_pax?, max_pax?, includes?, excludes?, recommendations?, pax_prices? [{min_pax, max_pax, price}] (reemplaza todos los tramos)}.' },
          departure_date: { type: 'string', description: 'add/update_departure: fecha YYYY-MM-DD (no pasada).' },
          departure_dates: { type: 'array', items: { type: 'string' }, description: `add_departure: varias fechas YYYY-MM-DD con el mismo cupo (máx ${MAX_DEPARTURES_PER_CALL}), p. ej. todos los sábados.` },
          capacity: { type: 'number', description: 'Cupo del evento (personas, ≥ 1; no menor que lo vendido).' },
          price_override: { type: 'number', description: 'Precio del paquete en ese evento; null = usa los tramos por grupo.' },
          status: { type: 'string', enum: ['open', 'closed', 'cancelled'], description: 'update_departure: estado del evento.' },
          notes: { type: 'string', description: 'Notas del evento.' },
          departure_id: { type: 'number', description: 'Evento a editar o cancelar.' },
          activities: {
            type: 'array',
            items: { type: 'object' },
            description: 'set_itinerary: [{activity_id? (para editar), day_number, title, start_time? HH:mm, description?, provider_id? | supplier_id? | supplier_name?/supplier_contact?, cost?, creates_task?, is_public?}]. Sin activity_id se agrega al final del día.',
          },
          remove_activity_ids: { type: 'array', items: { type: 'number' }, description: 'set_itinerary: actividades a eliminar.' },
          activity_id: { type: 'number', description: 'assign_activity_provider: actividad objetivo.' },
          provider_id: { type: 'number', description: 'assign_activity_provider: prestador interno responsable (null lo quita).' },
          supplier_id: { type: 'number', description: 'assign_activity_provider: proveedor registrado de la tienda.' },
          supplier_name: { type: 'string', description: 'assign_activity_provider: tercero no registrado.' },
          supplier_contact: { type: 'string', description: 'Contacto del tercero.' },
        },
        required: ['action', 'product_id'],
      },
      // Dueño HTTP: `store/service-plans` escribe con store:products:update.
      requiredPermissions: ['store:products:update'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return previewError('Plan del servicio', 'Sin tienda en contexto: los planes están acotados por tienda.');
        }
        const resolved = await resolvePlanAction(args);
        if (!resolved.ok) {
          return previewError(
            'Plan del servicio',
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
          );
        }
        return {
          status: resolved.value.warning ? 'warning' : 'ok',
          target: resolved.value.target,
          changes: resolved.value.changes,
          ...(resolved.value.warning ? { message: resolved.value.warning } : {}),
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return toolError('Sin tienda en contexto: los planes están acotados por tienda.');
        }
        const resolved = await resolvePlanAction(args);
        if (!resolved.ok) return toolError(resolved.message, resolved.nextStep);
        try {
          return JSON.stringify(await resolved.value.apply());
        } catch (error) {
          return toolError(
            `No se pudo aplicar el cambio al plan: ${describeError(error)}`,
            'Lee el plan con get_service_plan, corrige y vuelve a proponer.',
          );
        }
      },
    },

    // ─── get_service_plan (lectura) ───────────────────────────────────────
    {
      name: 'get_service_plan',
      version: '1',
      domain: 'reservations',
      readOnly: true,
      description:
        'Lee el modo Plan de un servicio: días/noches, modo de salidas, grupo mín/máx, precios por tamaño de grupo, eventos (fecha, cupo, vendidos, disponibles, precio, estado) e itinerario (actividades por día con id, hora y responsable). Úsalo antes de manage_service_plan.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'number', description: 'Servicio del plan (find_product).' },
          include_past: { type: 'boolean', description: 'Incluye eventos pasados (default false).' },
        },
        required: ['product_id'],
      },
      // Mismo permiso que GET store/service-plans/:productId.
      requiredPermissions: ['store:products:read', 'store:reservations:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return toolError('Sin tienda en contexto: los planes están acotados por tienda.');
        }
        const productId = positiveInt(args.product_id);
        if (!productId) {
          return toolError(`product_id inválido: "${args.product_id ?? ''}".`, 'Usa find_product para obtener el product_id del servicio.');
        }
        try {
          const plan: any = await servicePlansService.getPlan(productId, args.include_past === true);
          return JSON.stringify({
            ...plan,
            ...(plan?.is_plan
              ? {}
              : { nota: 'Este servicio no está en modo Plan: actívalo con manage_service_plan set_plan o manage_service con plan.' }),
          });
        } catch (error) {
          return toolError(`No se pudo leer el plan: ${describeError(error)}`, 'Verifica el product_id con find_product.');
        }
      },
    },
  ];
}
