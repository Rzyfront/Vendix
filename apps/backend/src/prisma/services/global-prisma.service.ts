import { Injectable } from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';

@Injectable()
export class GlobalPrismaService extends BasePrismaService {
  // Global service provides access to ALL models without any scoping
  // This is used for superadmin operations that need cross-tenant access

  // Organization-scoped models (accessible without scoping in global service)
  get users() {
    return this.baseClient.users;
  }

  get stores() {
    return this.baseClient.stores;
  }

  get suppliers() {
    return this.baseClient.suppliers;
  }

  get domain_settings() {
    return this.baseClient.domain_settings;
  }

  get addresses() {
    return this.baseClient.addresses;
  }

  get audit_logs() {
    return this.baseClient.audit_logs;
  }

  // Store-scoped models (accessible without scoping in global service)
  get store_users() {
    return this.baseClient.store_users;
  }

  get store_settings() {
    return this.baseClient.store_settings;
  }

  get inventory_locations() {
    return this.baseClient.inventory_locations;
  }

  get inventory_batches() {
    return this.baseClient.inventory_batches;
  }

  get inventory_serial_numbers() {
    return this.baseClient.inventory_serial_numbers;
  }

  get stock_reservations() {
    return this.baseClient.stock_reservations;
  }

  get purchase_orders() {
    return this.baseClient.purchase_orders;
  }

  get purchase_order_items() {
    return this.baseClient.purchase_order_items;
  }

  get sales_orders() {
    return this.baseClient.sales_orders;
  }

  get sales_order_items() {
    return this.baseClient.sales_order_items;
  }

  get stock_transfers() {
    return this.baseClient.stock_transfers;
  }

  get stock_transfer_items() {
    return this.baseClient.stock_transfer_items;
  }

  get return_orders() {
    return this.baseClient.return_orders;
  }

  get return_order_items() {
    return this.baseClient.return_order_items;
  }

  get categories() {
    return this.baseClient.categories;
  }

  get products() {
    return this.baseClient.products;
  }

  get tax_rates() {
    return this.baseClient.tax_rates;
  }

  get orders() {
    return this.baseClient.orders;
  }

  get payments() {
    return this.baseClient.payments;
  }

  get store_payment_methods() {
    return this.baseClient.store_payment_methods;
  }

  get product_categories() {
    return this.baseClient.product_categories;
  }

  get product_images() {
    return this.baseClient.product_images;
  }

  get product_tax_assignments() {
    return this.baseClient.product_tax_assignments;
  }

  get product_variants() {
    return this.baseClient.product_variants;
  }

  get refund_items() {
    return this.baseClient.refund_items;
  }

  get refunds() {
    return this.baseClient.refunds;
  }

  get reviews() {
    return this.baseClient.reviews;
  }

  get user_settings() {
    return this.baseClient.user_settings;
  }

  get user_sessions() {
    return this.baseClient.user_sessions;
  }

  get tax_categories() {
    return this.baseClient.tax_categories;
  }

  get email_verification_tokens() {
    return this.baseClient.email_verification_tokens;
  }

  get refresh_tokens() {
    return this.baseClient.refresh_tokens;
  }

  get roles() {
    return this.baseClient.roles;
  }

  get user_roles() {
    return this.baseClient.user_roles;
  }

  get password_reset_tokens() {
    return this.baseClient.password_reset_tokens;
  }

  get permissions() {
    return this.baseClient.permissions;
  }

  get role_permissions() {
    return this.baseClient.role_permissions;
  }

  get stock_levels() {
    return this.baseClient.stock_levels;
  }

  get inventory_adjustments() {
    return this.baseClient.inventory_adjustments;
  }

  get supplier_products() {
    return this.baseClient.supplier_products;
  }

  get inventory_movements() {
    return this.baseClient.inventory_movements;
  }

  get inventory_transactions() {
    return this.baseClient.inventory_transactions;
  }

  get login_attempts() {
    return this.baseClient.login_attempts;
  }

  get order_items() {
    return this.baseClient.order_items;
  }

  get order_item_taxes() {
    return this.baseClient.order_item_taxes;
  }

  get organization_settings() {
    return this.baseClient.organization_settings;
  }

  // Global models (no scoping ever applied)
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

  // Ecommerce models
  get carts() {
    return this.baseClient.carts;
  }

  get cart_items() {
    return this.baseClient.cart_items;
  }

  get wishlists() {
    return this.baseClient.wishlists;
  }

  get wishlist_items() {
    return this.baseClient.wishlist_items;
  }

  // Default templates
  get default_templates() {
    return this.baseClient.default_templates;
  }
}
