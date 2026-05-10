import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/**
 * Where filter shape returned by {@link OrganizationPrismaService.getScopedWhere}.
 * - operating_scope=ORGANIZATION → `{ organization_id }`, opcional `store_id` para breakdown.
 * - operating_scope=STORE → `{ organization_id, store_id }` (store_id obligatorio).
 */
export interface OrganizationScopedWhere {
  organization_id: number;
  store_id?: number;
}

@Injectable()
export class OrganizationPrismaService extends BasePrismaService {
  private readonly org_scoped_models = [
    'users',
    'stores',
    'suppliers',
    'addresses',
    'audit_logs',
    'roles',
    'organization_settings',
    'domain_settings',
    'inventory_locations',
    'inventory_movements',
    'inventory_adjustments',
    'stock_reservations',
    'purchase_orders',
    'sales_orders',
    'stock_transfers',
    'return_orders',
    'organization_payment_policies',
    'support_tickets',
    'invoices',
    'invoice_resolutions',
    'chart_of_accounts',
    'fiscal_periods',
    'accounting_entries',
    'accounting_entry_lines',
    'employees',
    'payroll_runs',
    'payroll_items',
    'partner_plan_overrides',
    'partner_commissions',
    'partner_payout_batches',
    'inventory_transactions',
    'inventory_cost_layers',
    'inventory_valuation_snapshots',
    'stock_levels',
  ];

  /**
   * Per-model scope overrides for org-scoping.
   *
   * Models that do NOT have a direct `organization_id` column must traverse a
   * relation. Each entry returns the Prisma `where` filter fragment to AND with
   * any caller-provided filter.
   *
   * - `stock_levels` → no `organization_id`; scope via `inventory_locations.organization_id`.
   */
  private readonly SCOPE_OVERRIDES: Record<string, (orgId: number) => any> = {
    stock_levels: (orgId) => ({
      inventory_locations: { is: { organization_id: orgId } },
    }),
    // accounting_entry_lines: no organization_id; scope via entry.organization_id
    accounting_entry_lines: (orgId) => ({
      entry: { is: { organization_id: orgId } },
    }),
    // payroll_items: no organization_id; scope via payroll_run.organization_id
    payroll_items: (orgId) => ({
      payroll_run: { is: { organization_id: orgId } },
    }),
    // domain_settings: org isolation is dual — direct org domains have
    // organization_id set, store domains have store_id set and inherit org via
    // the related store. OR is required because direct AND on organization_id
    // would filter out store-linked domains where organization_id is null.
    domain_settings: (orgId) => ({
      OR: [
        { organization_id: orgId },
        { store: { is: { organization_id: orgId } } },
      ],
    }),
  };

  constructor(
    @Optional()
    @Inject(forwardRef(() => OperatingScopeService))
    private readonly operatingScopeService?: OperatingScopeService,
  ) {
    super();
    this.setupOrganizationScoping();
  }

  private setupOrganizationScoping() {
    const extensions = this.createOrganizationQueryExtensions();
    this.scoped_client = this.baseClient.$extends({ query: extensions });
  }

  private createOrganizationQueryExtensions() {
    const extensions: any = {};
    const operations = [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'groupBy',
      'aggregate',
      'upsert',
    ];

    for (const model of this.org_scoped_models) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applyOrganizationScoping(model, args, query);
        };
      }
    }

    return extensions;
  }

  private applyOrganizationScoping(model: string, args: any, query: any) {
    const context = RequestContextService.getContext();

    if (!context) {
      throw new UnauthorizedException(
        'Unauthorized access - no request context',
      );
    }

    const scoped_args = { ...args };

    if (this.org_scoped_models.includes(model)) {
      if (!context.organization_id) {
        throw new ForbiddenException(
          'Access denied - organization context required',
        );
      }

      // Filtro especial para roles: incluir roles de la organización actual Y roles del sistema (organization_id = null)
      if (model === 'roles') {
        const existingWhere = scoped_args.where || {};
        scoped_args.where = {
          ...existingWhere,
          OR: [
            { organization_id: context.organization_id },
            { organization_id: null },
          ],
        };
      } else if (this.SCOPE_OVERRIDES[model]) {
        // Modelos sin columna directa organization_id (scope relacional).
        const overrideFilter = this.SCOPE_OVERRIDES[model](
          context.organization_id,
        );
        const existingWhere = scoped_args.where;
        scoped_args.where = existingWhere
          ? { AND: [existingWhere, overrideFilter] }
          : overrideFilter;
      } else {
        // Para otros modelos: solo filtrar por organization_id
        const existingWhere = scoped_args.where || {};
        scoped_args.where = {
          ...existingWhere,
          organization_id: context.organization_id,
        };
      }
    }

    return query(scoped_args);
  }

  private scoped_client: any;

  // Organization-scoped models with automatic filtering
  get users() {
    return this.scoped_client.users;
  }

  get stores() {
    return this.scoped_client.stores;
  }

  get suppliers() {
    return this.scoped_client.suppliers;
  }

  get addresses() {
    return this.scoped_client.addresses;
  }

  get audit_logs() {
    return this.scoped_client.audit_logs;
  }

  // Global models (no scoping applied)
  get organizations() {
    return this.baseClient.organizations;
  }

  get brands() {
    return this.baseClient.brands;
  }

  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  }

  get organization_payment_policies() {
    return this.baseClient.organization_payment_policies;
  }

  get roles() {
    return this.scoped_client.roles;
  }

  get permissions() {
    return this.scoped_client.permissions;
  }

  get user_roles() {
    return this.scoped_client.user_roles;
  }

  get role_permissions() {
    return this.scoped_client.role_permissions;
  }

  get user_settings() {
    return this.scoped_client.user_settings;
  }

  get refresh_tokens() {
    return this.scoped_client.refresh_tokens;
  }

  get password_reset_tokens() {
    return this.scoped_client.password_reset_tokens;
  }

  get email_verification_tokens() {
    return this.scoped_client.email_verification_tokens;
  }

  get user_sessions() {
    return this.scoped_client.user_sessions;
  }

  get login_attempts() {
    return this.scoped_client.login_attempts;
  }

  get organization_settings() {
    return this.scoped_client.organization_settings;
  }

  get domain_settings() {
    return this.scoped_client.domain_settings;
  }

  get inventory_locations() {
    return this.scoped_client.inventory_locations;
  }

  get inventory_movements() {
    return this.scoped_client.inventory_movements;
  }

  get inventory_adjustments() {
    return this.scoped_client.inventory_adjustments;
  }

  get inventory_transactions() {
    return this.scoped_client.inventory_transactions;
  }

  get inventory_cost_layers() {
    return this.scoped_client.inventory_cost_layers;
  }

  get inventory_valuation_snapshots() {
    return this.scoped_client.inventory_valuation_snapshots;
  }

  get stock_levels() {
    return this.scoped_client.stock_levels;
  }

  get stock_transfers() {
    return this.scoped_client.stock_transfers;
  }

  get purchase_orders() {
    return this.scoped_client.purchase_orders;
  }

  // Non-scoped models (no organization filtering applied)
  get store_settings() {
    return this.baseClient.store_settings;
  }

  get orders() {
    return this.baseClient.orders;
  }

  get products() {
    return this.baseClient.products;
  }

  // inventory_batches has no direct organization_id column. Manual relation
  // filter via `products.organization_id` is required at the call site.
  get inventory_batches() {
    return this.baseClient.inventory_batches;
  }

  get order_items() {
    return this.baseClient.order_items;
  }

  get store_payment_methods() {
    return this.baseClient.store_payment_methods;
  }

  // Support models
  get support_tickets() {
    return this.scoped_client.support_tickets;
  }

  get support_attachments() {
    return this.baseClient.support_attachments;
  }

  get support_comments() {
    return this.baseClient.support_comments;
  }

  get support_status_history() {
    return this.baseClient.support_status_history;
  }

  get support_notifications() {
    return this.baseClient.support_notifications;
  }

  // Invoicing models
  get invoices() {
    return this.scoped_client.invoices;
  }

  get invoice_resolutions() {
    return this.scoped_client.invoice_resolutions;
  }

  // Accounting models
  get chart_of_accounts() {
    return this.scoped_client.chart_of_accounts;
  }

  get fiscal_periods() {
    return this.scoped_client.fiscal_periods;
  }

  get accounting_entries() {
    return this.scoped_client.accounting_entries;
  }

  get accounting_entry_lines() {
    return this.scoped_client.accounting_entry_lines;
  }

  // Payroll models
  get employees() {
    return this.scoped_client.employees;
  }

  get payroll_runs() {
    return this.scoped_client.payroll_runs;
  }

  get payroll_items() {
    return this.scoped_client.payroll_items;
  }

  get partner_plan_overrides() {
    return this.scoped_client.partner_plan_overrides;
  }

  get partner_commissions() {
    return this.scoped_client.partner_commissions;
  }

  get partner_payout_batches() {
    return this.scoped_client.partner_payout_batches;
  }

  // Onboarding state (no scoping - has its own FK to organization)
  get organization_onboarding_state() {
    return this.baseClient.organization_onboarding_state;
  }

  // Operating scope audit log (Phase 4 wizard) — scoping manual: usar siempre con organization_id explícito
  get operating_scope_audit_log() {
    return this.baseClient.operating_scope_audit_log;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Consolidation helpers (operating_scope-aware)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Devuelve un `where` Prisma listo para queries consolidadas vs aisladas según
   * el `operating_scope` de la organización.
   *
   * - Si `operating_scope === 'ORGANIZATION'`: retorna `{ organization_id }`.
   *   Si se pide `store_id_filter`, se valida que el store pertenezca a la org y
   *   se incluye como filtro opcional (breakdown por tienda en endpoints ORG).
   * - Si `operating_scope === 'STORE'`: `store_id_filter` es obligatorio y debe
   *   pertenecer a la org. Retorna `{ organization_id, store_id }`.
   *
   * Nota: este helper no tira si la organización es ORGANIZATION y no se pasa
   * store_id_filter; ese es el caso consolidado normal.
   */
  async getScopedWhere(params: {
    organization_id: number;
    store_id_filter?: number | null;
  }): Promise<OrganizationScopedWhere> {
    const { organization_id, store_id_filter } = params;

    if (!organization_id || !Number.isFinite(organization_id)) {
      throw new BadRequestException('organization_id is required');
    }

    if (!this.operatingScopeService) {
      throw new BadRequestException(
        'OperatingScopeService is not available in this context',
      );
    }

    const scope = await this.operatingScopeService.getOperatingScope(
      organization_id,
    );

    if (scope === 'ORGANIZATION') {
      if (store_id_filter == null) {
        return { organization_id };
      }

      // Breakdown opcional por tienda — validamos pertenencia.
      await this.assertStoreBelongsToOrg(organization_id, store_id_filter);
      return { organization_id, store_id: store_id_filter };
    }

    // STORE scope: store_id es obligatorio.
    if (store_id_filter == null) {
      throw new BadRequestException(
        'store_id is required when operating_scope is STORE',
      );
    }

    await this.assertStoreBelongsToOrg(organization_id, store_id_filter);
    return { organization_id, store_id: store_id_filter };
  }

  /**
   * Devuelve los store_ids activos de la organización. Útil para queries con
   * `IN (...)` cuando se hace consolidación que requiere expansión explícita
   * (ej. agregar stock_levels que están scoped por store).
   */
  async getStoreIdsForOrg(organization_id: number): Promise<number[]> {
    if (!organization_id || !Number.isFinite(organization_id)) {
      throw new BadRequestException('organization_id is required');
    }

    const stores = await this.baseClient.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    return stores.map((s: { id: number }) => s.id);
  }

  /**
   * Validación interna: el store debe existir, estar activo y pertenecer a la org.
   * Lanza BadRequestException si no.
   */
  private async assertStoreBelongsToOrg(
    organization_id: number,
    store_id: number,
  ): Promise<void> {
    const store = await this.baseClient.stores.findFirst({
      where: { id: store_id, organization_id, is_active: true },
      select: { id: true },
    });

    if (!store) {
      throw new BadRequestException(
        'Store does not belong to the current organization',
      );
    }
  }
}
