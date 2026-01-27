import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Seed products, categories, brands, and tax data
 * IMPORTANT: This function depends on organizations and stores being created first.
 * Run seedOrganizationsAndStores() before calling this function.
 */
export async function seedProductsAndCategories(
  prisma?: PrismaClient,
): Promise<{
  taxCategoriesCreated: number;
  taxRatesCreated: number;
  categoriesCreated: number;
  brandsCreated: number;
  productsCreated: number;
  variantsCreated: number;
  imagesCreated: number;
}> {
  const client = prisma || getPrismaClient();

  // Get existing organizations and stores
  const techSolutionsOrg = await client.organizations.findFirst({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findFirst({
    where: { slug: 'fashion-retail' },
  });

  if (!techSolutionsOrg || !fashionRetailOrg) {
    throw new Error(
      'Organizations not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  const techStore1 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg.id,
      slug: 'tech-bogota',
    },
  });

  const fashionStore1 = await client.stores.findFirst({
    where: {
      organization_id: fashionRetailOrg.id,
      slug: 'fashion-norte',
    },
  });

  if (!techStore1 || !fashionStore1) {
    throw new Error(
      'Stores not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  // ============================================
  // 1. CREATE TAX CATEGORIES
  // ============================================

  const taxCategories = [
    {
      name: 'IVA General',
      description: 'Impuesto al valor agregado general 19%',
      rate: 0.19,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'IVA Reducido',
      description: 'Impuesto al valor agregado reducido 5%',
      rate: 0.05,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Exento de IVA',
      description: 'Productos exentos de IVA',
      rate: 0,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'IVA General Fashion',
      description: 'Impuesto al valor agregado general 19%',
      rate: 0.19,
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdTaxCategories: any[] = [];
  for (const taxCategory of taxCategories) {
    const store_id =
      taxCategory.organization_id === techSolutionsOrg.id
        ? techStore1.id
        : fashionStore1.id;

    const createdTaxCategory = await client.tax_categories.upsert({
      where: {
        store_id_name: {
          store_id: store_id,
          name: taxCategory.name,
        },
      } as any,
      update: {},
      create: {
        name: taxCategory.name,
        description: taxCategory.description,
        store_id: store_id,
      },
    });
    createdTaxCategories.push(createdTaxCategory);
  }

  // ============================================
  // 2. CREATE TAX RATES
  // ============================================

  const createdTaxRates: any[] = [];
  for (const taxCategory of taxCategories) {
    const taxCategoryId =
      createdTaxCategories.find((t) => t.name === taxCategory.name)?.id || 0;
    const storeId =
      taxCategory.organization_id === techSolutionsOrg.id
        ? techStore1.id
        : fashionStore1.id;

    // Check if tax rate already exists
    const existing = await client.tax_rates.findFirst({
      where: {
        tax_category_id: taxCategoryId,
        store_id: storeId,
      },
    });

    let createdTaxRate;
    if (existing) {
      createdTaxRate = existing;
    } else {
      createdTaxRate = await client.tax_rates.create({
        data: {
          tax_category_id: taxCategoryId,
          store_id: storeId,
          rate: taxCategory.rate,
          name: taxCategory.name,
        },
      });
    }
    createdTaxRates.push(createdTaxRate);
  }

  // ============================================
  // 3. CREATE PRODUCT CATEGORIES
  // ============================================

  const categories = [
    // Categories for Tech Solutions
    {
      name: 'Laptops',
      slug: 'laptops',
      description:
        'Computadoras portátiles de diferentes marcas y especificaciones',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Smartphones',
      slug: 'smartphones',
      description: 'Teléfonos inteligentes de última generación',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Accesorios',
      slug: 'accesorios',
      description: 'Accesorios para dispositivos electrónicos',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Cargadores y Cables',
      slug: 'cargadores-cables',
      description: 'Cargadores, cables y adaptadores',
      organization_id: techSolutionsOrg.id,
    },
    // Categories for Fashion Retail
    {
      name: 'Ropa Masculina',
      slug: 'ropa-masculina',
      description: 'Vestimenta para hombres',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Ropa Femenina',
      slug: 'ropa-femenina',
      description: 'Vestimenta para mujeres',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Calzado',
      slug: 'calzado',
      description: 'Zapatos y botas para toda la familia',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Accesorios de Moda',
      slug: 'accesorios-moda',
      description: 'Bolsos, cinturones y otros accesorios',
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdCategories: any[] = [];
  for (const category of categories) {
    const storeId =
      category.organization_id === techSolutionsOrg.id
        ? techStore1.id
        : fashionStore1.id;

    const createdCategory = await client.categories.upsert({
      where: {
        store_id_slug: {
          store_id: storeId,
          slug: category.slug,
        },
      },
      update: {},
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        store_id: storeId,
      },
    });
    createdCategories.push(createdCategory);
  }

  // ============================================
  // 4. CREATE BRANDS
  // ============================================

  const brands = [
    // Brands for Tech Solutions
    {
      name: 'Apple',
      slug: 'apple',
      description: 'Productos Apple originales',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Samsung',
      slug: 'samsung',
      description: 'Dispositivos y accesorios Samsung',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Dell',
      slug: 'dell',
      description: 'Computadoras y monitores Dell',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'HP',
      slug: 'hp',
      description: 'Equipos de cómputo HP',
      organization_id: techSolutionsOrg.id,
    },
    // Brands for Fashion Retail
    {
      name: 'Nike',
      slug: 'nike',
      description: 'Ropa y calzado deportivo Nike',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Adidas',
      slug: 'adidas',
      description: 'Artículos deportivos Adidas',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Zara',
      slug: 'zara',
      description: 'Moda contemporánea Zara',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Gucci',
      slug: 'gucci',
      description: 'Artículos de lujo Gucci',
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdBrands: any[] = [];
  for (const brand of brands) {
    const createdBrand = await client.brands.upsert({
      where: { name: brand.name },
      update: {},
      create: {
        name: brand.name,
        description: brand.description,
      },
    });
    createdBrands.push(createdBrand);
  }

  // ============================================
  // 5. CREATE PRODUCTS
  // ============================================

  const products = [
    // Products for Tech Solutions
    {
      name: 'MacBook Pro 14"',
      slug: 'macbook-pro-14',
      description: 'Laptop MacBook Pro de 14 pulgadas con chip M3 Pro',
      sku: 'MBP14-M3-512',
      base_price: 4500000,
      cost_price: 3500000,
      weight: 1.6,
      dimensions: { length: 31.26, width: 22.12, height: 1.55 },
      track_inventory: true,
      stock_quantity: 25,
      min_stock_level: 5,
      max_stock_level: 50,
      reorder_point: 10,
      reorder_quantity: 20,
      requires_serial_numbers: true,
      requires_batch_tracking: true,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'laptops' && c.store_id === techStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'apple')?.id,
      status: 'active',
    },
    {
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      description: 'iPhone 15 Pro con 256GB de almacenamiento',
      sku: 'IP15P-256-BLK',
      base_price: 5200000,
      cost_price: 4200000,
      weight: 0.221,
      dimensions: { length: 14.67, width: 7.05, height: 0.81 },
      track_inventory: true,
      stock_quantity: 30,
      min_stock_level: 8,
      max_stock_level: 60,
      reorder_point: 15,
      reorder_quantity: 25,
      requires_serial_numbers: true,
      requires_batch_tracking: false,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'smartphones' && c.store_id === techStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'apple')?.id,
      status: 'active',
    },
    {
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
      description: 'Samsung Galaxy S24 con 256GB',
      sku: 'SGS24-256-BLU',
      base_price: 3800000,
      cost_price: 3000000,
      weight: 0.167,
      dimensions: { length: 14.7, width: 7.0, height: 0.79 },
      track_inventory: true,
      stock_quantity: 45,
      min_stock_level: 10,
      max_stock_level: 80,
      reorder_point: 20,
      reorder_quantity: 30,
      requires_serial_numbers: true,
      requires_batch_tracking: false,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'smartphones' && c.store_id === techStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'samsung')?.id,
      status: 'active',
    },
    {
      name: 'Cargador USB-C 65W',
      slug: 'cargador-usb-c-65w',
      description: 'Cargador USB-C de 65 watts con GaN',
      sku: 'CHG-USB65-GAN',
      base_price: 150000,
      cost_price: 80000,
      weight: 0.12,
      dimensions: { length: 6.5, width: 6.5, height: 2.8 },
      track_inventory: true,
      stock_quantity: 100,
      min_stock_level: 20,
      max_stock_level: 200,
      reorder_point: 40,
      reorder_quantity: 50,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'cargadores-cables' && c.store_id === techStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'samsung')?.id,
      status: 'active',
    },
    // Products for Fashion Retail
    {
      name: 'Nike Air Max 90',
      slug: 'nike-air-max-90',
      description: 'Zapatillas Nike Air Max 90 clásicas',
      sku: 'NAM90-42-BLK',
      base_price: 380000,
      cost_price: 220000,
      weight: 0.35,
      dimensions: { length: 30, width: 20, height: 12 },
      track_inventory: true,
      stock_quantity: 60,
      min_stock_level: 15,
      max_stock_level: 100,
      reorder_point: 25,
      reorder_quantity: 40,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'calzado' && c.store_id === fashionStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'nike')?.id,
      status: 'active',
    },
    {
      name: 'Camiseta Adidas Clásica',
      slug: 'camiseta-adidas-clasica',
      description: 'Camiseta deportiva Adidas con logo clásico',
      sku: 'CAD-CLAS-M-BLK',
      base_price: 120000,
      cost_price: 65000,
      weight: 0.18,
      dimensions: { length: 28, width: 25, height: 2 },
      track_inventory: true,
      stock_quantity: 80,
      min_stock_level: 20,
      max_stock_level: 150,
      reorder_point: 30,
      reorder_quantity: 50,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      category_id: createdCategories.find(
        (c) => c.slug === 'ropa-masculina' && c.store_id === fashionStore1.id,
      )?.id,
      brand_id: createdBrands.find((b) => b.slug === 'adidas')?.id,
      status: 'active',
    },
  ];

  const createdProducts: any[] = [];
  for (const product of products) {
    const createdProduct = await client.products.upsert({
      where: {
        store_id_sku: {
          store_id: product.store_id,
          sku: product.sku || '',
        },
      },
      update: {},
      create: {
        name: product.name,
        description: product.description,
        sku: product.sku,
        base_price: product.base_price,
        slug: product.name.toLowerCase().replace(/\s+/g, '-'),
        store_id: product.store_id,
        product_categories: product.category_id
          ? {
              create: {
                category_id: product.category_id,
              },
            }
          : undefined,
        brand_id: product.brand_id,
      },
    });
    createdProducts.push(createdProduct);
  }

  // ============================================
  // 6. ASSIGN TAX CATEGORIES TO PRODUCTS
  // ============================================

  for (const product of products) {
    const createdProduct = createdProducts.find((p) => p.sku === product.sku);
    if (createdProduct) {
      const taxCategory = createdTaxCategories.find((t) =>
        product.organization_id === techSolutionsOrg.id
          ? t.name === 'IVA General'
          : t.name === 'IVA General Fashion',
      );
      if (taxCategory) {
        await client.product_tax_assignments.upsert({
          where: {
            product_id_tax_category_id: {
              product_id: createdProduct.id,
              tax_category_id: taxCategory.id,
            },
          },
          update: {},
          create: {
            product_id: createdProduct.id,
            tax_category_id: taxCategory.id,
          },
        });
      }
    }
  }

  // ============================================
  // 7. CREATE PRODUCT IMAGES
  // ============================================

  const productImages = [
    // Images for MacBook Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      image_url:
        'https://images.apple.com/v/macbook-pro-14/aos/compare/mbp-14-space-gray__d7tfgy9fh0om_large.jpg',
      alt_text: 'MacBook Pro 14" Space Gray',
      is_main: true,
      sort_order: 1,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      image_url:
        'https://images.apple.com/v/macbook-pro-14/aos/compare/mbp-14-silver__b5ys8q2q0y2a_large.jpg',
      alt_text: 'MacBook Pro 14" Silver',
      is_main: false,
      sort_order: 2,
    },
    // Images for iPhone 15 Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      image_url:
        'https://www.apple.com/newsroom/images/2023/09/Apple-unveils-iPhone-15-pro-and-iPhone-15-pro-max/article/Apple-iPhone-15-Pro-lineup-hero-230912.jpg.landing-medium.jpg',
      alt_text: 'iPhone 15 Pro Black Titanium',
      is_main: true,
      sort_order: 1,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      image_url:
        'https://store.storeimages.c-apple.com/8756/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-1inch-blue-titanium?wid=5120&hei=2880&fmt=webp&qlt=70&.v=1692923777972',
      alt_text: 'iPhone 15 Pro Blue Titanium',
      is_main: false,
      sort_order: 2,
    },
    // Images for Samsung Galaxy S24
    {
      product_id: createdProducts.find((p) => p.sku === 'SGS24-256-BLU')?.id,
      image_url:
        'https://images.samsung.com/is/image/samsung/p6pim/latin/feature/sm-s906bzkaxto/feature-large-539503735?$FB_TYPE_B_PNG$',
      alt_text: 'Samsung Galaxy S24 Blue',
      is_main: true,
      sort_order: 1,
    },
    // Images for Nike Air Max
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      image_url:
        'https://static.nike.com/a/images/t_PDP_864_v1/f_auto,b_rgb:f5f5f5/8a44cbe5-e4a2-435e-a54c-87e269eb2b0e/air-max-90-shoes-5KqXQW.png',
      alt_text: 'Nike Air Max 90 Black',
      is_main: true,
      sort_order: 1,
    },
    // Images for Camiseta Adidas
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      image_url:
        'https://assets.adidas.com/images/w_600,f_auto,q_auto/5d2b0b7c53674c6daaa9af1c0111e8f1_9366/Camiseta-Clasica-Negro_HQ2421_01_standard.jpg',
      alt_text: 'Camiseta Adidas Clasica Negra',
      is_main: true,
      sort_order: 1,
    },
  ];

  let imagesCreated = 0;
  for (const image of productImages) {
    if (image.product_id) {
      // Check if image already exists
      const existing = await client.product_images.findFirst({
        where: {
          product_id: image.product_id,
          image_url: image.image_url,
        },
      });

      if (!existing) {
        await client.product_images.create({
          data: {
            product_id: image.product_id,
            image_url: image.image_url,
            is_main: image.is_main,
          },
        });
        imagesCreated++;
      }
    }
  }

  // ============================================
  // 8. CREATE PRODUCT VARIANTS
  // ============================================

  const productVariants = [
    // Variants for MacBook Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      name: 'MacBook Pro 14" - Space Gray',
      sku: 'MBP14-M3-512-SG',
      base_price: 4500000,
      cost_price: 3500000,
      stock_quantity: 10,
      attributes: { color: 'Space Gray', storage: '512GB', ram: '18GB' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      name: 'MacBook Pro 14" - Silver',
      sku: 'MBP14-M3-512-SLV',
      base_price: 4500000,
      cost_price: 3500000,
      stock_quantity: 15,
      attributes: { color: 'Silver', storage: '512GB', ram: '18GB' },
    },
    // Variants for iPhone 15 Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - Black Titanium',
      sku: 'IP15P-256-BT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 12,
      attributes: { color: 'Black Titanium', storage: '256GB' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - White Titanium',
      sku: 'IP15P-256-WT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 8,
      attributes: { color: 'White Titanium', storage: '256GB' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - Blue Titanium',
      sku: 'IP15P-256-BLT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 10,
      attributes: { color: 'Blue Titanium', storage: '256GB' },
    },
    // Variants for Nike Air Max
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 42',
      sku: 'NAM90-42-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 20,
      attributes: { size: '42', color: 'Black' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 43',
      sku: 'NAM90-43-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 25,
      attributes: { size: '43', color: 'Black' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 44',
      sku: 'NAM90-44-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 15,
      attributes: { size: '44', color: 'Black' },
    },
    // Variants for Camiseta Adidas
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - M',
      sku: 'CAD-CLAS-M-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 30,
      attributes: { size: 'M', color: 'Black' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - L',
      sku: 'CAD-CLAS-L-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 25,
      attributes: { size: 'L', color: 'Black' },
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - XL',
      sku: 'CAD-CLAS-XL-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 25,
      attributes: { size: 'XL', color: 'Black' },
    },
  ];

  let variantsCreated = 0;
  for (const variant of productVariants) {
    if (variant.product_id) {
      // Check if variant already exists
      const existing = await client.product_variants.findFirst({
        where: {
          product_id: variant.product_id,
          sku: variant.sku,
        },
      });

      if (!existing) {
        await client.product_variants.create({
          data: {
            product_id: variant.product_id,
            sku: variant.sku,
            price_override: variant.base_price,
            stock_quantity: variant.stock_quantity,
            attributes: variant.attributes,
          },
        });
        variantsCreated++;
      }
    }
  }

  // ============================================
  // RETURN SUMMARY
  // ============================================

  return {
    taxCategoriesCreated: createdTaxCategories.length,
    taxRatesCreated: createdTaxRates.length,
    categoriesCreated: createdCategories.length,
    brandsCreated: createdBrands.length,
    productsCreated: createdProducts.length,
    variantsCreated,
    imagesCreated,
  };
}
