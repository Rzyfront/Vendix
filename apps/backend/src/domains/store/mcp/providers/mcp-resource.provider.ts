import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

@Injectable()
export class McpResourceProvider {
  private readonly logger = new Logger(McpResourceProvider.name);

  constructor(private readonly prisma: StorePrismaService) {}

  listResources(): McpResource[] {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id || 'unknown';

    return [
      {
        uri: `vendix://products/${storeId}`,
        name: 'Product Catalog',
        description: 'Active product catalog with prices and stock levels',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://inventory/${storeId}`,
        name: 'Inventory Status',
        description: 'Current stock levels across all locations',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://reports/sales/${storeId}`,
        name: 'Sales Summary',
        description: 'Recent sales summary and order statistics',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://catalog/categories/${storeId}`,
        name: 'Catalog Categories',
        description:
          'Product category tree with active product counts for browsing',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://catalog/category/${storeId}/{categoryId}`,
        name: 'Category Products',
        description:
          'Products in a specific category with pricing, variants, and images',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://catalog/product/${storeId}/{productId}`,
        name: 'Product Detail',
        description:
          'Full product details including variants, images, categories, and brand',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://catalog/featured/${storeId}`,
        name: 'Featured Products',
        description: 'Products currently on sale or featured for ecommerce',
        mimeType: 'application/json',
      },
    ];
  }

  async readResource(uri: string): Promise<McpResourceContent> {
    const context = RequestContextService.getContext();

    if (uri.startsWith('vendix://products/')) {
      const products = await this.prisma.products.findMany({
        where: { state: 'active' },
        select: {
          id: true,
          name: true,
          base_price: true,
          sku: true,
        },
        take: 100,
      });

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: products.length,
          products,
        }),
      };
    }

    if (uri.startsWith('vendix://inventory/')) {
      const products = await this.prisma.products.findMany({
        where: { state: 'active' },
        select: {
          id: true,
          name: true,
          sku: true,
          stock_quantity: true,
        },
        take: 100,
      });

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: products.length,
          inventory: products,
        }),
      };
    }

    if (uri.startsWith('vendix://reports/sales/')) {
      const orders = await this.prisma.orders.findMany({
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          order_number: true,
          grand_total: true,
          state: true,
          created_at: true,
        },
      });

      const totalRevenue = orders.reduce(
        (sum, o) => sum + Number(o.grand_total || 0),
        0,
      );

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          period: 'recent',
          total_orders: orders.length,
          total_revenue: totalRevenue,
          orders,
        }),
      };
    }

    // ── Catalog: Categories (plural before singular to avoid startsWith collision) ──
    if (uri.startsWith('vendix://catalog/categories/')) {
      const categories = await this.prisma.categories.findMany({
        where: { state: 'active' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          image_url: true,
          product_categories: {
            where: {
              products: { state: 'active' },
            },
            select: { product_id: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      const result = categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image_url: cat.image_url,
        product_count: cat.product_categories.length,
      }));

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: result.length,
          categories: result,
        }),
      };
    }

    // ── Catalog: Products by Category ──
    if (uri.startsWith('vendix://catalog/category/')) {
      const parts = uri.replace('vendix://catalog/category/', '').split('/');
      const categoryId = parseInt(parts[1], 10);

      if (isNaN(categoryId)) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: 'Invalid category ID', uri }),
        };
      }

      const category = await this.prisma.categories.findFirst({
        where: { id: categoryId, state: 'active' },
        select: { id: true, name: true, slug: true, description: true },
      });

      if (!category) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'Category not found or inactive',
            category_id: categoryId,
          }),
        };
      }

      const products = await this.prisma.products.findMany({
        where: {
          state: 'active',
          product_categories: { some: { category_id: categoryId } },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          base_price: true,
          sale_price: true,
          is_on_sale: true,
          product_type: true,
          stock_quantity: true,
          available_for_ecommerce: true,
          brands: { select: { id: true, name: true } },
          product_images: {
            where: { is_main: true },
            select: { image_url: true, alt_text: true },
            take: 1,
          },
          _count: { select: { product_variants: true } },
        },
        orderBy: { name: 'asc' },
        take: 100,
      });

      const result = products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        base_price: p.base_price,
        sale_price: p.sale_price,
        is_on_sale: p.is_on_sale,
        product_type: p.product_type,
        stock_quantity: p.stock_quantity,
        available_for_ecommerce: p.available_for_ecommerce,
        brand: p.brands ? { id: p.brands.id, name: p.brands.name } : null,
        main_image: p.product_images[0] || null,
        variant_count: p._count.product_variants,
      }));

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          category,
          count: result.length,
          products: result,
        }),
      };
    }

    // ── Catalog: Product Detail ──
    if (uri.startsWith('vendix://catalog/product/')) {
      const parts = uri.replace('vendix://catalog/product/', '').split('/');
      const productId = parseInt(parts[1], 10);

      if (isNaN(productId)) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: 'Invalid product ID', uri }),
        };
      }

      const product = await this.prisma.products.findFirst({
        where: { id: productId, state: 'active' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          sku: true,
          base_price: true,
          cost_price: true,
          sale_price: true,
          is_on_sale: true,
          profit_margin: true,
          pricing_type: true,
          product_type: true,
          stock_quantity: true,
          weight: true,
          dimensions: true,
          available_for_ecommerce: true,
          state: true,
          service_duration_minutes: true,
          service_modality: true,
          track_inventory: true,
          brands: {
            select: { id: true, name: true, logo_url: true },
          },
          product_categories: {
            select: {
              categories: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
          product_images: {
            select: {
              id: true,
              image_url: true,
              is_main: true,
              alt_text: true,
              sort_order: true,
            },
            orderBy: { sort_order: 'asc' as const },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
              name: true,
              price_override: true,
              sale_price: true,
              is_on_sale: true,
              stock_quantity: true,
              attributes: true,
            },
            orderBy: { id: 'asc' as const },
          },
        },
      });

      if (!product) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'Product not found or inactive',
            product_id: productId,
          }),
        };
      }

      const {
        brands,
        product_categories,
        product_images,
        product_variants,
        ...rest
      } = product;

      const result = {
        ...rest,
        brand: brands,
        categories: product_categories.map((pc) => pc.categories),
        images: product_images,
        variants: product_variants,
      };

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          product: result,
        }),
      };
    }

    // ── Catalog: Featured Products ──
    if (uri.startsWith('vendix://catalog/featured/')) {
      const products = await this.prisma.products.findMany({
        where: {
          state: 'active',
          OR: [{ is_on_sale: true }, { available_for_ecommerce: true }],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          base_price: true,
          sale_price: true,
          is_on_sale: true,
          product_type: true,
          stock_quantity: true,
          available_for_ecommerce: true,
          brands: { select: { id: true, name: true } },
          product_images: {
            where: { is_main: true },
            select: { image_url: true, alt_text: true },
            take: 1,
          },
          _count: { select: { product_variants: true } },
        },
        orderBy: { name: 'asc' },
        take: 100,
      });

      const result = products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        base_price: p.base_price,
        sale_price: p.sale_price,
        is_on_sale: p.is_on_sale,
        product_type: p.product_type,
        stock_quantity: p.stock_quantity,
        available_for_ecommerce: p.available_for_ecommerce,
        brand: p.brands ? { id: p.brands.id, name: p.brands.name } : null,
        main_image: p.product_images[0] || null,
        variant_count: p._count.product_variants,
      }));

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: result.length,
          products: result,
        }),
      };
    }

    return {
      uri,
      mimeType: 'text/plain',
      text: `Resource not found: ${uri}`,
    };
  }
}
