import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

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
    'support_attachments',
    'support_comments',
    'support_status_history',
    'support_notifications',
  ];

  constructor() {
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

  get order_items() {
    return this.baseClient.order_items;
  }

  get store_payment_methods() {
    return this.baseClient.store_payment_methods;
  }

  // Support models
  get support_tickets() {
    return this.baseClient.support_tickets;
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
}
