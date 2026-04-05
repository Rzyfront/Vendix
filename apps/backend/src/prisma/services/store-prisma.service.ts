import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class StorePrismaService extends BasePrismaService {
  private readonly store_scoped_models = [
    'store_users',
    'store_settings',
    'inventory_locations',
    'categories',
    'tax_categories',
    'products',
    'tax_rates',
    'orders',
    'store_payment_methods',
    'addresses',
    'domain_settings',
    'shipping_zones',
    'shipping_methods',
    'expenses',
    'notifications',
    'notification_subscriptions',
    'push_subscriptions',
    'invoices',
    'invoice_resolutions',
    'dian_configurations',
    'promotions',
    'coupons',
    'quotations',
    'cash_registers',
    'cash_register_sessions',
    'cash_register_movements',
    'layaway_plans',
    'exogenous_reports',
    'bookings',
    'service_providers',
    'reviews',
    'ai_conversations',
    'ai_embeddings',
    'dispatch_notes',
    'employee_stores',
    'accounts_receivable',
    'payment_agreements',
    'wallets',
    'commission_rules',
    'commission_calculations',
    'payment_links',
  ];

  constructor() {
    super();
    this.setupStoreScoping();
  }

  get organizationWhere() {
    const context = RequestContextService.getContext();
    return {
      organization_id: context?.organization_id,
    };
  }

  get storeWhere() {
    const context = RequestContextService.getContext();
    return {
      organization_id: context?.organization_id,
      store_id: context?.store_id,
    };
  }

  private setupStoreScoping() {
    const extensions = this.createStoreQueryExtensions();
    this.scoped_client = this.baseClient.$extends({ query: extensions });
  }

  private createStoreQueryExtensions() {
    const extensions: any = {};
    const operations = [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'create',
      'createMany',
    ];

    const all_scoped_models = [
      ...this.store_scoped_models,
      'stock_levels', // Relational
      'inventory_batches', // Relational
      'inventory_serial_numbers', // Relational
      'order_items', // Relational
      'product_variants', // Relational
      'suppliers', // Org scoped
      'payments', // Relational
      'product_images', // Relational
      'stock_transfers', // Org scoped
      'sales_orders', // Org scoped
      'return_orders', // Org scoped
      'sales_order_items', // Relational
      'refunds', // Relational
      'order_installments', // Relational
      'inventory_adjustments', // Relational
      'inventory_movements', // Relational
      'stock_reservations', // Relational
      'inventory_transactions', // Relational
      'purchase_orders', // Relational
      'shipping_rates', // Relational
      'expense_categories', // Org scoped
      'product_tax_assignments', // Relational
      'invoice_items', // Relational
      'invoice_taxes', // Relational
      'dian_audit_logs', // Relational
      'accounting_entry_lines', // Relational
      'payroll_items', // Relational
      'promotion_products', // Relational
      'promotion_categories', // Relational
      'order_promotions', // Relational
      'coupon_products', // Relational
      'coupon_categories', // Relational
      'coupon_uses', // Relational
      'quotation_items', // Relational
      'chart_of_accounts', // Org scoped
      'fiscal_periods', // Org scoped
      'accounting_entries', // Org scoped
      'employees', // Org scoped (multi-store via employee_stores junction)
      'employee_stores', // Store scoped (junction table)
      'payroll_runs', // Org scoped
      'layaway_items', // Relational
      'layaway_installments', // Relational
      'layaway_payments', // Relational
      'bank_accounts', // Org scoped
      'fixed_asset_categories', // Org scoped
      'fixed_assets', // Org scoped
      'budgets', // Org scoped
      'consolidation_sessions', // Org scoped
      'intercompany_transactions', // Org scoped
      'bank_transactions', // Relational
      'bank_reconciliations', // Relational
      'bank_reconciliation_matches', // Relational
      'depreciation_entries', // Relational
      'budget_lines', // Relational
      'consolidation_adjustments', // Relational
      'withholding_calculations', // Org scoped (organization_id + optional store_id)
      'withholding_concepts', // Org scoped
      'uvt_values', // Org scoped
      'review_responses', // Relational
      'review_votes', // Relational
      'review_reports', // Relational
      'ai_messages', // Relational
      'dispatch_note_items', // Relational
      'ar_payments', // Relational
      'agreement_installments', // Relational
      'wallet_transactions', // Relational
      'accounts_payable', // Org scoped
      'ap_payments', // Relational
      'ap_payment_schedules', // Relational
    ];

    for (const model of all_scoped_models) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applyStoreScoping(model, operation, args, query);
        };
      }
    }

    return extensions;
  }

  private applyStoreScoping(
    model: string,
    operation: string,
    args: any,
    query: any,
  ) {
    const context = RequestContextService.getContext();

    if (!context) {
      throw new UnauthorizedException(
        'Unauthorized access - no request context',
      );
    }

    const scoped_args = { ...args };

    // Handle Create Operations
    if (operation === 'create' || operation === 'createMany') {
      if (this.store_scoped_models.includes(model)) {
        if (!context.store_id) {
          throw new ForbiddenException(
            'Access denied - store context required for creation',
          );
        }

        if (operation === 'create') {
          scoped_args.data = {
            ...scoped_args.data,
            store_id: context.store_id,
          };
        } else if (operation === 'createMany') {
          if (Array.isArray(scoped_args.data)) {
            scoped_args.data = scoped_args.data.map((item: any) => ({
              ...item,
              store_id: context.store_id,
            }));
          } else {
            scoped_args.data = {
              ...scoped_args.data,
              store_id: context.store_id,
            };
          }
        }
      }
      return query(scoped_args);
    }

    // Handle Read/Update/Delete Operations (Where clause)
    const relational_scopes: Record<string, any> = {
      stock_levels: { inventory_locations: { store_id: context.store_id } },
      inventory_batches: {
        inventory_locations: { store_id: context.store_id },
      },
      inventory_serial_numbers: {
        inventory_locations: { store_id: context.store_id },
      },
      order_items: { orders: { store_id: context.store_id } },
      product_variants: { products: { store_id: context.store_id } },
      payments: { orders: { store_id: context.store_id } },
      product_images: { products: { store_id: context.store_id } },
      sales_order_items: {
        sales_orders: { organization_id: context.organization_id },
      }, // Changed to Org Scope
      refunds: { orders: { store_id: context.store_id } },
      order_installments: { orders: { store_id: context.store_id } },
      inventory_adjustments: {
        inventory_locations: { store_id: context.store_id },
      },
      stock_reservations: {
        inventory_locations: { store_id: context.store_id },
      },
      purchase_orders: { location: { store_id: context.store_id } },
      inventory_movements: {
        OR: [
          { products: { store_id: context.store_id } },
          { from_location: { store_id: context.store_id } },
          { to_location: { store_id: context.store_id } },
        ],
      },
      inventory_transactions: { products: { store_id: context.store_id } },
      shipping_rates: { shipping_zone: { store_id: context.store_id } },
      product_tax_assignments: { products: { store_id: context.store_id } },
      invoice_items: { invoice: { store_id: context.store_id } },
      invoice_taxes: { invoice: { store_id: context.store_id } },
      dian_audit_logs: { dian_configuration: { store_id: context.store_id } },
      accounting_entry_lines: {
        entry: { organization_id: context.organization_id },
      },
      payroll_items: {
        payroll_run: { organization_id: context.organization_id },
      },
      employee_advance_payments: {
        advance: { organization_id: context.organization_id },
      },
      promotion_products: { promotions: { store_id: context.store_id } },
      promotion_categories: { promotions: { store_id: context.store_id } },
      order_promotions: { orders: { store_id: context.store_id } },
      coupon_products: { coupon: { store_id: context.store_id } },
      coupon_categories: { coupon: { store_id: context.store_id } },
      coupon_uses: { coupon: { store_id: context.store_id } },
      quotation_items: { quotation: { store_id: context.store_id } },
      layaway_items: { layaway_plan: { store_id: context.store_id } },
      layaway_installments: { layaway_plan: { store_id: context.store_id } },
      layaway_payments: { layaway_plan: { store_id: context.store_id } },
      bank_transactions: { bank_account: { organization_id: context.organization_id } },
      bank_reconciliations: { bank_account: { organization_id: context.organization_id } },
      bank_reconciliation_matches: { reconciliation: { bank_account: { organization_id: context.organization_id } } },
      depreciation_entries: { fixed_asset: { organization_id: context.organization_id } },
      budget_lines: { budget: { organization_id: context.organization_id } },
      consolidation_adjustments: { session: { organization_id: context.organization_id } },
      review_responses: { reviews: { store_id: context.store_id } },
      review_votes: { reviews: { store_id: context.store_id } },
      review_reports: { reviews: { store_id: context.store_id } },
      ai_messages: { conversation: { store_id: context.store_id, organization_id: context.organization_id } },
      dispatch_note_items: { dispatch_note: { store_id: context.store_id } },
      ar_payments: { accounts_receivable: { store_id: context.store_id } },
      agreement_installments: { payment_agreement: { store_id: context.store_id } },
      wallet_transactions: { wallet: { store_id: context.store_id } },
      ap_payments: { accounts_payable: { organization_id: context.organization_id } },
      ap_payment_schedules: { accounts_payable: { organization_id: context.organization_id } },
    };

    const security_filter: Record<string, any> = {};

    // Models requiring Organization scope (no store_id, but owned by Org)
    const org_scoped_models = [
      'suppliers',
      'stock_transfers',
      'sales_orders',
      'return_orders',
      'expense_categories',
      'chart_of_accounts',
      'fiscal_periods',
      'accounting_entries',
      'employees',
      'payroll_runs',
      'payroll_settlements',
      'employee_advances',
      'bank_accounts',
      'fixed_asset_categories',
      'fixed_assets',
      'budgets',
      'consolidation_sessions',
      'intercompany_transactions',
      'withholding_concepts',
      'withholding_calculations',
      'uvt_values',
      'accounts_payable',
    ];

    if (this.store_scoped_models.includes(model)) {
      if (!context.store_id) {
        throw new ForbiddenException('Access denied - store context required');
      }
      security_filter.store_id = context.store_id;
    } else if (relational_scopes[model]) {
      if (!context.store_id && !relational_scopes[model].sales_orders) {
        // Logic for relational scopes
      }
      Object.assign(security_filter, relational_scopes[model]);
    } else if (org_scoped_models.includes(model)) {
      if (!context.organization_id) {
        throw new ForbiddenException(
          'Access denied - organization context required',
        );
      }
      security_filter.organization_id = context.organization_id;
    }

    if (Object.keys(security_filter).length > 0) {
      scoped_args.where = {
        ...scoped_args.where,
        ...security_filter,
      };
    }

    return query(scoped_args);
  }

  private scoped_client: any;

  // Store-scoped models with automatic filtering
  get store_users() {
    return this.scoped_client.store_users;
  }

  get store_settings() {
    return this.scoped_client.store_settings;
  }

  get inventory_locations() {
    return this.scoped_client.inventory_locations;
  }

  get categories() {
    return this.scoped_client.categories;
  }

  get tax_categories() {
    return this.scoped_client.tax_categories;
  }

  get products() {
    return this.scoped_client.products;
  }

  get tax_rates() {
    return this.scoped_client.tax_rates;
  }

  get orders() {
    return this.scoped_client.orders;
  }

  get store_payment_methods() {
    return this.scoped_client.store_payment_methods;
  }

  get order_items() {
    return this.scoped_client.order_items;
  }

  get product_variants() {
    return this.scoped_client.product_variants;
  }

  get stock_levels() {
    return this.scoped_client.stock_levels;
  }

  get inventory_batches() {
    return this.scoped_client.inventory_batches;
  }

  get inventory_serial_numbers() {
    return this.scoped_client.inventory_serial_numbers;
  }

  get payments() {
    return this.scoped_client.payments;
  }

  get product_images() {
    return this.scoped_client.product_images;
  }

  get sales_order_items() {
    return this.scoped_client.sales_order_items;
  }

  get refunds() {
    return this.scoped_client.refunds;
  }

  get stock_transfers() {
    return this.scoped_client.stock_transfers;
  }

  get sales_orders() {
    return this.scoped_client.sales_orders;
  }

  get return_orders() {
    return this.scoped_client.return_orders;
  }

  get product_tax_assignments() {
    return this.scoped_client.product_tax_assignments;
  }

  get inventory_adjustments() {
    return this.scoped_client.inventory_adjustments;
  }

  get inventory_movements() {
    return this.scoped_client.inventory_movements;
  }

  get stock_reservations() {
    return this.scoped_client.stock_reservations;
  }

  get inventory_transactions() {
    return this.scoped_client.inventory_transactions;
  }

  get purchase_orders() {
    return this.scoped_client.purchase_orders;
  }

  // Purchase order sub-resources (accessed via PO's FK, no direct org scope needed)
  get purchase_order_receptions() {
    return this.baseClient.purchase_order_receptions;
  }

  get purchase_order_reception_items() {
    return this.baseClient.purchase_order_reception_items;
  }

  get purchase_order_attachments() {
    return this.baseClient.purchase_order_attachments;
  }

  get purchase_order_payments() {
    return this.baseClient.purchase_order_payments;
  }

  get inventory_cost_layers() {
    return this.baseClient.inventory_cost_layers;
  }

  // Global models (no scoping applied)
  get organizations() {
    return this.baseClient.organizations;
  }

  get brands() {
    return this.baseClient.brands;
  }

  get product_categories() {
    return this.baseClient.product_categories;
  }

  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  }

  get organization_payment_policies() {
    return this.baseClient.organization_payment_policies;
  }

  // Organization-scoped models (accessible but not scoped in store service)
  get users() {
    return this.baseClient.users;
  }

  get stores() {
    return this.baseClient.stores;
  }

  get suppliers() {
    return this.scoped_client.suppliers;
  }

  get supplier_products() {
    return this.scoped_client.supplier_products;
  }

  // Addresses is now scoped
  get addresses() {
    return this.scoped_client.addresses;
  }

  get audit_logs() {
    return this.baseClient.audit_logs;
  }

  // Auth and permission models
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

  get expense_categories() {
    return this.scoped_client.expense_categories;
  }

  get domain_settings() {
    return this.scoped_client.domain_settings;
  }

  get shipping_zones() {
    return this.scoped_client.shipping_zones;
  }

  get shipping_methods() {
    return this.scoped_client.shipping_methods;
  }

  get shipping_rates() {
    return this.scoped_client.shipping_rates;
  }

  get expenses() {
    return this.scoped_client.expenses;
  }

  get notifications() {
    return this.scoped_client.notifications;
  }

  get notification_subscriptions() {
    return this.scoped_client.notification_subscriptions;
  }

  get push_subscriptions() {
    return this.scoped_client.push_subscriptions;
  }

  // Invoicing models
  get invoices() {
    return this.scoped_client.invoices;
  }

  get invoice_items() {
    return this.scoped_client.invoice_items;
  }

  get invoice_taxes() {
    return this.scoped_client.invoice_taxes;
  }

  get invoice_resolutions() {
    return this.scoped_client.invoice_resolutions;
  }

  get dian_configurations() {
    return this.scoped_client.dian_configurations;
  }

  get dian_audit_logs() {
    return this.scoped_client.dian_audit_logs;
  }

  // Promotions models
  get promotions() {
    return this.scoped_client.promotions;
  }

  get promotion_products() {
    return this.scoped_client.promotion_products;
  }

  get promotion_categories() {
    return this.scoped_client.promotion_categories;
  }

  get order_promotions() {
    return this.scoped_client.order_promotions;
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

  get accounting_account_mappings() {
    return this.baseClient.accounting_account_mappings;
  }

  // Bank Reconciliation models
  get bank_accounts() {
    return this.scoped_client.bank_accounts;
  }

  get bank_transactions() {
    return this.scoped_client.bank_transactions;
  }

  get bank_reconciliations() {
    return this.scoped_client.bank_reconciliations;
  }

  get bank_reconciliation_matches() {
    return this.scoped_client.bank_reconciliation_matches;
  }

  // Fixed Assets models
  get fixed_asset_categories() {
    return this.scoped_client.fixed_asset_categories;
  }

  get fixed_assets() {
    return this.scoped_client.fixed_assets;
  }

  get depreciation_entries() {
    return this.scoped_client.depreciation_entries;
  }

  // Budget models
  get budgets() {
    return this.scoped_client.budgets;
  }

  get budget_lines() {
    return this.scoped_client.budget_lines;
  }

  // Consolidation models
  get consolidation_sessions() {
    return this.scoped_client.consolidation_sessions;
  }

  get intercompany_transactions() {
    return this.scoped_client.intercompany_transactions;
  }

  get consolidation_adjustments() {
    return this.scoped_client.consolidation_adjustments;
  }

  // Payroll models
  get employees() {
    return this.scoped_client.employees;
  }

  get employee_stores() {
    return this.scoped_client.employee_stores;
  }

  get payroll_runs() {
    return this.scoped_client.payroll_runs;
  }

  get payroll_items() {
    return this.scoped_client.payroll_items;
  }

  get payroll_settlements() {
    return this.scoped_client.payroll_settlements;
  }

  get employee_advances() {
    return this.scoped_client.employee_advances;
  }

  get employee_advance_payments() {
    return this.scoped_client.employee_advance_payments;
  }

  // Quotations models
  get quotations() {
    return this.scoped_client.quotations;
  }

  // Coupons models
  get coupons() {
    return this.scoped_client.coupons;
  }

  get coupon_products() {
    return this.scoped_client.coupon_products;
  }

  get coupon_categories() {
    return this.scoped_client.coupon_categories;
  }

  get coupon_uses() {
    return this.scoped_client.coupon_uses;
  }

  // Cash Register models
  get cash_registers() {
    return this.scoped_client.cash_registers;
  }

  get cash_register_sessions() {
    return this.scoped_client.cash_register_sessions;
  }

  get cash_register_movements() {
    return this.scoped_client.cash_register_movements;
  }

  // Layaway models
  get layaway_plans() {
    return this.scoped_client.layaway_plans;
  }

  get layaway_items() {
    return this.scoped_client.layaway_items;
  }

  get layaway_installments() {
    return this.scoped_client.layaway_installments;
  }

  get layaway_payments() {
    return this.scoped_client.layaway_payments;
  }

  // Withholding Tax models (org scoped)
  get withholding_concepts() {
    return this.scoped_client.withholding_concepts;
  }

  get withholding_calculations() {
    return this.scoped_client.withholding_calculations;
  }

  get uvt_values() {
    return this.scoped_client.uvt_values;
  }

  // Bookings models
  get bookings() {
    return this.scoped_client.bookings;
  }

  get service_providers() {
    return this.scoped_client.service_providers;
  }

  get provider_services() {
    return this.scoped_client.provider_services;
  }

  get provider_schedules() {
    return this.scoped_client.provider_schedules;
  }

  get provider_exceptions() {
    return this.scoped_client.provider_exceptions;
  }

  // Reviews models
  get reviews() {
    return this.scoped_client.reviews;
  }

  get review_responses() {
    return this.scoped_client.review_responses;
  }

  get review_votes() {
    return this.scoped_client.review_votes;
  }

  get review_reports() {
    return this.scoped_client.review_reports;
  }

  // AI Chat models
  get ai_conversations() {
    return this.scoped_client.ai_conversations;
  }

  get ai_messages() {
    return this.scoped_client.ai_messages;
  }

  get ai_embeddings() {
    return this.scoped_client.ai_embeddings;
  }

  // Order Installments
  get order_installments() {
    return this.scoped_client.order_installments;
  }

  // Dispatch Notes models
  get dispatch_notes() {
    return this.scoped_client.dispatch_notes;
  }

  get dispatch_note_items() {
    return this.scoped_client.dispatch_note_items;
  }

  // Accounts Receivable models
  get accounts_receivable() {
    return this.scoped_client.accounts_receivable;
  }

  get ar_payments() {
    return this.scoped_client.ar_payments;
  }

  get payment_agreements() {
    return this.scoped_client.payment_agreements;
  }

  get agreement_installments() {
    return this.scoped_client.agreement_installments;
  }

  // Wallet models
  get wallets() {
    return this.scoped_client.wallets;
  }

  get wallet_transactions() {
    return this.scoped_client.wallet_transactions;
  }

  // Accounts Payable models
  get accounts_payable() {
    return this.scoped_client.accounts_payable;
  }

  get ap_payments() {
    return this.scoped_client.ap_payments;
  }

  get ap_payment_schedules() {
    return this.scoped_client.ap_payment_schedules;
  }

  // Payment Links
  get payment_links() {
    return this.scoped_client.payment_links;
  }

  // Commission models
  get commission_rules() {
    return this.scoped_client.commission_rules;
  }

  get commission_calculations() {
    return this.scoped_client.commission_calculations;
  }

  // Global tables (no store scoping)
  get default_templates() {
    return this.baseClient.default_templates;
  }

  override $transaction(arg: any, options?: any) {
    return this.scoped_client.$transaction(arg, options);
  }
}
