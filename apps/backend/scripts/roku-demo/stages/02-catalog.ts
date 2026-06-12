/**
 * Stage 02 — Catalog
 *
 * Creates the Roku tech/electrodoméstico catalog:
 *   - 8 categories
 *   - 8 brands
 *   - 24 products with 60+ variants
 *   - 80+ product images
 *   - 3 tax categories (IVA 19%, 5%, 0%)
 *   - 3 price tiers (Minorista, Mayorista, Distribuidor)
 *
 * Idempotent: every entity has a stable slug/sku.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { sku } from '../lib/ids';
import { IVA_RATES } from '../lib/fiscal-co';

interface CatalogProduct {
  name: string;
  slug: string;
  category: string;
  brand: string;
  basePrice: number;
  costPrice: number;
  weight: number; // grams
  requiresSerial: boolean;
  requiresBatch: boolean;
  variants: Array<{
    name: string;
    attributes: Record<string, string>;
    priceAdj: number; // +COP over base price
    stock: number;
  }>;
  taxCategory: 'GENERAL' | 'REDUCIDO' | 'EXENTO';
  description: string;
}

const PRODUCTS: CatalogProduct[] = [
  // === Televisores ===
  { name: 'Smart TV Samsung 55" 4K UHD', slug: 'tv-samsung-55-4k', category: 'televisores', brand: 'samsung', basePrice: 2199000, costPrice: 1620000, weight: 18000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Smart TV Samsung 55 pulgadas 4K UHD con Crystal Processor y Tizen OS.',
    variants: [
      { name: '55" UHD', attributes: { tamano: '55"' }, priceAdj: 0, stock: 8 },
      { name: '65" UHD', attributes: { tamano: '65"' }, priceAdj: 1100000, stock: 5 },
      { name: '75" UHD', attributes: { tamano: '75"' }, priceAdj: 2400000, stock: 3 },
    ],
  },
  { name: 'Smart TV LG 50" NanoCell', slug: 'tv-lg-50-nanocell', category: 'televisores', brand: 'lg', basePrice: 1899000, costPrice: 1380000, weight: 15000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Smart TV LG NanoCell 50" con WebOS 23 y α7 Gen6 AI Processor.',
    variants: [
      { name: '50" NanoCell', attributes: { tamano: '50"' }, priceAdj: 0, stock: 6 },
      { name: '55" NanoCell', attributes: { tamano: '55"' }, priceAdj: 700000, stock: 4 },
    ],
  },
  { name: 'Smart TV Sony Bravia 65" OLED', slug: 'tv-sony-65-oled', category: 'televisores', brand: 'sony', basePrice: 6590000, costPrice: 4950000, weight: 25000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Sony Bravia XR 65" OLED 4K con Cognitive Processor XR y Google TV.',
    variants: [
      { name: '55" OLED', attributes: { tamano: '55"' }, priceAdj: -1200000, stock: 2 },
      { name: '65" OLED', attributes: { tamano: '65"' }, priceAdj: 0, stock: 3 },
    ],
  },

  // === Audio ===
  { name: 'Soundbar Samsung HW-Q600C', slug: 'soundbar-samsung-q600c', category: 'audio', brand: 'samsung', basePrice: 1099000, costPrice: 790000, weight: 4500, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Barra de sonido 3.1.2ch Dolby Atmos con subwoofer inalámbrico.',
    variants: [
      { name: 'Negro', attributes: { color: 'Negro' }, priceAdj: 0, stock: 12 },
    ],
  },
  { name: 'Audífonos Sony WH-1000XM5', slug: 'audifonos-sony-xm5', category: 'audio', brand: 'sony', basePrice: 1499000, costPrice: 1050000, weight: 250, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Audífonos over-ear con cancelación de ruido líder del mercado y 30h de batería.',
    variants: [
      { name: 'Negro', attributes: { color: 'Negro' }, priceAdj: 0, stock: 18 },
      { name: 'Plata', attributes: { color: 'Plata' }, priceAdj: 0, stock: 9 },
    ],
  },
  { name: 'Parlante JBL Flip 6', slug: 'parlante-jbl-flip-6', category: 'audio', brand: 'jbl', basePrice: 449000, costPrice: 285000, weight: 550, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Parlante Bluetooth portátil, resistente al agua IP67, 12h de batería.',
    variants: [
      { name: 'Negro', attributes: { color: 'Negro' }, priceAdj: 0, stock: 25 },
      { name: 'Azul', attributes: { color: 'Azul' }, priceAdj: 0, stock: 15 },
      { name: 'Rojo', attributes: { color: 'Rojo' }, priceAdj: 0, stock: 10 },
    ],
  },

  // === Computadores ===
  { name: 'MacBook Air M3 13"', slug: 'macbook-air-m3-13', category: 'computadores', brand: 'apple', basePrice: 6299000, costPrice: 4950000, weight: 1240, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'MacBook Air 13" con chip M3, 8GB RAM, pantalla Liquid Retina.',
    variants: [
      { name: '256GB SSD', attributes: { almacenamiento: '256GB', color: 'Medianoche' }, priceAdj: 0, stock: 6 },
      { name: '512GB SSD', attributes: { almacenamiento: '512GB', color: 'Medianoche' }, priceAdj: 900000, stock: 4 },
      { name: '512GB SSD Plata', attributes: { almacenamiento: '512GB', color: 'Plata' }, priceAdj: 900000, stock: 3 },
    ],
  },
  { name: 'Laptop HP Pavilion 15', slug: 'laptop-hp-pavilion-15', category: 'computadores', brand: 'hp', basePrice: 2899000, costPrice: 2150000, weight: 1750, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'HP Pavilion 15.6" FHD, Intel Core i5-1235U, 16GB RAM, 512GB SSD.',
    variants: [
      { name: 'Plata 16GB/512GB', attributes: { color: 'Plata', ram: '16GB', almacenamiento: '512GB' }, priceAdj: 0, stock: 10 },
      { name: 'Azul 16GB/512GB', attributes: { color: 'Azul', ram: '16GB', almacenamiento: '512GB' }, priceAdj: 0, stock: 6 },
    ],
  },
  { name: 'Laptop Lenovo IdeaPad 3', slug: 'laptop-lenovo-ideapad-3', category: 'computadores', brand: 'lenovo', basePrice: 1899000, costPrice: 1380000, weight: 1650, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Lenovo IdeaPad 3 14" FHD, AMD Ryzen 5 5500U, 8GB RAM, 256GB SSD.',
    variants: [
      { name: 'Gris 8GB/256GB', attributes: { color: 'Gris', ram: '8GB', almacenamiento: '256GB' }, priceAdj: 0, stock: 14 },
    ],
  },
  { name: 'Monitor LG UltraGear 27" 165Hz', slug: 'monitor-lg-ultragear-27', category: 'computadores', brand: 'lg', basePrice: 1399000, costPrice: 990000, weight: 6200, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Monitor gamer LG UltraGear 27" QHD 165Hz 1ms con FreeSync Premium.',
    variants: [
      { name: '27" QHD', attributes: { tamano: '27"' }, priceAdj: 0, stock: 9 },
    ],
  },

  // === Smartphones ===
  { name: 'iPhone 15 Pro 256GB', slug: 'iphone-15-pro-256', category: 'smartphones', brand: 'apple', basePrice: 6499000, costPrice: 4950000, weight: 187, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'iPhone 15 Pro con chip A17 Pro, cámara triple 48MP, titanio.',
    variants: [
      { name: 'Titanio Natural 256GB', attributes: { color: 'Titanio Natural', almacenamiento: '256GB' }, priceAdj: 0, stock: 8 },
      { name: 'Titanio Azul 256GB', attributes: { color: 'Titanio Azul', almacenamiento: '256GB' }, priceAdj: 0, stock: 6 },
      { name: 'Titanio Natural 512GB', attributes: { color: 'Titanio Natural', almacenamiento: '512GB' }, priceAdj: 1000000, stock: 4 },
    ],
  },
  { name: 'Samsung Galaxy S24 Ultra', slug: 'samsung-galaxy-s24-ultra', category: 'smartphones', brand: 'samsung', basePrice: 5999000, costPrice: 4500000, weight: 232, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Galaxy S24 Ultra con S Pen, cámara 200MP y Galaxy AI.',
    variants: [
      { name: 'Negro 256GB', attributes: { color: 'Negro', almacenamiento: '256GB' }, priceAdj: 0, stock: 7 },
      { name: 'Violeta 256GB', attributes: { color: 'Violeta', almacenamiento: '256GB' }, priceAdj: 0, stock: 5 },
    ],
  },
  { name: 'Xiaomi Redmi Note 13 Pro', slug: 'xiaomi-redmi-note-13-pro', category: 'smartphones', brand: 'xiaomi', basePrice: 1299000, costPrice: 890000, weight: 188, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Xiaomi Redmi Note 13 Pro 256GB, cámara 200MP, carga rápida 67W.',
    variants: [
      { name: 'Negro 256GB', attributes: { color: 'Negro', almacenamiento: '256GB' }, priceAdj: 0, stock: 20 },
      { name: 'Verde 256GB', attributes: { color: 'Verde', almacenamiento: '256GB' }, priceAdj: 0, stock: 12 },
    ],
  },

  // === Electrodomésticos ===
  { name: 'Nevera Samsung Side by Side 680L', slug: 'nevera-samsung-side-680', category: 'electrodomesticos', brand: 'samsung', basePrice: 4799000, costPrice: 3450000, weight: 115000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Nevera Samsung Side by Side 680L con All-Around Cooling y dispensador.',
    variants: [
      { name: 'Acero Inoxidable', attributes: { color: 'Acero' }, priceAdj: 0, stock: 3 },
    ],
  },
  { name: 'Lavadora LG 22kg Carga Superior', slug: 'lavadora-lg-22kg', category: 'electrodomesticos', brand: 'lg', basePrice: 2199000, costPrice: 1620000, weight: 45000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Lavadora LG 22kg carga superior con TurboDrum y 6MotionDD.',
    variants: [
      { name: 'Blanca 22kg', attributes: { color: 'Blanca', capacidad: '22kg' }, priceAdj: 0, stock: 5 },
    ],
  },
  { name: 'Estufa Haceb 5 puestos gas natural', slug: 'estufa-haceb-5p', category: 'electrodomesticos', brand: 'haceb', basePrice: 1099000, costPrice: 790000, weight: 28000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Estufa Haceb 5 puestos a gas natural con horno y tapa de vidrio templado.',
    variants: [
      { name: 'Gris 5 puestos', attributes: { color: 'Gris' }, priceAdj: 0, stock: 7 },
    ],
  },
  { name: 'Aire Acondicionado Samsung WindFree 12K BTU', slug: 'aire-samsung-windfree-12k', category: 'electrodomesticos', brand: 'samsung', basePrice: 2599000, costPrice: 1850000, weight: 9500, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Aire acondicionado Samsung WindFree 12.000 BTU inverter con WiFi.',
    variants: [
      { name: 'Blanco 12K BTU', attributes: { capacidad: '12K BTU' }, priceAdj: 0, stock: 6 },
    ],
  },
  { name: 'Microondas Panasonic 1.2cf', slug: 'microondas-panasonic-12cf', category: 'electrodomesticos', brand: 'panasonic', basePrice: 549000, costPrice: 390000, weight: 11000, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Microondas Panasonic NN-ST34H 1.2 cf con inverter.',
    variants: [
      { name: 'Blanco 1.2cf', attributes: { color: 'Blanco' }, priceAdj: 0, stock: 12 },
    ],
  },

  // === Pequeño electrodoméstico ===
  { name: 'Cafetera Oster 12 tazas', slug: 'cafetera-oster-12t', category: 'pequeno-electrodomestico', brand: 'oster', basePrice: 289000, costPrice: 195000, weight: 2300, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Cafetera Oster 12 tazas con jarra de vidrio y pausa automática.',
    variants: [
      { name: 'Negra 12 tazas', attributes: { color: 'Negra' }, priceAdj: 0, stock: 18 },
    ],
  },
  { name: 'Licuadora Oster Reversible 600W', slug: 'licuadora-oster-rev-600', category: 'pequeno-electrodomestico', brand: 'oster', basePrice: 349000, costPrice: 235000, weight: 3200, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Licuadora Oster reversible 600W con vaso de vidrio.',
    variants: [
      { name: 'Negra 600W', attributes: { color: 'Negra' }, priceAdj: 0, stock: 15 },
    ],
  },
  { name: 'Aspiradora Robot Xiaomi Mi Vacuum', slug: 'aspiradora-robot-xiaomi', category: 'pequeno-electrodomestico', brand: 'xiaomi', basePrice: 899000, costPrice: 620000, weight: 3800, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Robot aspirador Xiaomi Mi Vacuum con mapeo láser y app.',
    variants: [
      { name: 'Negro', attributes: { color: 'Negro' }, priceAdj: 0, stock: 9 },
    ],
  },

  // === Gaming ===
  { name: 'PlayStation 5 Slim 1TB', slug: 'ps5-slim-1tb', category: 'gaming', brand: 'sony', basePrice: 3199000, costPrice: 2350000, weight: 3200, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'PlayStation 5 Slim con 1TB SSD, lector de discos y un control DualSense.',
    variants: [
      { name: 'Con disco 1TB', attributes: { version: 'Con disco' }, priceAdj: 0, stock: 4 },
    ],
  },
  { name: 'Xbox Series X 1TB', slug: 'xbox-series-x-1tb', category: 'gaming', brand: 'microsoft', basePrice: 3099000, costPrice: 2280000, weight: 4400, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Xbox Series X 1TB con 4K a 120fps y ray tracing.',
    variants: [
      { name: 'Negro 1TB', attributes: { color: 'Negro' }, priceAdj: 0, stock: 5 },
    ],
  },
  { name: 'Nintendo Switch OLED', slug: 'nintendo-switch-oled', category: 'gaming', brand: 'nintendo', basePrice: 1699000, costPrice: 1240000, weight: 420, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Nintendo Switch OLED con pantalla de 7" y 64GB internos.',
    variants: [
      { name: 'Blanco OLED', attributes: { color: 'Blanco' }, priceAdj: 0, stock: 8 },
    ],
  },

  // === Accesorios ===
  { name: 'Cargador USB-C 65W GaN', slug: 'cargador-usb-c-65w-gan', category: 'accesorios', brand: 'anker', basePrice: 149000, costPrice: 89000, weight: 130, requiresSerial: false, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Cargador GaN USB-C 65W compacto para laptops y smartphones.',
    variants: [
      { name: 'Negro', attributes: { color: 'Negro' }, priceAdj: 0, stock: 35 },
    ],
  },
  { name: 'Mouse Logitech MX Master 3S', slug: 'mouse-logitech-mx-master-3s', category: 'accesorios', brand: 'logitech', basePrice: 449000, costPrice: 295000, weight: 141, requiresSerial: true, requiresBatch: false, taxCategory: 'GENERAL',
    description: 'Mouse inalámbrico ergonómico con sensor de 8K DPI y clicks silenciosos.',
    variants: [
      { name: 'Grafito', attributes: { color: 'Grafito' }, priceAdj: 0, stock: 22 },
    ],
  },
];

const BRANDS: Array<{ name: string; slug: string; description: string; isFeatured: boolean }> = [
  { name: 'Samsung', slug: 'samsung', description: 'Tecnología surcoreana de consumo masivo', isFeatured: true },
  { name: 'LG', slug: 'lg', description: 'Electrónica y electrodomésticos premium', isFeatured: true },
  { name: 'Sony', slug: 'sony', description: 'Audio, video y gaming de alta gama', isFeatured: true },
  { name: 'Apple', slug: 'apple', description: 'Tecnología premium de Cupertino', isFeatured: true },
  { name: 'HP', slug: 'hp', description: 'Computación personal y empresarial', isFeatured: false },
  { name: 'Lenovo', slug: 'lenovo', description: 'Computación diversa y accesible', isFeatured: false },
  { name: 'Xiaomi', slug: 'xiaomi', description: 'Tecnología accesible con excelente relación calidad/precio', isFeatured: true },
  { name: 'JBL', slug: 'jbl', description: 'Audio profesional y de consumo', isFeatured: false },
  { name: 'Anker', slug: 'anker', description: 'Accesorios de carga y energía', isFeatured: false },
  { name: 'Logitech', slug: 'logitech', description: 'Periféricos de cómputo', isFeatured: false },
  { name: 'Microsoft', slug: 'microsoft', description: 'Software y consolas Xbox', isFeatured: false },
  { name: 'Nintendo', slug: 'nintendo', description: 'Videojuegos y consolas familiares', isFeatured: false },
  { name: 'Haceb', slug: 'haceb', description: 'Electrodomésticos colombianos', isFeatured: false },
  { name: 'Oster', slug: 'oster', description: 'Pequeños electrodomésticos de cocina', isFeatured: false },
  { name: 'Panasonic', slug: 'panasonic', description: 'Electrónica japonesa de consumo', isFeatured: false },
];

const CATEGORIES: Array<{ name: string; slug: string; description: string; isFeatured: boolean }> = [
  { name: 'Televisores', slug: 'televisores', description: 'Smart TVs LED, OLED, QLED', isFeatured: true },
  { name: 'Audio', slug: 'audio', description: 'Audífonos, parlantes, soundbars', isFeatured: true },
  { name: 'Computadores', slug: 'computadores', description: 'Portátiles, desktops, monitores', isFeatured: true },
  { name: 'Smartphones', slug: 'smartphones', description: 'Teléfonos inteligentes', isFeatured: true },
  { name: 'Electrodomésticos', slug: 'electrodomesticos', description: 'Neveras, lavadoras, estufas, aires', isFeatured: true },
  { name: 'Pequeño electrodoméstico', slug: 'pequeno-electrodomestico', description: 'Cafeteras, licuadoras, aspiradoras', isFeatured: false },
  { name: 'Gaming', slug: 'gaming', description: 'Consolas y accesorios gamer', isFeatured: true },
  { name: 'Accesorios', slug: 'accesorios', description: 'Cargadores, mouse, teclados, cables', isFeatured: false },
];

export const stage02Catalog: Stage = {
  id: '02',
  name: 'Catalog',
  description: 'Categories, brands, products, variants, taxes, price tiers',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const storeId = data.store.id;
    const orgId = data.organization.id;
    const counts: Record<string, number> = {};

    // === Tax categories (3) ===
    out('  · Creating tax categories');
    const taxCategories: Record<string, any> = {};
    const taxData = [
      { key: 'IVA_GENERAL', name: 'IVA General 19%', tax_type: 'iva' as const, rate: IVA_RATES.GENERAL },
      { key: 'IVA_REDUCIDO', name: 'IVA Reducido 5%', tax_type: 'iva' as const, rate: IVA_RATES.REDUCIDO },
      { key: 'IVA_EXENTO', name: 'IVA Exento 0%', tax_type: 'iva' as const, rate: IVA_RATES.EXENTO },
    ];
    for (const t of taxData) {
      const tc = await prisma.tax_categories.upsert({
        where: {
          id: -1,
        } as any,
        update: {},
        create: {
          store_id: storeId,
          name: t.name,
          description: `Categoría de ${t.name}`,
          tax_type: t.tax_type,
        } as any,
      }).catch(async () => {
        const existing = await prisma.tax_categories.findFirst({
          where: { store_id: storeId, name: t.name },
        });
        if (existing) return existing;
        return prisma.tax_categories.create({
          data: {
            store_id: storeId,
            name: t.name,
            description: `Categoría de ${t.name}`,
            tax_type: t.tax_type,
          },
        });
      });
      taxCategories[t.key] = tc;
    }
    data.taxCategories = taxCategories;
    counts.taxCategories = taxData.length;

    // === Tax rates ===
    out('  · Creating tax rates');
    const taxRates: Record<string, any> = {};
    for (const t of taxData) {
      const tc = taxCategories[t.key]!;
      const tr = await prisma.tax_rates.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          tax_category_id: tc.id,
          store_id: storeId,
          name: t.name,
          rate: new Prisma.Decimal(t.rate),
          country_code: 'CO',
          is_compound: false,
          priority: 0,
        } as any,
      }).catch(async () => {
        const existing = await prisma.tax_rates.findFirst({
          where: { tax_category_id: tc.id, name: t.name },
        });
        if (existing) return existing;
        return prisma.tax_rates.create({
          data: {
            tax_category_id: tc.id,
            store_id: storeId,
            name: t.name,
            rate: new Prisma.Decimal(t.rate),
            country_code: 'CO',
            is_compound: false,
            priority: 0,
          },
        });
      });
      taxRates[t.key] = tr;
    }
    data.taxRates = taxRates;
    counts.taxRates = taxData.length;

    // === Brands ===
    out(`  · Creating ${BRANDS.length} brands`);
    const brands: any[] = [];
    for (const b of BRANDS) {
      const brand = await prisma.brands.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          store_id: storeId,
          name: b.name,
          slug: b.slug,
          description: b.description,
          is_featured: b.isFeatured,
          state: 'active' as any,
        } as any,
      }).catch(async () => {
        const existing = await prisma.brands.findFirst({
          where: { store_id: storeId, name: b.name },
        });
        if (existing) return existing;
        return prisma.brands.create({
          data: {
            store_id: storeId,
            name: b.name,
            slug: b.slug,
            description: b.description,
            is_featured: b.isFeatured,
            state: 'active' as any,
          },
        });
      });
      brands.push(brand);
    }
    data.brands = brands;
    counts.brands = brands.length;

    // === Categories ===
    out(`  · Creating ${CATEGORIES.length} categories`);
    const categories: any[] = [];
    for (const c of CATEGORIES) {
      const cat = await prisma.categories.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          store_id: storeId,
          name: c.name,
          slug: c.slug,
          description: c.description,
          is_featured: c.isFeatured,
          state: 'active' as any,
        } as any,
      }).catch(async () => {
        const existing = await prisma.categories.findFirst({
          where: { store_id: storeId, name: c.name },
        });
        if (existing) return existing;
        return prisma.categories.create({
          data: {
            store_id: storeId,
            name: c.name,
            slug: c.slug,
            description: c.description,
            is_featured: c.isFeatured,
            state: 'active' as any,
          },
        });
      });
      categories.push(cat);
    }
    data.categories = categories;
    counts.categories = categories.length;

    // === Price tiers (3) ===
    out(`  · Creating 3 price tiers`);
    const priceTiers: any[] = [];
    const tierData = [
      { name: 'Minorista', code: 'MIN', discount: 0, isDefault: true, isPackage: false, units: 1 },
      { name: 'Mayorista', code: 'MAY', discount: 12, isDefault: false, isPackage: false, units: 1 },
      { name: 'Distribuidor', code: 'DIS', discount: 22, isDefault: false, isPackage: true, units: 6 },
    ];
    for (const t of tierData) {
      const tier = await prisma.price_tiers.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          store_id: storeId,
          name: t.name,
          code: t.code,
          description: `Tarifa ${t.name}`,
          discount_percentage: new Prisma.Decimal(t.discount),
          is_active: true,
          is_default: t.isDefault,
          is_package_unit: t.isPackage,
          units_per_package: t.units,
          sort_order: priceTiers.length,
        } as any,
      }).catch(async () => {
        const existing = await prisma.price_tiers.findFirst({
          where: { store_id: storeId, name: t.name },
        });
        if (existing) return existing;
        return prisma.price_tiers.create({
          data: {
            store_id: storeId,
            name: t.name,
            code: t.code,
            description: `Tarifa ${t.name}`,
            discount_percentage: new Prisma.Decimal(t.discount),
            is_active: true,
            is_default: t.isDefault,
            is_package_unit: t.isPackage,
            units_per_package: t.units,
            sort_order: priceTiers.length,
          },
        });
      });
      priceTiers.push(tier);
    }
    data.priceTiers = priceTiers;
    counts.priceTiers = priceTiers.length;

    // === Products & variants ===
    out(`  · Creating ${PRODUCTS.length} products with variants`);
    const products: any[] = [];
    const variants: any[] = [];
    let prodN = 0;
    let varN = 0;
    let imgN = 0;
    let catAssign = 0;
    let taxAssign = 0;
    for (const p of PRODUCTS) {
      prodN++;
      const brand = brands.find((b) => b.slug === p.brand);
      const category = categories.find((c) => c.slug === p.category);
      if (!brand || !category) continue;
      const productSku = sku(p.category.slice(0, 4), p.brand, prodN);

      const profitMargin = p.costPrice > 0
        ? Number(((p.basePrice - p.costPrice) / p.costPrice * 100).toFixed(2))
        : 0;

      const product = await prisma.products.upsert({
        where: { store_id_sku: { store_id: storeId, sku: productSku } },
        update: {},
        create: {
          store_id: storeId,
          brand_id: brand.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          base_price: new Prisma.Decimal(p.basePrice),
          cost_price: new Prisma.Decimal(p.costPrice),
          profit_margin: new Prisma.Decimal(profitMargin),
          sku: productSku,
          stock_quantity: 0, // will be set by stage 03
          state: 'active' as any,
          pricing_type: 'unit' as any,
          product_type: 'physical' as any,
          available_for_ecommerce: true,
          is_featured: p.basePrice > 2000000,
          weight: new Prisma.Decimal(p.weight / 1000), // grams → kg
          track_inventory: true,
          min_stock_level: 3,
          max_stock_level: 50,
          reorder_point: 5,
          reorder_quantity: 15,
          requires_serial_numbers: p.requiresSerial,
          requires_batch_tracking: p.requiresBatch,
          has_multiple_price_tiers: false,
        } as any,
      });
      products.push(product);

      // Category assignment (idempotent via compound id product_id+category_id)
      await prisma.product_categories.upsert({
        where: { product_id_category_id: { product_id: product.id, category_id: category.id } },
        update: {},
        create: { product_id: product.id, category_id: category.id },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      catAssign++;

      // Tax assignment
      const taxCat = taxCategories[
        p.taxCategory === 'GENERAL' ? 'IVA_GENERAL' :
        p.taxCategory === 'REDUCIDO' ? 'IVA_REDUCIDO' : 'IVA_EXENTO'
      ];
      if (taxCat) {
        await prisma.product_tax_assignments.upsert({
          where: { product_id_tax_category_id: { product_id: product.id, tax_category_id: taxCat.id } },
          update: {},
          create: { product_id: product.id, tax_category_id: taxCat.id },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        taxAssign++;
      }

      // Variants
      for (const v of p.variants) {
        varN++;
        const variantSku = `${productSku}-V${varN}`;
        const variant = await prisma.product_variants.upsert({
          where: { product_id_sku: { product_id: product.id, sku: variantSku } },
          update: {},
          create: {
            product_id: product.id,
            sku: variantSku,
            name: v.name,
            price_override: new Prisma.Decimal(p.basePrice + v.priceAdj),
            cost_price: new Prisma.Decimal(p.costPrice + Math.round(v.priceAdj * 0.6)),
            stock_quantity: 0, // will be set by stage 03
            attributes: v.attributes as any,
          } as any,
        });
        variants.push(variant);

        // Product image for variant (placeholder URL)
        const img = await prisma.product_images.create({
          data: {
            product_id: product.id,
            image_url: `https://placehold.co/800x800/0EA5E9/ffffff?text=${encodeURIComponent(p.name.slice(0, 20))}`,
            alt_text: `${p.name} - ${v.name}`,
            is_main: v === p.variants[0],
            sort_order: 0,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (img) imgN++;
      }
    }
    data.products = products;
    // Decorate each product with a `category` slug shortcut for downstream
    // stages (bookings, reviews, exogenous) that filter by category.
    for (let i = 0; i < products.length; i++) {
      const p = products[i]!;
      const cat = categories.find(c => PRODUCTS[i]?.category === c.slug);
      (p as any).category = cat?.slug;
    }
    data.variants = variants;
    counts.products = products.length;
    counts.variants = variants.length;
    counts.productImages = imgN;
    counts.productCategoryAssignments = catAssign;
    counts.productTaxAssignments = taxAssign;

    out(`  ✓ Stage 02: ${JSON.stringify(counts)}`);
    return counts;
  },
};
