import { RegisteredTool } from '../interfaces/tool.interface';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

export interface CustomerToolDeps {
  customersService: CustomersService;
  /**
   * `StorePrismaService` and never `GlobalPrismaService`: every read here is
   * tenant data. Note that its `users` getter returns the **unscoped** base
   * client (see `vendix-prisma-scopes`), so every `users` query in this file
   * carries the store filter explicitly via `customerScope()`.
   */
  prisma: StorePrismaService;
}

/**
 * Upper bound for the in-memory fuzzy pass of `find_customer`. It only runs
 * when the SQL pass found nothing, and it exists because Postgres `ILIKE` is
 * case-insensitive but NOT accent-insensitive: a user who dictates "martinez"
 * never matches a stored "Martínez". Scanning is capped and the response says
 * out loud when the cap was reached instead of pretending the catalog ended.
 */
const FUZZY_SCAN_CAP = 600;

/** Strips diacritics so "Martínez" and "martinez" compare equal. */
function deburr(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalize(value: unknown): string {
  return deburr(value).toLowerCase().trim();
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/** Prisma `Decimal` arrives as an object; `Number()` on null must be 0. */
function toAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fullName(user: { first_name?: string; last_name?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

function formatDocument(user: {
  document_type?: string | null;
  document_number?: string | null;
}): string | null {
  if (!user.document_number) return null;
  return [user.document_type, user.document_number].filter(Boolean).join(' ');
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysSince(value: unknown, reference: Date): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(
    0,
    Math.floor((reference.getTime() - date.getTime()) / 86_400_000),
  );
}

/**
 * Store-scoped predicate for "this row is a customer of THIS store".
 * `users` is not auto-scoped, so this must be spread into every `where`.
 */
function customerScope(storeId: number, includeArchived: boolean) {
  return {
    store_users: { some: { store_id: storeId } },
    user_roles: { some: { roles: { name: 'customer' } } },
    ...(includeArchived ? {} : { state: { not: 'archived' as const } }),
  };
}

const CUSTOMER_CARD_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  email: true,
  phone: true,
  document_type: true,
  document_number: true,
  state: true,
  created_at: true,
} as const;

/**
 * Quintile score (1..5) of `value` inside an ascending sorted population.
 * Degrades gracefully when the population is tiny (everyone lands mid-scale
 * instead of the function inventing spread that does not exist).
 */
function quintileScore(sortedAsc: number[], value: number): number {
  if (sortedAsc.length < 5) return 3;
  let low = 0;
  let high = sortedAsc.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedAsc[mid] < value) low = mid + 1;
    else high = mid;
  }
  const percentile = low / sortedAsc.length;
  return Math.min(5, Math.floor(percentile * 5) + 1);
}

const RFM_DEFINITIONS: Record<string, string> = {
  Campeones: 'Compraron hace poco, compran seguido y son los que más gastan.',
  Leales: 'Compran con regularidad y siguen activos.',
  'Prometedores / nuevos':
    'Compraron hace poco pero todavía tienen pocas compras.',
  'Necesitan atención':
    'Actividad intermedia: ni recientes ni frecuentes. Se enfrían.',
  'En riesgo': 'Compraban seguido y llevan tiempo sin volver.',
  'No podemos perderlos':
    'Alto gasto histórico y hace mucho que no compran. Prioridad de recuperación.',
  Hibernando: 'Poca frecuencia y hace tiempo que no compran.',
  Perdidos: 'Sin compras en el tramo más antiguo del período analizado.',
};

function rfmSegment(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4) return 'Campeones';
  if (r >= 3 && f >= 3) return 'Leales';
  if (r >= 4 && f <= 2) return 'Prometedores / nuevos';
  if (r === 3 && f <= 2) return 'Necesitan atención';
  if (r <= 2 && f >= 3) return 'En riesgo';
  if (r <= 2 && f <= 2 && m >= 4) return 'No podemos perderlos';
  if (r === 1) return 'Perdidos';
  return 'Hibernando';
}

function frequencyBucket(orders: number): string {
  if (orders >= 13) return '13 o más compras';
  if (orders >= 7) return '7 a 12 compras';
  if (orders >= 4) return '4 a 6 compras';
  if (orders >= 2) return '2 a 3 compras';
  return '1 compra';
}

const SPENDING_LABELS = [
  'Gasto muy bajo',
  'Gasto bajo',
  'Gasto medio',
  'Gasto alto',
  'Gasto muy alto',
];

interface CustomerAggregate {
  customer_id: number;
  orders: number;
  spent: number;
  last_purchase_at: Date | null;
}

export function createCustomerTools(deps: CustomerToolDeps): RegisteredTool[] {
  const { customersService, prisma } = deps;

  /**
   * Purchase aggregates for a bounded set of customers. Only `finished`
   * orders count as revenue — that is the same state the store's own
   * dashboards use, so the assistant never quotes a number the operator
   * cannot reconcile on screen.
   */
  async function loadPurchaseStats(
    customerIds: number[],
  ): Promise<Map<number, CustomerAggregate>> {
    const stats = new Map<number, CustomerAggregate>();
    if (!customerIds.length) return stats;

    const grouped = await prisma.orders.groupBy({
      by: ['customer_id'],
      where: { customer_id: { in: customerIds }, state: 'finished' },
      _count: { _all: true },
      _sum: { grand_total: true },
      _max: { created_at: true },
    });

    for (const row of grouped as any[]) {
      if (row.customer_id == null) continue;
      stats.set(row.customer_id, {
        customer_id: row.customer_id,
        orders: row._count?._all ?? 0,
        spent: toAmount(row._sum?.grand_total),
        last_purchase_at: row._max?.created_at ?? null,
      });
    }

    return stats;
  }

  /**
   * The store's currency read off its own orders instead of settings: it
   * avoids coupling this module to `SettingsModule` and it is the currency the
   * amounts in this response were actually recorded in.
   */
  async function resolveCurrencyFromOrders(): Promise<string | null> {
    const latest = await prisma.orders.findFirst({
      where: { currency: { not: null } },
      orderBy: { created_at: 'desc' },
      select: { currency: true },
    });
    return latest?.currency ?? null;
  }

  return [
    // ─── Tool 1: find_customer ───────────────────────────────────────
    {
      name: 'find_customer',
      domain: 'customers',
      readOnly: true,
      description:
        'Resuelve UN cliente de la tienda a partir de cómo lo nombraría una persona: nombre o apellido ("el cliente Martínez"), número de documento, teléfono o correo. Es el primer paso obligatorio de cualquier flujo que necesite un customer_id (historial, ventas del cliente, cartera): ninguna otra herramienta adivina el cliente por su nombre. Si hay varias coincidencias las devuelve TODAS con documento, teléfono, ciudad y última compra para que preguntes al usuario cuál es; no elijas tú.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Nombre, apellido, documento, teléfono o correo tal como lo dijo el usuario. Acepta texto parcial y sin tildes.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de coincidencias. Por defecto 10, tope 25.',
          },
          include_archived: {
            type: 'boolean',
            description:
              'Incluir clientes archivados. Por defecto false; úsalo solo si el usuario pide expresamente uno dado de baja.',
          },
        },
        required: ['query'],
      },
      requiredPermissions: ['store:customers:read'],
      handler: async (args, context) => {
        const storeId = context.store_id;
        if (!storeId) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: los clientes se resuelven siempre dentro de una tienda.',
          });
        }

        const rawQuery = String(args.query ?? '').trim();
        if (rawQuery.length < 2) {
          return JSON.stringify({
            error:
              'La búsqueda necesita al menos 2 caracteres. Pide al usuario el nombre, documento, teléfono o correo del cliente.',
          });
        }

        const limit = clampLimit(args.limit, 10, 25);
        const includeArchived = args.include_archived === true;
        const scope = customerScope(storeId, includeArchived);

        const digits = digitsOnly(rawQuery);
        const compactLength = rawQuery.replace(/\s+/g, '').length;
        const looksNumeric =
          digits.length >= 5 &&
          digits.length / Math.max(compactLength, 1) > 0.6;
        const looksLikeEmail = rawQuery.includes('@');

        let where: any;
        let matchedBy: string;

        if (looksNumeric) {
          matchedBy = 'documento_o_telefono';
          where = {
            ...scope,
            OR: [
              { document_number: { contains: digits } },
              { document_number: { contains: rawQuery } },
              { phone: { contains: digits } },
              { phone: { contains: rawQuery } },
            ],
          };
        } else if (looksLikeEmail) {
          matchedBy = 'correo';
          where = {
            ...scope,
            email: { contains: rawQuery, mode: 'insensitive' },
          };
        } else {
          matchedBy = 'nombre';
          // AND of per-token ORs: "juan martinez" requires both words, each of
          // them able to land on any identifying field. The accent-stripped
          // variant is OR'd in for stores that saved names without tildes.
          const tokens = rawQuery
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2)
            .slice(0, 5);

          const conditions = (tokens.length ? tokens : [rawQuery]).map(
            (token) => {
              const variants = Array.from(new Set([token, deburr(token)]));
              return {
                OR: variants.flatMap((variant) => [
                  { first_name: { contains: variant, mode: 'insensitive' } },
                  { last_name: { contains: variant, mode: 'insensitive' } },
                  { email: { contains: variant, mode: 'insensitive' } },
                  { document_number: { contains: variant } },
                  { phone: { contains: variant } },
                ]),
              };
            },
          );

          where = { ...scope, AND: conditions };
        }

        let rows: any[] = await prisma.users.findMany({
          where,
          select: CUSTOMER_CARD_SELECT,
          orderBy: { created_at: 'desc' },
          take: limit + 1,
        });

        let usedFuzzyPass = false;
        let scanCapReached = false;

        if (!rows.length) {
          // Accent-insensitive / phone-format-insensitive second pass. Bounded
          // scan, deliberately cheap: only the identifying columns.
          usedFuzzyPass = true;
          const pool: any[] = await prisma.users.findMany({
            where: scope,
            select: CUSTOMER_CARD_SELECT,
            orderBy: { created_at: 'desc' },
            take: FUZZY_SCAN_CAP,
          });
          scanCapReached = pool.length === FUZZY_SCAN_CAP;

          const normalizedTokens = normalize(rawQuery)
            .split(/\s+/)
            .filter(Boolean);

          rows = pool
            .filter((user) => {
              const phoneDigits = digitsOnly(user.phone);
              const documentDigits = digitsOnly(user.document_number);

              if (looksNumeric) {
                return (
                  (phoneDigits.length > 0 && phoneDigits.endsWith(digits)) ||
                  (documentDigits.length > 0 && documentDigits.includes(digits))
                );
              }

              const haystack = normalize(
                [
                  user.first_name,
                  user.last_name,
                  user.email,
                  user.document_number,
                  phoneDigits,
                ]
                  .filter(Boolean)
                  .join(' '),
              );
              return normalizedTokens.every((token) =>
                haystack.includes(token),
              );
            })
            .slice(0, limit + 1);
        }

        const truncated = rows.length > limit;
        const page = rows.slice(0, limit);

        if (!page.length) {
          return JSON.stringify({
            query: rawQuery,
            match_count: 0,
            customers: [],
            scanned_cap_reached: scanCapReached || undefined,
            next_step:
              'Ningún cliente coincide. Pregunta al usuario por el documento o el teléfono; si tienes semantic_search disponible y lo describió de forma indirecta, pruébala. No inventes un customer_id.',
          });
        }

        const ids = page.map((user) => user.id);
        // Cities are read through the `users` relation, not through a
        // top-level `addresses` query: `addresses` IS store-scoped, and a
        // customer address saved from the POS can carry `store_id = null`,
        // which the scope filter would silently drop.
        const [stats, withAddresses, currency] = await Promise.all([
          loadPurchaseStats(ids),
          prisma.users.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              addresses: {
                where: { type: 'shipping' },
                orderBy: { is_primary: 'desc' },
                take: 1,
                select: { city: true },
              },
            },
          }) as Promise<any[]>,
          resolveCurrencyFromOrders(),
        ]);

        const cityByUser = new Map<number, string>();
        for (const row of withAddresses) {
          const city = row.addresses?.[0]?.city;
          if (city) cityByUser.set(row.id, city);
        }

        const now = new Date();
        const customers = page.map((user) => {
          const aggregate = stats.get(user.id);
          return {
            customer_id: user.id,
            name: fullName(user),
            document: formatDocument(user),
            phone: user.phone ?? null,
            email: user.email ?? null,
            city: cityByUser.get(user.id) ?? null,
            state: user.state,
            finished_orders: aggregate?.orders ?? 0,
            total_spent: aggregate ? round2(aggregate.spent) : 0,
            last_purchase_at: isoDate(aggregate?.last_purchase_at ?? null),
            days_since_last_purchase: daysSince(
              aggregate?.last_purchase_at ?? null,
              now,
            ),
          };
        });

        return JSON.stringify({
          query: rawQuery,
          matched_by: usedFuzzyPass ? `${matchedBy}_aproximado` : matchedBy,
          match_count: customers.length,
          truncated: truncated || undefined,
          scanned_cap_reached: scanCapReached || undefined,
          ambiguous: customers.length > 1,
          currency: currency ?? undefined,
          customers,
          next_step:
            customers.length > 1
              ? 'Hay más de un cliente posible. Muéstraselos al usuario (nombre + documento + ciudad + última compra) y pídele que confirme cuál antes de seguir.'
              : 'Usa customer_id con get_customer_history para ver su historial de compras.',
        });
      },
    },

    // ─── Tool 2: get_customer_history ────────────────────────────────
    {
      name: 'get_customer_history',
      domain: 'customers',
      readOnly: true,
      description:
        'Ficha completa de UN cliente: datos de contacto, cuánto ha comprado, cuánto debe, sus últimas órdenes y los productos que más lleva. Úsala cuando el usuario pregunte "qué compra fulano", "cuánto nos debe", "cuándo vino por última vez". Requiere customer_id: si solo tienes el nombre, llama primero a find_customer.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'number',
            description: 'ID del cliente, obtenido con find_customer.',
          },
          limit: {
            type: 'number',
            description:
              'Cuántas órdenes recientes detallar. Por defecto 10, tope 25.',
          },
          include_top_products: {
            type: 'boolean',
            description:
              'Incluir los productos que más ha comprado. Por defecto true.',
          },
        },
        required: ['customer_id'],
      },
      requiredPermissions: ['store:customers:read'],
      handler: async (args, context) => {
        const storeId = context.store_id;
        if (!storeId) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: el historial de un cliente es siempre relativo a una tienda.',
          });
        }

        const customerId = Number(args.customer_id);
        if (!Number.isInteger(customerId) || customerId <= 0) {
          return JSON.stringify({
            error:
              'customer_id inválido. Resuelve el cliente con find_customer antes de pedir su historial.',
          });
        }

        const limit = clampLimit(args.limit, 10, 25);
        const includeTopProducts = args.include_top_products !== false;

        let customer: any;
        try {
          customer = await customersService.findOne(storeId, customerId);
        } catch {
          return JSON.stringify({
            error: `No existe un cliente con id ${customerId} en esta tienda.`,
            next_step:
              'Usa find_customer con el nombre, documento o teléfono para obtener el customer_id correcto.',
          });
        }

        const [recentOrders, finishedAggregate, openBalance, bookingsCount] =
          await Promise.all([
            prisma.orders.findMany({
              where: { customer_id: customerId },
              orderBy: { created_at: 'desc' },
              take: limit,
              select: {
                id: true,
                order_number: true,
                state: true,
                channel: true,
                grand_total: true,
                total_paid: true,
                remaining_balance: true,
                currency: true,
                created_at: true,
                completed_at: true,
              },
            }) as Promise<any[]>,
            prisma.orders.aggregate({
              where: { customer_id: customerId, state: 'finished' },
              _count: { _all: true },
              _sum: { grand_total: true },
              _max: { created_at: true },
              _min: { created_at: true },
            }) as Promise<any>,
            prisma.orders.aggregate({
              where: {
                customer_id: customerId,
                state: { notIn: ['cancelled', 'refunded', 'draft'] },
                remaining_balance: { gt: 0 },
              },
              _count: { _all: true },
              _sum: { remaining_balance: true },
            }) as Promise<any>,
            prisma.bookings.count({ where: { customer_id: customerId } }),
          ]);

        let topProducts: any[] = [];
        if (includeTopProducts) {
          const grouped = (await prisma.order_items.groupBy({
            by: ['product_name'],
            where: { orders: { customer_id: customerId, state: 'finished' } },
            _sum: { quantity: true, total_price: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
          })) as any[];

          topProducts = grouped.map((row) => ({
            product: row.product_name,
            units: row._sum?.quantity ?? 0,
            amount: round2(toAmount(row._sum?.total_price)),
          }));
        }

        const finishedCount = finishedAggregate?._count?._all ?? 0;
        const totalSpent = toAmount(finishedAggregate?._sum?.grand_total);
        const now = new Date();
        const currency =
          recentOrders.find((order) => order.currency)?.currency ??
          (await resolveCurrencyFromOrders());

        const primaryAddress = customer.addresses?.[0] ?? null;

        return JSON.stringify({
          customer: {
            customer_id: customer.id,
            name: fullName(customer),
            document: formatDocument(customer),
            phone: customer.phone ?? null,
            email: customer.email ?? null,
            state: customer.state,
            person_type: customer.person_type ?? null,
            tax_regime: customer.tax_regime ?? null,
            is_withholding_agent: customer.is_withholding_agent ?? false,
            city: primaryAddress?.city ?? null,
            address: primaryAddress?.address_line1 ?? null,
            customer_since: isoDate(customer.created_at),
          },
          currency: currency ?? undefined,
          purchase_summary: {
            finished_orders: finishedCount,
            total_spent: round2(totalSpent),
            average_ticket:
              finishedCount > 0 ? round2(totalSpent / finishedCount) : 0,
            first_purchase_at: isoDate(finishedAggregate?._min?.created_at),
            last_purchase_at: isoDate(finishedAggregate?._max?.created_at),
            days_since_last_purchase: daysSince(
              finishedAggregate?._max?.created_at ?? null,
              now,
            ),
          },
          open_balance: {
            orders_with_balance: openBalance?._count?._all ?? 0,
            amount_due: round2(toAmount(openBalance?._sum?.remaining_balance)),
            note: 'Suma de remaining_balance de órdenes vivas (excluye canceladas, reembolsadas y borradores).',
          },
          bookings_count: bookingsCount,
          recent_orders: recentOrders.map((order) => ({
            order_id: order.id,
            order_number: order.order_number,
            state: order.state,
            channel: order.channel,
            total: round2(toAmount(order.grand_total)),
            paid: round2(toAmount(order.total_paid)),
            balance: round2(toAmount(order.remaining_balance)),
            created_at: isoDate(order.created_at),
            completed_at: isoDate(order.completed_at),
          })),
          top_products: includeTopProducts ? topProducts : undefined,
          note: 'Los importes gastados solo cuentan órdenes en estado finished; recent_orders muestra todos los estados.',
        });
      },
    },

    // ─── Tool 3: get_customer_segments ───────────────────────────────
    {
      name: 'get_customer_segments',
      domain: 'customers',
      readOnly: true,
      description:
        'Clasifica a los clientes de la tienda en grupos accionables a partir de sus compras reales: RFM (qué tan reciente, qué tan seguido y cuánto compran), por gasto o por frecuencia. Úsala para responder "a quién le hago una promo", "qué clientes se me están enfriando", "quiénes son mis mejores clientes". Devuelve el tamaño de cada grupo, su gasto medio y unos pocos ejemplos con customer_id para encadenar con get_customer_history.',
      parameters: {
        type: 'object',
        properties: {
          criteria: {
            type: 'string',
            enum: ['rfm', 'spending', 'frequency'],
            description:
              'rfm: recencia + frecuencia + gasto (por defecto). spending: quintiles de gasto. frequency: tramos por número de compras.',
          },
          period_days: {
            type: 'number',
            description:
              'Ventana de análisis en días hacia atrás. Por defecto 365, mínimo 30, máximo 1095.',
          },
          include_examples: {
            type: 'boolean',
            description:
              'Incluir ejemplos de clientes por grupo. Por defecto true.',
          },
          examples_per_segment: {
            type: 'number',
            description: 'Ejemplos por grupo. Por defecto 3, tope 5.',
          },
        },
      },
      requiredPermissions: ['store:customers:read'],
      handler: async (args, context) => {
        const storeId = context.store_id;
        if (!storeId) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: la segmentación se calcula por tienda.',
          });
        }

        const criteria = ['rfm', 'spending', 'frequency'].includes(
          String(args.criteria),
        )
          ? String(args.criteria)
          : 'rfm';
        const periodDays = Math.min(
          Math.max(Number(args.period_days) || 365, 30),
          1095,
        );
        const includeExamples = args.include_examples !== false;
        const examplesPerSegment = clampLimit(args.examples_per_segment, 3, 5);

        const now = new Date();
        const since = new Date(now.getTime() - periodDays * 86_400_000);

        const grouped = (await prisma.orders.groupBy({
          by: ['customer_id'],
          where: {
            state: 'finished',
            customer_id: { not: null },
            created_at: { gte: since },
          },
          _count: { _all: true },
          _sum: { grand_total: true },
          _max: { created_at: true },
          orderBy: { _sum: { grand_total: 'desc' } },
          take: 5000,
        })) as any[];

        const population: CustomerAggregate[] = grouped
          .filter((row) => row.customer_id != null)
          .map((row) => ({
            customer_id: row.customer_id as number,
            orders: row._count?._all ?? 0,
            spent: toAmount(row._sum?.grand_total),
            last_purchase_at: row._max?.created_at ?? null,
          }));

        if (!population.length) {
          return JSON.stringify({
            criteria,
            period: { days: periodDays, from: since.toISOString() },
            customers_analyzed: 0,
            segments: [],
            note: 'No hay órdenes finalizadas en el período: no se puede segmentar todavía. Prueba con un period_days mayor.',
          });
        }

        const recencyDays = population.map(
          (row) => daysSince(row.last_purchase_at, now) ?? periodDays,
        );
        const sortedRecency = [...recencyDays].sort((a, b) => a - b);
        const sortedFrequency = population
          .map((row) => row.orders)
          .sort((a, b) => a - b);
        const sortedMonetary = population
          .map((row) => row.spent)
          .sort((a, b) => a - b);

        const buckets = new Map<string, CustomerAggregate[]>();
        const push = (segment: string, row: CustomerAggregate) => {
          const list = buckets.get(segment);
          if (list) list.push(row);
          else buckets.set(segment, [row]);
        };

        const spendingRanges = new Map<string, { min: number; max: number }>();

        population.forEach((row, index) => {
          const monetaryScore = quintileScore(sortedMonetary, row.spent);

          if (criteria === 'spending') {
            const label = SPENDING_LABELS[monetaryScore - 1];
            const range = spendingRanges.get(label);
            spendingRanges.set(label, {
              min: range ? Math.min(range.min, row.spent) : row.spent,
              max: range ? Math.max(range.max, row.spent) : row.spent,
            });
            push(label, row);
            return;
          }

          if (criteria === 'frequency') {
            push(frequencyBucket(row.orders), row);
            return;
          }

          // Recency is inverted on purpose: fewer days since the last purchase
          // must score higher.
          const recencyScore =
            6 - quintileScore(sortedRecency, recencyDays[index]);
          const frequencyScore = quintileScore(sortedFrequency, row.orders);
          push(rfmSegment(recencyScore, frequencyScore, monetaryScore), row);
        });

        const exampleIds = includeExamples
          ? Array.from(buckets.values()).flatMap((rows) =>
              [...rows]
                .sort((a, b) => b.spent - a.spent)
                .slice(0, examplesPerSegment)
                .map((row) => row.customer_id),
            )
          : [];

        const nameById = new Map<number, string>();
        if (exampleIds.length) {
          const users: any[] = await prisma.users.findMany({
            where: {
              id: { in: exampleIds },
              ...customerScope(storeId, true),
            },
            select: { id: true, first_name: true, last_name: true },
          });
          for (const user of users) nameById.set(user.id, fullName(user));
        }

        const totalCustomers = population.length;
        const segments = Array.from(buckets.entries())
          .map(([segment, rows]) => {
            const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
            const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
            const range = spendingRanges.get(segment);
            return {
              segment,
              definition:
                criteria === 'rfm'
                  ? RFM_DEFINITIONS[segment]
                  : criteria === 'spending'
                    ? `Gasto entre ${round2(range?.min ?? 0)} y ${round2(range?.max ?? 0)} en el período.`
                    : `Clientes con ${segment.toLowerCase()} en el período.`,
              customers: rows.length,
              share_pct: round2((rows.length / totalCustomers) * 100),
              avg_orders: round2(totalOrders / rows.length),
              avg_spent: round2(totalSpent / rows.length),
              total_spent: round2(totalSpent),
              examples: includeExamples
                ? [...rows]
                    .sort((a, b) => b.spent - a.spent)
                    .slice(0, examplesPerSegment)
                    .map((row) => ({
                      customer_id: row.customer_id,
                      name: nameById.get(row.customer_id) ?? null,
                      orders: row.orders,
                      spent: round2(row.spent),
                      days_since_last_purchase: daysSince(
                        row.last_purchase_at,
                        now,
                      ),
                    }))
                : undefined,
            };
          })
          .sort((a, b) => b.customers - a.customers);

        const currency = await resolveCurrencyFromOrders();

        return JSON.stringify({
          criteria,
          period: {
            days: periodDays,
            from: since.toISOString(),
            to: now.toISOString(),
          },
          currency: currency ?? undefined,
          customers_analyzed: totalCustomers,
          orders_considered: population.reduce(
            (sum, row) => sum + row.orders,
            0,
          ),
          population_capped: grouped.length === 5000 || undefined,
          segments,
          note: 'Solo se cuentan órdenes en estado finished dentro del período. Los clientes sin ninguna compra en la ventana no aparecen en ningún grupo.',
        });
      },
    },
  ];
}
