import { Injectable, ForbiddenException } from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class EcommercePrismaService extends BasePrismaService {
  // Modelos que filtran SOLO por store_id
  private readonly store_only_models = [
    'products',
    'categories',
    'brands',
    'product_images',
    'product_variants',
    'stock_levels',
    'store_payment_methods',
  ];

  // Modelos que filtran por store_id Y user_id (si hay auth)
  private readonly store_user_models = [
    'carts',
    'cart_items',
    'wishlists',
    'wishlist_items',
    'orders',
    'order_items',
    'reviews',
    'payments',
    'addresses',
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

    // Configurar extensions para todos los modelos
    const all_models = [
      ...this.store_only_models,
      ...this.store_user_models,
    ];

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
    const domain_context = RequestContextService.getDomainContext();

    // Obtener store_id: siempre debe existir (del dominio)
    const store_id = context?.store_id || domain_context?.store_id;

    if (!store_id) {
      throw new ForbiddenException(
        'Access denied - store context required (domain not resolved)',
      );
    }

    const scoped_args = { ...args };
    const user_id = context?.user_id;

    // Handle Create Operations
    if (operation === 'create' || operation === 'createMany') {
      if (operation === 'create') {
        scoped_args.data = {
          ...scoped_args.data,
          store_id,
          // Si es modelo store+user y hay auth, agregar user_id
          ...(this.store_user_models.includes(model) && user_id
            ? { user_id }
            : {}),
        };
      } else if (operation === 'createMany') {
        if (Array.isArray(scoped_args.data)) {
          scoped_args.data = scoped_args.data.map((item: any) => ({
            ...item,
            store_id,
            ...(this.store_user_models.includes(model) && user_id
              ? { user_id }
              : {}),
          }));
        } else {
          scoped_args.data = {
            ...scoped_args.data,
            store_id,
            ...(this.store_user_models.includes(model) && user_id
              ? { user_id }
              : {}),
          };
        }
      }
      return query(scoped_args);
    }

    // Handle Read/Update/Delete Operations
    const security_filter: Record<string, any> = { store_id };

    // Para modelos store+user, agregar user_id si hay auth
    if (this.store_user_models.includes(model)) {
      if (user_id) {
        security_filter.user_id = user_id;
      }
      // Si no hay user_id y es un modelo que lo requiere, permitir solo lectura
      // (para endpoints públicos que pueden necesitar acceder sin user_id)
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

  get brands() {
    return this.scoped_client.brands;
  }

  get product_images() {
    return this.scoped_client.product_images;
  }

  get product_variants() {
    return this.scoped_client.product_variants;
  }

  get carts() {
    return this.scoped_client.carts;
  }

  get cart_items() {
    return this.scoped_client.cart_items;
  }

  get wishlists() {
    return this.scoped_client.wishlists;
  }

  get wishlist_items() {
    return this.scoped_client.wishlist_items;
  }

  get orders() {
    return this.scoped_client.orders;
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

  get store_payment_methods() {
    return this.scoped_client.store_payment_methods;
  }

  get payments() {
    return this.scoped_client.payments;
  }

  get addresses() {
    return this.scoped_client.addresses;
  }

  // Modelos globales sin scoping (para referencias y datos del sistema)
  get stores() {
    return this.baseClient.stores;
  }

  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  }

  get users() {
    return this.baseClient.users;
  }

  // Override $transaction para usar scoped_client
  override $transaction(arg: any, options?: any) {
    return this.scoped_client.$transaction(arg, options);
  }
}
