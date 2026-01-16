import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedTestOrdersResult {
  ordersCreated: number;
  reviewsCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations must exist
 * 2. seedUsers() - Users must exist
 * 3. seedProductsAndCategories() - Products must exist
 *
 * Creates test orders and product reviews for testing
 */
export async function seedTestOrders(
  prisma?: PrismaClient,
): Promise<SeedTestOrdersResult> {
  const client = prisma || getPrismaClient();

  // Fetch required organizations and users
  const techSolutionsOrg = await client.organizations.findUnique({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findUnique({
    where: { slug: 'fashion-retail' },
  });

  const customer1 = await client.users.findFirst({
    where: { username: 'miguel.santos' },
  });
  const customer2 = await client.users.findFirst({
    where: { username: 'isabella.vargas' },
  });

  const techAdmin = await client.users.findFirst({
    where: { username: 'ana.martinez' },
  });
  const fashionAdmin = await client.users.findFirst({
    where: { username: 'pedro.lopez' },
  });

  // Fetch products for reviews
  const products = await client.products.findMany({
    where: {
      sku: {
        in: ['IP15P-256-BLK', 'NAM90-42-BLK', 'MBP14-M3-512'],
      },
    },
  });

  const iPhoneProduct = products.find((p) => p.sku === 'IP15P-256-BLK');
  const nikeProduct = products.find((p) => p.sku === 'NAM90-42-BLK');
  const macbookProduct = products.find((p) => p.sku === 'MBP14-M3-512');

  let ordersCreated = 0;
  let reviewsCreated = 0;

  // Create test orders
  const orders = [
    {
      order_number: 'ORD-2024-001',
      customer_id: customer1?.id,
      organization_id: techSolutionsOrg?.id,
      status: 'shipped',
      approved_by_user_id: techAdmin?.id,
      created_by_user_id: techAdmin?.id,
    },
    {
      order_number: 'ORD-2024-002',
      customer_id: customer2?.id,
      organization_id: fashionRetailOrg?.id,
      status: 'confirmed',
      approved_by_user_id: fashionAdmin?.id,
      created_by_user_id: fashionAdmin?.id,
    },
    {
      order_number: 'ORD-2024-003',
      customer_id: customer1?.id,
      organization_id: techSolutionsOrg?.id,
      status: 'draft',
      approved_by_user_id: techAdmin?.id,
      created_by_user_id: techAdmin?.id,
    },
  ];

  const createdOrders: any[] = [];
  for (const order of orders) {
    const existing = await client.sales_orders.findFirst({
      where: { order_number: order.order_number },
    });

    if (existing) {
      continue;
    }

    const createdOrder = await client.sales_orders.create({
      data: {
        order_number: order.order_number,
        customer_id: order.customer_id!,
        organization_id: order.organization_id!,
        status: order.status as any,
        approved_by_user_id: order.approved_by_user_id!,
        created_by_user_id: order.created_by_user_id!,
      },
    });
    createdOrders.push(createdOrder);
    ordersCreated++;
  }

  // Create product reviews
  const reviews = [
    {
      product_id: iPhoneProduct?.id,
      user_id: customer1?.id,
      rating: 5,
      comment:
        'El iPhone 15 Pro es increíble, la cámara es fantástica y la batería dura todo el día. Totalmente recomendado.',
      state: 'approved',
    },
    {
      product_id: nikeProduct?.id,
      user_id: customer2?.id,
      rating: 4,
      comment:
        'Muy cómodas y de buena calidad. El único detalle es que son un poco pequeñas para la talla indicada.',
      state: 'approved',
    },
    {
      product_id: macbookProduct?.id,
      user_id: customer1?.id,
      rating: 5,
      comment:
        'Rendimiento excepcional, pantalla brillante y teclado cómodo. Perfecta para trabajo y creatividad.',
      state: 'approved',
    },
  ];

  for (const review of reviews) {
    if (review.product_id && review.user_id) {
      const existing = await client.reviews.findFirst({
        where: {
          product_id: review.product_id,
          user_id: review.user_id,
        },
      });

      if (existing) {
        continue;
      }

      await client.reviews.create({
        data: {
          product_id: review.product_id,
          user_id: review.user_id,
          rating: review.rating,
          comment: review.comment,
          state: review.state as any,
        },
      });
      reviewsCreated++;
    }
  }

  return {
    ordersCreated,
    reviewsCreated,
  };
}
