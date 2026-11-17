import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { buildActiveUserRolesWhere } from '../../../common/utils/role-scope.util';
import { ReminderLinkType } from './dto/reminders.dto';

/**
 * QUI-580 — catalogue of the store records a reminder can link to: readable
 * type, READ permission, admin route, and the store-bound lookups used by the
 * link search, the "no disponible" check and the due job.
 *
 * Every query carries an explicit store (or organization) predicate, so the
 * same code is safe on the scoped `StorePrismaService` (API, defence in
 * depth) and on the unscoped `GlobalPrismaService` (due job, no context).
 */

/** Records with an id; `metric` only carries a label. */
export type ReminderRecordType = Exclude<ReminderLinkType, 'metric'>;

export interface ReminderLinkScope {
  store_id: number;
  /** Suppliers belong to the organization; `null` finds no supplier. */
  organization_id: number | null;
}

/** What a user may open: super admins everything, the rest by READ permission. */
export interface ReminderLinkAccess {
  super_admin: boolean;
  permissions: ReadonlySet<string>;
}

/** Models the lookups touch; both Prisma services expose them. */
export type ReminderLinkDb = Pick<
  GlobalPrismaService,
  | 'products'
  | 'orders'
  | 'store_users'
  | 'suppliers'
  | 'purchase_orders'
  | 'quotations'
  | 'invoices'
>;

export interface ReminderLinkRecord {
  id: number;
  label: string;
}

/** One search hit, ready to show ("Orden de compra · OC-0001") and to save. */
export interface ReminderLinkOption extends ReminderLinkRecord {
  type: ReminderRecordType;
  type_label: string;
  url: string;
}

interface RecordTypeSpec {
  type_label: string;
  /** READ permissions of the record's module; any of them grants access. */
  permissions: readonly string[];
  route: (id: number) => string;
  /** The records among `ids` that exist in the scope (missing = deleted or foreign). */
  find(db: ReminderLinkDb, scope: ReminderLinkScope, ids: number[]): Promise<ReminderLinkRecord[]>;
  /** Up to `take` records of the scope that match `q`, newest first. */
  search(
    db: ReminderLinkDb,
    scope: ReminderLinkScope,
    q: string,
    take: number,
  ): Promise<ReminderLinkRecord[]>;
}

/** Route of the `metric` link: the dashboard. */
export const METRIC_LINK_ROUTE = '/admin/dashboard';
export const METRIC_TYPE_LABEL = 'Métrica';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const newestFirst = { id: 'desc' as const };

/**
 * Suppliers the store's own supplier profile can open: its own and the
 * organization-wide ones (`store_id NULL`), never a sibling store's (same rule
 * as `SuppliersService.findSupplierForProfile`).
 */
const supplierScope = (organizationId: number, storeId: number) => ({
  organization_id: organizationId,
  OR: [{ store_id: storeId }, { store_id: null }],
});

const customerName = (
  userId: number,
  user: { first_name: string | null; last_name: string | null } | null,
) =>
  [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
  `Cliente #${userId}`;

export const REMINDER_RECORD_TYPES: Record<ReminderRecordType, RecordTypeSpec> = {
  product: {
    type_label: 'Producto',
    permissions: ['store:products:read'],
    route: (id) => `/admin/products/${id}`,
    async find(db, scope, ids) {
      // Archiving is how a product is deleted: its link is no longer available.
      const rows = await db.products.findMany({
        where: { store_id: scope.store_id, id: { in: ids }, state: { not: 'archived' } },
        select: { id: true, name: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.name }));
    },
    async search(db, scope, q, take) {
      const rows = await db.products.findMany({
        where: {
          store_id: scope.store_id,
          state: { not: 'archived' },
          OR: [{ name: contains(q) }, { sku: contains(q) }],
        },
        select: { id: true, name: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.name }));
    },
  },
  order: {
    type_label: 'Orden de venta',
    permissions: ['store:orders:read'],
    route: (id) => `/admin/orders/${id}`,
    async find(db, scope, ids) {
      const rows = await db.orders.findMany({
        where: { store_id: scope.store_id, id: { in: ids } },
        select: { id: true, order_number: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.order_number }));
    },
    async search(db, scope, q, take) {
      const rows = await db.orders.findMany({
        where: { store_id: scope.store_id, order_number: contains(q) },
        select: { id: true, order_number: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.order_number }));
    },
  },
  customer: {
    type_label: 'Cliente',
    permissions: ['store:customers:read'],
    route: (id) => `/admin/customers/${id}`,
    async find(db, scope, ids) {
      const rows = await db.store_users.findMany({
        where: { store_id: scope.store_id, user_id: { in: ids } },
        select: { user_id: true, user: { select: { first_name: true, last_name: true } } },
      });
      return rows.map((r) => ({ id: r.user_id, label: customerName(r.user_id, r.user) }));
    },
    async search(db, scope, q, take) {
      const rows = await db.store_users.findMany({
        where: {
          store_id: scope.store_id,
          user: {
            user_roles: { some: { roles: { name: 'customer' } } },
            OR: [
              { first_name: contains(q) },
              { last_name: contains(q) },
              { email: contains(q) },
              { document_number: contains(q) },
            ],
          },
        },
        select: { user_id: true, user: { select: { first_name: true, last_name: true } } },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.user_id, label: customerName(r.user_id, r.user) }));
    },
  },
  supplier: {
    type_label: 'Proveedor',
    permissions: ['store:inventory:suppliers:read'],
    route: (id) => `/admin/inventory/suppliers/${id}`,
    async find(db, scope, ids) {
      if (scope.organization_id === null) return [];
      const rows = await db.suppliers.findMany({
        where: {
          ...supplierScope(scope.organization_id, scope.store_id),
          id: { in: ids },
          state: { not: 'archived' },
        },
        select: { id: true, name: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.name }));
    },
    async search(db, scope, q, take) {
      if (scope.organization_id === null) return [];
      const rows = await db.suppliers.findMany({
        where: {
          ...supplierScope(scope.organization_id, scope.store_id),
          state: { not: 'archived' },
          AND: [{ OR: [{ name: contains(q) }, { code: contains(q) }] }],
        },
        select: { id: true, name: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.name }));
    },
  },
  purchase_order: {
    type_label: 'Orden de compra',
    permissions: ['store:orders:purchase_orders:read'],
    route: (id) => `/admin/orders/purchase-orders/${id}`,
    async find(db, scope, ids) {
      const rows = await db.purchase_orders.findMany({
        where: { location: { store_id: scope.store_id }, id: { in: ids } },
        select: { id: true, order_number: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.order_number }));
    },
    async search(db, scope, q, take) {
      const rows = await db.purchase_orders.findMany({
        where: { location: { store_id: scope.store_id }, order_number: contains(q) },
        select: { id: true, order_number: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.order_number }));
    },
  },
  quotation: {
    type_label: 'Cotización',
    // The quotation detail (`GET quotations/:id`) requires `read:one`, not the list permission.
    permissions: ['store:quotations:read:one'],
    route: (id) => `/admin/orders/quotations/${id}`,
    async find(db, scope, ids) {
      const rows = await db.quotations.findMany({
        where: { store_id: scope.store_id, id: { in: ids } },
        select: { id: true, quotation_number: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.quotation_number }));
    },
    async search(db, scope, q, take) {
      const rows = await db.quotations.findMany({
        where: { store_id: scope.store_id, quotation_number: contains(q) },
        select: { id: true, quotation_number: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.quotation_number }));
    },
  },
  invoice: {
    type_label: 'Factura',
    permissions: ['invoicing:read'],
    // The invoices list opens the invoice detail from `?invoiceId=`.
    route: (id) => `/admin/invoicing/invoices?invoiceId=${id}`,
    async find(db, scope, ids) {
      const rows = await db.invoices.findMany({
        where: { store_id: scope.store_id, id: { in: ids } },
        select: { id: true, invoice_number: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.invoice_number ?? `#${r.id}` }));
    },
    async search(db, scope, q, take) {
      const rows = await db.invoices.findMany({
        where: { store_id: scope.store_id, invoice_number: contains(q) },
        select: { id: true, invoice_number: true },
        orderBy: newestFirst,
        take,
      });
      return rows.map((r) => ({ id: r.id, label: r.invoice_number ?? `#${r.id}` }));
    },
  },
};

export const REMINDER_RECORD_TYPE_KEYS = Object.keys(
  REMINDER_RECORD_TYPES,
) as ReminderRecordType[];

/** Spec of a stored `link_type`; `undefined` for a value outside the catalogue. */
function recordSpec(type: ReminderLinkType): RecordTypeSpec | undefined {
  return Object.prototype.hasOwnProperty.call(REMINDER_RECORD_TYPES, type)
    ? REMINDER_RECORD_TYPES[type as ReminderRecordType]
    : undefined;
}

export function linkTypeLabel(type: ReminderLinkType): string {
  if (type === 'metric') return METRIC_TYPE_LABEL;
  return recordSpec(type)?.type_label ?? 'Registro';
}

/** Admin route of a link (`null` for a record link without id or an unknown type). */
export function linkRoute(type: ReminderLinkType, id: number | null): string | null {
  if (type === 'metric') return METRIC_LINK_ROUTE;
  const spec = recordSpec(type);
  return spec && id ? spec.route(id) : null;
}

/** Whether the user may open records of this type (a metric is the dashboard). */
export function canOpenLink(type: ReminderLinkType, access: ReminderLinkAccess): boolean {
  if (type === 'metric') return true;
  const spec = recordSpec(type);
  if (!spec) return false;
  return access.super_admin || spec.permissions.some((p) => access.permissions.has(p));
}

/** Access of the session user (HTTP request or Vex execution context). */
export function accessFromContext(
  context: { is_super_admin?: boolean; permissions?: string[] } | undefined,
): ReminderLinkAccess {
  return {
    super_admin: context?.is_super_admin === true,
    permissions: new Set(context?.permissions ?? []),
  };
}

/**
 * Access of a user in a store without a request (due job). Same source as the
 * JWT strategy and the agent worker: the user's active roles for that store
 * (`buildActiveUserRolesWhere`) and their granted, active permissions.
 */
export async function loadUserLinkAccess(
  db: Pick<GlobalPrismaService, 'user_roles'>,
  userId: number,
  storeId: number,
): Promise<ReminderLinkAccess> {
  const assignments = await db.user_roles.findMany({
    where: buildActiveUserRolesWhere(userId, storeId),
    select: {
      roles: {
        select: {
          name: true,
          role_permissions: {
            where: { granted: true, permissions: { status: 'active' } },
            select: { permissions: { select: { name: true } } },
          },
        },
      },
    },
  });
  const permissions = new Set<string>();
  let superAdmin = false;
  for (const assignment of assignments) {
    if (assignment.roles?.name === 'super_admin') superAdmin = true;
    for (const entry of assignment.roles?.role_permissions ?? []) {
      if (entry.permissions?.name) permissions.add(entry.permissions.name);
    }
  }
  return { super_admin: superAdmin, permissions };
}

/** `type:id` key of a record link. */
export const linkKey = (type: ReminderRecordType, id: number) => `${type}:${id}`;

/**
 * Current label of every linked record that still exists in the scope, keyed
 * by {@link linkKey}: one query per type present. A link missing from the map
 * was deleted or never belonged to this store.
 */
export async function findLinkedRecords(
  db: ReminderLinkDb,
  scope: ReminderLinkScope,
  links: ReadonlyArray<{ type: ReminderLinkType; id: number | null }>,
): Promise<Map<string, string>> {
  const idsByType = new Map<ReminderRecordType, Set<number>>();
  for (const link of links) {
    if (link.type === 'metric' || !link.id || !recordSpec(link.type)) continue;
    const type = link.type as ReminderRecordType;
    const ids = idsByType.get(type) ?? new Set<number>();
    ids.add(link.id);
    idsByType.set(type, ids);
  }
  const found = new Map<string, string>();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      const records = await REMINDER_RECORD_TYPES[type].find(db, scope, [...ids]);
      for (const record of records) found.set(linkKey(type, record.id), record.label);
    }),
  );
  return found;
}

/**
 * The link search: every type the user may open, queried in parallel inside
 * the scope. Types without permission are never queried.
 */
export async function searchLinkableRecords(
  db: ReminderLinkDb,
  scope: ReminderLinkScope,
  access: ReminderLinkAccess,
  q: string,
  perType: number,
): Promise<ReminderLinkOption[]> {
  const types = REMINDER_RECORD_TYPE_KEYS.filter((type) => canOpenLink(type, access));
  const groups = await Promise.all(
    types.map(async (type) => {
      const spec = REMINDER_RECORD_TYPES[type];
      const records = await spec.search(db, scope, q, perType);
      return records.map((record) => ({
        type,
        type_label: spec.type_label,
        id: record.id,
        label: record.label,
        url: spec.route(record.id),
      }));
    }),
  );
  return groups.flat();
}
