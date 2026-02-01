import { Injectable, ForbiddenException } from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class EcommercePrismaService extends BasePrismaService {
  // Modelos que filtran SOLO por store_id
  private readonly store_only_models = [
    'products',
    'categories',
    'store_payment_methods',
    'store_settings',
    'inventory_locations',
    'tax_categories',
    'tax_rates',
    'legal_documents',
  ];

  // Modelos que filtran por store_id Y user_id (si hay auth)
  private readonly store_user_models = [
    'carts',
    'wishlists',
    'orders',
    'addresses',
  ];

  // Modelos que NO tienen store_id pero sí customer_id (heredan scope vía relación)
  private readonly customer_only_models = [
    'payments',
  ];

  constructor() {
    super();
    this.setupEcommerceScoping();
  }

  private setupEcommerceScoping() {
    const extensions = this.createEcommerceQueryExtensions();
    this.scoped_client = this.baseClient.$extends({ query: extensions });
  }

  private createEcommerceQueryExtensions() {
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
      'create',
      'createMany',
    ];

    const all_models = [...this.store_only_models, ...this.store_user_models, ...this.customer_only_models];

    for (const model of all_models) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applyEcommerceScoping(model, operation, args, query);
        };
      }
    }

    return extensions;
  }

  private applyEcommerceScoping(
    model: string,
    operation: string,
    args: any,
    query: any,
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      console.error(
        `[EcommercePrismaService] Forbidden: No store_id in context for model ${model}. Context:`,
        JSON.stringify(context),
      );
      throw new ForbiddenException(
        'Access denied - store context required (domain not resolved)',
      );
    }

    const scoped_args = { ...args };
    const user_id = context?.user_id;

    // Handle Create Operations
    if (operation === 'create' || operation === 'createMany') {
      const applyToData = (data: any) => {
        const item = { ...data };

        // Solo agregar store_id si el modelo lo tiene
        if (!this.customer_only_models.includes(model)) {
          item.store_id = store_id;
        }

        // Agregar user_id/customer_id según corresponda
        if (user_id) {
          if (this.store_user_models.includes(model)) {
            if (model === 'orders') {
              item.customer_id = user_id;
            } else {
              item.user_id = user_id;
            }
          } else if (this.customer_only_models.includes(model)) {
            item.customer_id = user_id;
          }
        }
        return item;
      };

      if (operation === 'create') {
        scoped_args.data = applyToData(scoped_args.data);
      } else if (operation === 'createMany') {
        if (Array.isArray(scoped_args.data)) {
          scoped_args.data = scoped_args.data.map((item: any) => applyToData(item));
        } else {
          scoped_args.data = applyToData(scoped_args.data);
        }
      }
      return query(scoped_args);
    }

    // Handle Read/Update/Delete Operations
    // Solo aplicar store_id si el modelo lo tiene
    const security_filter: Record<string, any> = {};

    if (!this.customer_only_models.includes(model)) {
      security_filter.store_id = store_id;
    }

    if (this.store_user_models.includes(model)) {
      if (user_id) {
        // En orders el campo se llama customer_id
        if (model === 'orders') {
          security_filter.customer_id = user_id;
        } else {
          security_filter.user_id = user_id;
        }
      }
    } else if (this.customer_only_models.includes(model)) {
      // payments hereda scope vía orders, pero podemos filtrar por customer_id
      if (user_id) {
        security_filter.customer_id = user_id;
      }
    }

    scoped_args.where = {
      ...scoped_args.where,
      ...security_filter,
    };

    return query(scoped_args);
  }

  private scoped_client: any;

  // Getters para modelos scoped
  get products() {
    return this.scoped_client.products;
  }
  get categories() {
    return this.scoped_client.categories;
  }
  get store_payment_methods() {
    return this.scoped_client.store_payment_methods;
  }
  get store_settings() {
    return this.scoped_client.store_settings;
  }
  get inventory_locations() {
    return this.scoped_client.inventory_locations;
  }
  get tax_categories() {
    return this.scoped_client.tax_categories;
  }
  get tax_rates() {
    return this.scoped_client.tax_rates;
  }
  get legal_documents() {
    return this.scoped_client.legal_documents;
  }

  get carts() {
    return this.scoped_client.carts;
  }
  get wishlists() {
    return this.scoped_client.wishlists;
  }
  get orders() {
    return this.scoped_client.orders;
  }
  get addresses() {
    return this.scoped_client.addresses;
  }

  // Getters para modelos dependientes (usan scoping a través de sus padres o son semi-globales)
  get product_images() {
    return this.scoped_client.product_images;
  }
  get product_variants() {
    return this.scoped_client.product_variants;
  }
  get cart_items() {
    return this.scoped_client.cart_items;
  }
  get wishlist_items() {
    return this.scoped_client.wishlist_items;
  }
  get order_items() {
    return this.scoped_client.order_items;
  }
  get reviews() {
    return this.scoped_client.reviews;
  }
  get stock_levels() {
    return this.scoped_client.stock_levels;
  }
  get payments() {
    return this.scoped_client.payments;
  }

  // Getters para modelos globales (sin scoping por tienda)
  get brands() {
    return this.baseClient.brands;
  }
  get stores() {
    return this.baseClient.stores;
  }
  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  }
  get users() {
    return this.baseClient.users;
  }

  override $transaction(arg: any, options?: any) {
    return this.scoped_client.$transaction(arg, options);
  }
}
