import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { PromotionsService } from '../../../domains/store/promotions/promotions.service';
import { CouponsService } from '../../../domains/store/coupons/coupons.service';

/**
 * Familia marketing de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `PromotionsService` y `CouponsService`; sin SQL
 * directo. El scope tenant lo resuelven los servicios (StorePrismaService).
 *
 * Cadena: list_promotions/list_coupons (lecturas habilitantes) →
 * create/activate. validate_coupon es lectura (simula el descuento sin
 * consumir usos). Cada handler re-verifica sus precondiciones: el preview
 * es proyección, no transacción.
 *
 * Permisos verificados en `promotions.controller.ts` y
 * `coupons.controller.ts`.
 */

export interface MarketingToolDeps {
  promotionsService: PromotionsService;
  couponsService: CouponsService;
}

const PERM_PROMO_READ = 'store:promotions:read';
const PERM_PROMO_CREATE = 'store:promotions:create';
const PERM_COUPON_READ = 'store:coupons:read';
const PERM_COUPON_CREATE = 'store:coupons:create';
const PERM_COUPON_VALIDATE = 'store:coupons:validate';

const PROMO_STATES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'expired',
  'cancelled',
] as const;
const PROMO_TYPES = ['percentage', 'fixed_amount'] as const;
const PROMO_SCOPES = ['order', 'product', 'category'] as const;
const COUPON_DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;

function describeError(error: any): string {
  const detail = error?.response?.message ?? error?.message ?? String(error);
  return Array.isArray(detail) ? detail.join('; ') : String(detail);
}

const guard =
  (
    fn: (
      args: Record<string, any>,
      context: ToolExecutionContext,
    ) => Promise<Record<string, any>>,
  ) =>
  async (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<string> => {
    try {
      return JSON.stringify(await fn(args ?? {}, context));
    } catch (error: any) {
      return JSON.stringify({ error: describeError(error) });
    }
  };

function previewError(
  target: string,
  message: string,
  domain = 'marketing',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isDateOnly(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  );
}

export function createMarketingTools(
  deps: MarketingToolDeps,
): RegisteredTool[] {
  return [
    // ─── list_promotions (READ) ──────────────────────────────────
    {
      name: 'list_promotions',
      version: '1',
      domain: 'marketing',
      readOnly: true,
      description:
        'Lista promociones con filtros opcionales (search, state, type, scope) y paginación (page, limit máx 100). Úsala para "qué promociones están activas" o como lectura habilitante antes de proponer activate_promotion.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a buscar.' },
          state: {
            type: 'string',
            enum: [...PROMO_STATES],
            description: 'Estado de la promoción.',
          },
          type: {
            type: 'string',
            enum: [...PROMO_TYPES],
            description: 'Tipo de descuento.',
          },
          scope: {
            type: 'string',
            enum: [...PROMO_SCOPES],
            description: 'Alcance de la promoción.',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_PROMO_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        if (
          typeof args.state === 'string' &&
          (PROMO_STATES as readonly string[]).includes(args.state)
        ) {
          query.state = args.state;
        }
        if (
          typeof args.type === 'string' &&
          (PROMO_TYPES as readonly string[]).includes(args.type)
        ) {
          query.type = args.type;
        }
        if (
          typeof args.scope === 'string' &&
          (PROMO_SCOPES as readonly string[]).includes(args.scope)
        ) {
          query.scope = args.scope;
        }
        const result = await deps.promotionsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── create_promotion (WRITE) ────────────────────────────────
    {
      name: 'create_promotion',
      version: '1',
      domain: 'marketing',
      description:
        'Crea una promoción plana (name, type percentage|fixed_amount, value, start_date YYYY-MM-DD; opcionales description, code, scope, end_date, min_purchase_amount, max_discount_amount, usage_limit, per_customer_limit, is_auto_apply). Nace sin activar; se activa con activate_promotion.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre de la promoción.' },
          type: {
            type: 'string',
            enum: [...PROMO_TYPES],
            description: 'percentage o fixed_amount.',
          },
          value: {
            type: 'number',
            description:
              'Valor del descuento (>= 0; porcentaje 0-100 si type=percentage).',
          },
          start_date: {
            type: 'string',
            description: 'Inicio (YYYY-MM-DD).',
          },
          description: { type: 'string', description: 'Descripción.' },
          code: { type: 'string', description: 'Código (opcional).' },
          scope: {
            type: 'string',
            enum: [...PROMO_SCOPES],
            description: 'Alcance (opcional).',
          },
          end_date: { type: 'string', description: 'Fin (YYYY-MM-DD).' },
          min_purchase_amount: {
            type: 'number',
            description: 'Compra mínima (opcional).',
          },
          max_discount_amount: {
            type: 'number',
            description: 'Tope del descuento (opcional).',
          },
          usage_limit: {
            type: 'number',
            description: 'Usos totales (opcional).',
          },
          per_customer_limit: {
            type: 'number',
            description: 'Usos por cliente (opcional).',
          },
          is_auto_apply: {
            type: 'boolean',
            description: 'Aplicación automática (opcional).',
          },
        },
        required: ['name', 'type', 'value', 'start_date'],
      },
      requiredPermissions: [PERM_PROMO_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        if (typeof args?.name !== 'string' || !args.name.trim()) {
          return previewError('Nueva promoción', 'name es obligatorio.');
        }
        if (
          typeof args?.type !== 'string' ||
          !(PROMO_TYPES as readonly string[]).includes(args.type)
        ) {
          return previewError(
            'Nueva promoción',
            'type debe ser percentage o fixed_amount.',
          );
        }
        const value = Number(args?.value);
        if (!Number.isFinite(value) || value < 0) {
          return previewError(
            'Nueva promoción',
            'value debe ser un número mayor o igual que cero.',
          );
        }
        if (args.type === 'percentage' && value > 100) {
          return previewError(
            'Nueva promoción',
            'value no puede pasar de 100 cuando type=percentage.',
          );
        }
        if (!isDateOnly(args?.start_date)) {
          return previewError(
            'Nueva promoción',
            'start_date debe tener formato YYYY-MM-DD.',
          );
        }
        if (args?.end_date !== undefined && !isDateOnly(args.end_date)) {
          return previewError(
            'Nueva promoción',
            'end_date debe tener formato YYYY-MM-DD.',
          );
        }
        const deal =
          args.type === 'percentage' ? `${value}%` : `$${value}`;
        return {
          status: 'ok',
          target: `Nueva promoción — ${args.name.trim()} (${deal})`,
          changes: [
            { field: 'name', label: 'Nombre', from: null, to: args.name.trim() },
            { field: 'type', label: 'Tipo', from: null, to: args.type },
            { field: 'value', label: 'Valor', from: null, to: value },
            {
              field: 'start_date',
              label: 'Inicio',
              from: null,
              to: args.start_date,
            },
          ],
          message: 'La promoción nace sin activar; actívala después.',
          domain: 'marketing',
        };
      },
      handler: guard(async (args) => {
        if (typeof args?.name !== 'string' || !args.name.trim()) {
          return {
            error: 'name es obligatorio.',
            next_step: 'Pasa el nombre de la promoción.',
          };
        }
        if (
          typeof args?.type !== 'string' ||
          !(PROMO_TYPES as readonly string[]).includes(args.type)
        ) {
          return {
            error: 'type debe ser percentage o fixed_amount.',
            next_step: 'Elige el tipo de descuento.',
          };
        }
        const value = Number(args?.value);
        if (!Number.isFinite(value) || value < 0) {
          return {
            error: 'value debe ser mayor o igual que cero.',
            next_step: 'Pasa el valor del descuento.',
          };
        }
        if (args.type === 'percentage' && value > 100) {
          return {
            error: 'value no puede pasar de 100 cuando type=percentage.',
            next_step: 'Usa un porcentaje entre 0 y 100.',
          };
        }
        if (!isDateOnly(args?.start_date)) {
          return {
            error: `start_date inválido: ${String(args?.start_date)}.`,
            next_step: 'Usa formato YYYY-MM-DD.',
          };
        }
        const dto: Record<string, any> = {
          name: args.name.trim(),
          type: args.type,
          value,
          start_date: args.start_date,
        };
        for (const key of [
          'description',
          'code',
          'scope',
          'end_date',
          'min_purchase_amount',
          'max_discount_amount',
          'usage_limit',
          'per_customer_limit',
          'is_auto_apply',
        ]) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] = args[key];
          }
        }
        const created = await deps.promotionsService.create(dto as any);
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `Promoción "${row.name ?? dto.name}" creada.`,
          promotion_id: row.id,
          resultado: row,
        };
      }),
    },

    // ─── activate_promotion (WRITE) ──────────────────────────────
    {
      name: 'activate_promotion',
      version: '1',
      domain: 'marketing',
      description:
        'Activa una promoción (empieza a aplicar en ventas). Cadena: list_promotions para elegir una en draft/scheduled/paused.',
      parameters: {
        type: 'object',
        properties: {
          promotion_id: {
            type: 'number',
            description: 'ID de la promoción a activar.',
          },
        },
        required: ['promotion_id'],
      },
      requiredPermissions: [PERM_PROMO_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.promotion_id);
        if (id === null) {
          return previewError(
            'Activar promoción',
            'promotion_id inválido: consíguelo con list_promotions.',
          );
        }
        let promotion: Record<string, any> | null;
        try {
          promotion = (await deps.promotionsService.findOne(
            id,
          )) as unknown as Record<string, any>;
        } catch (error: any) {
          return previewError(
            `Promoción #${id}`,
            `No se pudo leer la promoción: ${describeError(error)}.`,
          );
        }
        if (!promotion) {
          return previewError(
            `Promoción #${id}`,
            'La promoción no existe o no es visible en esta tienda.',
          );
        }
        if (promotion.state === 'active') {
          return previewError(
            `Promoción "${promotion.name ?? `#${id}`}"`,
            'La promoción ya está activa.',
          );
        }
        return {
          status: 'warning',
          target: `Activar promoción "${promotion.name ?? `#${id}`}"`,
          changes: [
            {
              field: 'state',
              label: 'Estado',
              from: promotion.state ?? 'actual',
              to: 'active',
            },
          ],
          message: 'Desde la activación aplica descuentos en ventas.',
          domain: 'marketing',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.promotion_id);
        if (id === null) {
          return {
            error: 'promotion_id inválido.',
            next_step: 'Consíguelo con list_promotions.',
          };
        }
        const activated = await deps.promotionsService.activate(id);
        const row = activated as unknown as Record<string, any>;
        return {
          resumen: `Promoción "${row.name ?? `#${id}`}" activada.`,
          promotion_id: row.id ?? id,
          resultado: row,
        };
      }),
    },

    // ─── list_coupons (READ) ─────────────────────────────────────
    {
      name: 'list_coupons',
      version: '1',
      domain: 'marketing',
      readOnly: true,
      description:
        'Lista cupones con búsqueda opcional (search) y paginación (page, limit máx 100). Úsala para "qué cupones hay vigentes".',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a buscar.' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_COUPON_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        const result = await deps.couponsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── create_coupon (WRITE) ───────────────────────────────────
    {
      name: 'create_coupon',
      version: '1',
      domain: 'marketing',
      description:
        'Crea un cupón (code único de 3+ letras, name, discount_type PERCENTAGE|FIXED_AMOUNT, discount_value, valid_from y valid_until YYYY-MM-DD; opcionales description, min_purchase_amount, max_discount_amount, max_uses, max_uses_per_customer, is_active).',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Código único del cupón (3+ caracteres).',
          },
          name: { type: 'string', description: 'Nombre del cupón.' },
          discount_type: {
            type: 'string',
            enum: [...COUPON_DISCOUNT_TYPES],
            description: 'PERCENTAGE o FIXED_AMOUNT.',
          },
          discount_value: {
            type: 'number',
            description: 'Valor del descuento (mayor que cero).',
          },
          valid_from: {
            type: 'string',
            description: 'Vigencia desde (YYYY-MM-DD).',
          },
          valid_until: {
            type: 'string',
            description: 'Vigencia hasta (YYYY-MM-DD).',
          },
          description: { type: 'string', description: 'Descripción.' },
          min_purchase_amount: {
            type: 'number',
            description: 'Compra mínima (opcional).',
          },
          max_discount_amount: {
            type: 'number',
            description: 'Tope del descuento (opcional).',
          },
          max_uses: {
            type: 'number',
            description: 'Usos totales (opcional).',
          },
          max_uses_per_customer: {
            type: 'number',
            description: 'Usos por cliente (opcional).',
          },
          is_active: {
            type: 'boolean',
            description: 'Activo desde la creación (opcional).',
          },
        },
        required: [
          'code',
          'name',
          'discount_type',
          'discount_value',
          'valid_from',
          'valid_until',
        ],
      },
      requiredPermissions: [PERM_COUPON_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        if (typeof args?.code !== 'string' || args.code.trim().length < 3) {
          return previewError(
            'Nuevo cupón',
            'code debe tener al menos 3 caracteres.',
          );
        }
        if (typeof args?.name !== 'string' || args.name.trim().length < 2) {
          return previewError(
            'Nuevo cupón',
            'name debe tener al menos 2 caracteres.',
          );
        }
        if (
          typeof args?.discount_type !== 'string' ||
          !(COUPON_DISCOUNT_TYPES as readonly string[]).includes(
            args.discount_type,
          )
        ) {
          return previewError(
            'Nuevo cupón',
            'discount_type debe ser PERCENTAGE o FIXED_AMOUNT.',
          );
        }
        const value = Number(args?.discount_value);
        if (!Number.isFinite(value) || value <= 0) {
          return previewError(
            'Nuevo cupón',
            'discount_value debe ser mayor que cero.',
          );
        }
        if (!isDateOnly(args?.valid_from) || !isDateOnly(args?.valid_until)) {
          return previewError(
            'Nuevo cupón',
            'valid_from y valid_until deben tener formato YYYY-MM-DD.',
          );
        }
        const deal =
          args.discount_type === 'PERCENTAGE' ? `${value}%` : `$${value}`;
        return {
          status: 'ok',
          target: `Nuevo cupón ${args.code.trim().toUpperCase()} (${deal})`,
          changes: [
            {
              field: 'code',
              label: 'Código',
              from: null,
              to: args.code.trim().toUpperCase(),
            },
            {
              field: 'discount',
              label: 'Descuento',
              from: null,
              to: `${args.discount_type} ${value}`,
            },
            {
              field: 'validity',
              label: 'Vigencia',
              from: args.valid_from,
              to: args.valid_until,
            },
          ],
          domain: 'marketing',
        };
      },
      handler: guard(async (args) => {
        if (typeof args?.code !== 'string' || args.code.trim().length < 3) {
          return {
            error: 'code debe tener al menos 3 caracteres.',
            next_step: 'Pasa el código único del cupón.',
          };
        }
        const value = Number(args?.discount_value);
        if (!Number.isFinite(value) || value <= 0) {
          return {
            error: 'discount_value debe ser mayor que cero.',
            next_step: 'Pasa el valor del descuento.',
          };
        }
        if (!isDateOnly(args?.valid_from) || !isDateOnly(args?.valid_until)) {
          return {
            error: 'valid_from y valid_until deben tener formato YYYY-MM-DD.',
            next_step: 'Pasa la vigencia del cupón.',
          };
        }
        const dto: Record<string, any> = {
          code: args.code.trim(),
          name: args.name,
          discount_type: args.discount_type,
          discount_value: value,
          valid_from: args.valid_from,
          valid_until: args.valid_until,
        };
        for (const key of [
          'description',
          'min_purchase_amount',
          'max_discount_amount',
          'max_uses',
          'max_uses_per_customer',
          'is_active',
        ]) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] = args[key];
          }
        }
        const created = await deps.couponsService.create(dto as any);
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `Cupón ${row.code ?? dto.code} creado.`,
          coupon_id: row.id,
          resultado: row,
        };
      }),
    },

    // ─── validate_coupon (READ) ──────────────────────────────────
    {
      name: 'validate_coupon',
      version: '1',
      domain: 'marketing',
      readOnly: true,
      description:
        'Simula un cupón contra un subtotal (code + cart_subtotal; opcionales customer_id, product_ids, category_ids): responde si aplica y cuánto descuenta, sin consumir usos.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Código del cupón.' },
          cart_subtotal: {
            type: 'number',
            description: 'Subtotal del carrito (>= 0).',
          },
          customer_id: {
            type: 'number',
            description: 'ID del cliente (opcional).',
          },
          product_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de productos (opcional).',
          },
          category_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de categorías (opcional).',
          },
        },
        required: ['code', 'cart_subtotal'],
      },
      requiredPermissions: [PERM_COUPON_VALIDATE],
      handler: guard(async (args) => {
        if (typeof args?.code !== 'string' || !args.code.trim()) {
          return {
            error: 'code es obligatorio.',
            next_step: 'Pasa el código del cupón.',
          };
        }
        const subtotal = Number(args?.cart_subtotal);
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          return {
            error: `cart_subtotal inválido: ${String(args?.cart_subtotal)}.`,
            next_step: 'Pasa el subtotal del carrito (>= 0).',
          };
        }
        const dto: Record<string, any> = {
          code: args.code.trim(),
          cart_subtotal: subtotal,
        };
        if (args?.customer_id !== undefined) {
          const customer_id = toPositiveInt(args.customer_id);
          if (customer_id === null) {
            return {
              error: `customer_id inválido: ${String(args.customer_id)}.`,
              next_step: 'Pasa el ID numérico del cliente u omítelo.',
            };
          }
          dto.customer_id = customer_id;
        }
        for (const key of ['product_ids', 'category_ids']) {
          if (args?.[key] !== undefined) {
            if (
              !Array.isArray(args[key]) ||
              !args[key].every((v: unknown) => toPositiveInt(v) !== null)
            ) {
              return {
                error: `${key} debe ser un arreglo de IDs positivos.`,
                next_step: 'Pasa IDs numéricos u omite el campo.',
              };
            }
            dto[key] = args[key].map(Number);
          }
        }
        const result = await deps.couponsService.validate(dto as any);
        return result as unknown as Record<string, any>;
      }),
    },
  ];
}
