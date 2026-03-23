import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  BulkProductUploadDto,
  BulkProductItemDto,
  BulkUploadResultDto,
  BulkUploadItemResultDto,
  BulkValidationResultDto,
  BulkUploadTemplateDto,
} from './dto';
import { generateSlug } from '@common/utils/slug.util';
import { toTitleCase } from '@common/utils/format.util';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductsBulkService {
  private readonly MAX_BATCH_SIZE = 1000;

  // Mapa de encabezados en Español a claves del DTO
  private readonly HEADER_MAP = {
    Nombre: 'name',
    SKU: 'sku',
    'Precio Venta': 'base_price',
    'Precio Compra': 'cost_price',
    Margen: 'profit_margin',
    'Cantidad Inicial': 'stock_quantity',
    Descripción: 'description',
    Categorías: 'category_ids',
    Marca: 'brand_id',
    Estado: 'state',
    'Disponible Ecommerce': 'available_for_ecommerce',
    'En Oferta': 'is_on_sale',
    'Precio Oferta': 'sale_price',
    Peso: 'weight',
    'Codigo Bodega': 'warehouse_code',
    'Nombre Bodega': 'warehouse_name',
    Tipo: 'product_type',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly variantService: ProductVariantService,
    private readonly accessValidationService: AccessValidationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly locationsService: LocationsService,
  ) {}

  /**
   * Genera la plantilla de carga masiva en formato Excel (.xlsx)
   */
  async generateExcelTemplate(type: 'quick' | 'complete'): Promise<Buffer> {
    let headers: string[] = [];
    let exampleData: any[] = [];

    if (type === 'quick') {
      headers = [
        'Nombre',
        'SKU',
        'Tipo',
        'Precio Venta',
        'Precio Compra',
        'Cantidad Inicial',
      ];
      exampleData = [
        { Nombre: 'Camiseta Básica Blanca', SKU: 'CAM-BAS-BLA-001', Tipo: 'Producto', 'Precio Venta': 15000, 'Precio Compra': 8000, 'Cantidad Inicial': 50 },
        { Nombre: 'Pantalón Jean Clásico', SKU: 'PAN-JEA-CLA-032', Tipo: 'Producto', 'Precio Venta': 45000, 'Precio Compra': 22000, 'Cantidad Inicial': 30 },
        { Nombre: 'Asesoría Contable', SKU: 'SVC-ASE-CON-001', Tipo: 'Servicio', 'Precio Venta': 80000, 'Precio Compra': 30000, 'Cantidad Inicial': 0 },
        { Nombre: 'Protector Solar FPS 50', SKU: 'PRO-SOL-FPS-050', Tipo: 'Producto', 'Precio Venta': 32000, 'Precio Compra': 18000, 'Cantidad Inicial': 80 },
        { Nombre: 'Instalación Técnica', SKU: 'SVC-INS-TEC-001', Tipo: 'Servicio', 'Precio Venta': 120000, 'Precio Compra': 50000, 'Cantidad Inicial': 0 },
        { Nombre: 'Café Orgánico 500g', SKU: 'CAF-ORG-500-012', Tipo: 'Producto', 'Precio Venta': 28000, 'Precio Compra': 15000, 'Cantidad Inicial': 120 },
        { Nombre: 'Balón Fútbol Profesional', SKU: 'BAL-FUT-PRO-005', Tipo: 'Producto', 'Precio Venta': 75000, 'Precio Compra': 38000, 'Cantidad Inicial': 25 },
        { Nombre: 'Mochila Escolar 40L', SKU: 'MOC-ESC-40L-018', Tipo: 'Producto', 'Precio Venta': 55000, 'Precio Compra': 27000, 'Cantidad Inicial': 40 },
        { Nombre: 'Lámpara LED Escritorio', SKU: 'LAM-LED-ESC-003', Tipo: 'Producto', 'Precio Venta': 42000, 'Precio Compra': 19000, 'Cantidad Inicial': 0 },
        { Nombre: 'Toalla Microfibra XL', SKU: 'TOA-MIC-XL-025', Tipo: 'Producto', 'Precio Venta': 18000, 'Precio Compra': 7500, 'Cantidad Inicial': 200 },
      ];
    } else {
      headers = [
        'Nombre',
        'SKU',
        'Tipo',
        'Precio Venta',
        'Precio Compra',
        'Margen',
        'Cantidad Inicial',
        'Codigo Bodega',
        'Nombre Bodega',
        'Descripción',
        'Marca',
        'Categorías',
        'Estado',
        'Disponible Ecommerce',
        'Peso',
        'En Oferta',
        'Precio Oferta',
      ];
      exampleData = [
        { Nombre: 'Zapatillas Running Pro', SKU: 'ZAP-RUN-PRO-42', Tipo: 'Producto', 'Precio Venta': 85000, 'Precio Compra': 45000, Margen: 45, 'Cantidad Inicial': 20, 'Codigo Bodega': 'BOD-001', 'Nombre Bodega': '', Descripción: 'Zapatillas ideales para correr largas distancias.', Marca: 'Nike', Categorías: 'Deportes, Calzado, Running', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 0.8, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Asesoría Tributaria', SKU: 'SVC-ASE-TRI-001', Tipo: 'Servicio', 'Precio Venta': 150000, 'Precio Compra': 60000, Margen: 60, 'Cantidad Inicial': 0, 'Codigo Bodega': '', 'Nombre Bodega': '', Descripción: 'Asesoría tributaria profesional por sesión.', Marca: '', Categorías: 'Servicios, Contabilidad', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 0, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Leche Entera 1L', SKU: 'LEC-ENT-1L-COL', Tipo: 'Producto', 'Precio Venta': 5200, 'Precio Compra': 3800, Margen: 37, 'Cantidad Inicial': 200, 'Codigo Bodega': 'BOD-001', 'Nombre Bodega': '', Descripción: 'Leche entera pasteurizada de origen colombiano.', Marca: 'Colanta', Categorías: 'Alimentos, Lácteos', Estado: 'activo', 'Disponible Ecommerce': 'No', Peso: 1.05, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Camiseta Dry-Fit Running', SKU: 'CAM-DRY-RUN-M01', Tipo: 'Producto', 'Precio Venta': 65000, 'Precio Compra': 32000, Margen: 50, 'Cantidad Inicial': 35, 'Codigo Bodega': '', 'Nombre Bodega': '', Descripción: 'Camiseta deportiva transpirable para hombre.', Marca: 'Adidas', Categorías: 'Deportes, Ropa Deportiva', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 0.15, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Escritorio Plegable Madera', SKU: 'ESC-PLE-MAD-120', Tipo: 'Producto', 'Precio Venta': 180000, 'Precio Compra': 95000, Margen: 47, 'Cantidad Inicial': 8, 'Codigo Bodega': 'BOD-002', 'Nombre Bodega': '', Descripción: 'Escritorio plegable de madera 120x60cm para home office.', Marca: 'Muebles Express', Categorías: 'Hogar, Muebles, Oficina', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 15, 'En Oferta': 'Si', 'Precio Oferta': 155000 },
        { Nombre: 'Aceite de Oliva Extra Virgen 500ml', SKU: 'ACE-OLI-EXV-500', Tipo: 'Producto', 'Precio Venta': 38000, 'Precio Compra': 24000, Margen: 58, 'Cantidad Inicial': 60, 'Codigo Bodega': '', 'Nombre Bodega': 'Bodega Principal', Descripción: 'Aceite de oliva importado, primera prensada en frío.', Marca: 'Olivetto', Categorías: 'Alimentos, Aceites', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 0.55, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Teclado Mecánico RGB', SKU: 'TEC-MEC-RGB-K70', Tipo: 'Producto', 'Precio Venta': 320000, 'Precio Compra': 180000, Margen: 78, 'Cantidad Inicial': 12, 'Codigo Bodega': '', 'Nombre Bodega': '', Descripción: 'Teclado mecánico con switches Cherry MX e iluminación RGB.', Marca: 'Corsair', Categorías: 'Tecnología, Periféricos, Gaming', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 1.2, 'En Oferta': 'Si', 'Precio Oferta': 280000 },
        { Nombre: 'Bloqueador Solar Facial SPF 60', SKU: 'BLO-SOL-FAC-060', Tipo: 'Producto', 'Precio Venta': 48000, 'Precio Compra': 28000, Margen: 71, 'Cantidad Inicial': 45, 'Codigo Bodega': 'BOD-001', 'Nombre Bodega': '', Descripción: 'Protector solar facial oil-free con SPF 60.', Marca: 'La Roche-Posay', Categorías: 'Belleza, Cuidado Personal', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 0.1, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Cuerda de Saltar Profesional', SKU: 'CUE-SAL-PRO-300', Tipo: 'Producto', 'Precio Venta': 22000, 'Precio Compra': 9000, Margen: 59, 'Cantidad Inicial': 0, 'Codigo Bodega': '', 'Nombre Bodega': '', Descripción: 'Cuerda de saltar con rodamientos y mangos antideslizantes.', Marca: 'Everlast', Categorías: 'Deportes, Fitness', Estado: 'inactivo', 'Disponible Ecommerce': 'No', Peso: 0.3, 'En Oferta': 'No', 'Precio Oferta': 0 },
        { Nombre: 'Set Ollas Antiadherentes x5', SKU: 'SET-OLL-ANT-5PC', Tipo: 'Producto', 'Precio Venta': 145000, 'Precio Compra': 72000, Margen: 50, 'Cantidad Inicial': 18, 'Codigo Bodega': '', 'Nombre Bodega': 'Bodega Secundaria', Descripción: 'Juego de 5 ollas con recubrimiento antiadherente cerámico.', Marca: 'T-fal', Categorías: 'Hogar, Cocina', Estado: 'activo', 'Disponible Ecommerce': 'Si', Peso: 4.5, 'En Oferta': 'Si', 'Precio Oferta': 125000 },
      ];
    }

    const ws = XLSX.utils.json_to_sheet(exampleData, { header: headers });

    // Ajustar ancho de columnas
    const colWidths = headers.map((h) => ({ wch: Math.max(h.length + 5, 20) }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Productos');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Procesa la carga masiva de productos
   */
  async uploadProducts(
    bulkUploadDto: BulkProductUploadDto,
    user: any,
  ): Promise<BulkUploadResultDto> {
    const { products } = bulkUploadDto;

    if (products.length > this.MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} productos`,
      );
    }

    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    await this.accessValidationService.validateStoreAccess(storeId, user);

    const results: BulkUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    // Cache de bodegas para evitar N+1 queries
    const locationCache = new Map<string, any>();

    for (const productData of products) {
      try {
        // Pre-procesar: Crear marcas y categorías si son strings
        await this.preprocessProductData(productData, storeId);

        // Resolver bodega si se especificó
        const resolvedLocation = await this.resolveWarehouse(
          productData.warehouse_code,
          productData.warehouse_name,
          locationCache,
        );

        // Validar datos
        await this.validateProductData(productData, storeId);

        // Buscar si existe por SKU para decidir si Crear o Actualizar
        const existingProduct = await this.prisma.products.findFirst({
          where: {
            store_id: storeId,
            sku: productData.sku,
            state: { not: 'archived' },
          },
        });

        let resultProduct;

        await this.prisma.$transaction(async (tx) => {
          if (existingProduct) {
            // Actualizar producto existente
            const updateProductDto = this.mapToUpdateProductDto(productData);
            resultProduct = await this.productsService.update(
              existingProduct.id,
              updateProductDto,
            );

            // Asignar stock a bodega si hay cantidad y bodega resuelta
            const isPhysical = (productData.product_type || 'physical') !== 'service';
            const stockQty = productData.stock_quantity || 0;
            if (isPhysical && stockQty > 0) {
              const targetLocation =
                resolvedLocation ||
                (await this.locationsService.getDefaultLocation(storeId));
              if (targetLocation) {
                await this.stockLevelManager.updateStock({
                  product_id: existingProduct.id,
                  location_id: targetLocation.id,
                  quantity_change: stockQty,
                  movement_type: 'adjustment',
                  reason: 'Carga masiva - actualización de stock',
                });
              }
            }

            results.push({
              product: resultProduct,
              status: 'success',
              message: `Producto con SKU ${productData.sku} actualizado exitosamente`,
            });
          } else {
            // Crear nuevo producto
            const createProductDto = this.mapToCreateProductDto(
              productData,
              storeId,
            );
            let createdId = null;
            try {
              resultProduct =
                await this.productsService.create(createProductDto);
              createdId = (resultProduct as any).id;

              // Variantes
              if (productData.variants && productData.variants.length > 0) {
                await this.processProductVariants(
                  createdId as unknown as number,
                  productData.variants,
                );
              }

              // Asignar stock inicial a bodega
              const isPhysical = (productData.product_type || 'physical') !== 'service';
              const stockQty = productData.stock_quantity || 0;
              if (isPhysical && stockQty > 0) {
                const targetLocation =
                  resolvedLocation ||
                  (await this.locationsService.getDefaultLocation(storeId));
                if (targetLocation) {
                  await this.stockLevelManager.updateStock({
                    product_id: createdId!,
                    location_id: targetLocation.id,
                    quantity_change: stockQty,
                    movement_type: 'initial',
                    reason: 'Carga masiva - stock inicial',
                  });
                }
              }

              results.push({
                product: resultProduct,
                status: 'success',
                message: 'Producto creado exitosamente',
              });
            } catch (createErr) {
              if (createdId) {
                await this.prisma.products
                  .delete({ where: { id: createdId } })
                  .catch((e) => console.error('Cleanup failed', e));
              }
              throw createErr;
            }
          }
        });

        successful++;
      } catch (error) {
        results.push({
          product: null,
          status: 'error',
          message: error.message,
          error: error.constructor.name,
        });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total_processed: products.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Pre-procesa datos para convertir Nombres de Marca/Categoría a IDs
   * Crea las entidades si no existen.
   */
  private async preprocessProductData(product: any, storeId: number) {
    // Procesar Marca (Brand)
    if (product.brand_id) {
      if (typeof product.brand_id === 'string') {
        const brandName = (product.brand_id as string).trim();
        if (/^\d+$/.test(brandName)) {
          product.brand_id = parseInt(brandName, 10);
        } else if (brandName) {
          const brandId = await this.findOrCreateBrand(brandName, storeId);
          product.brand_id = brandId;
        } else {
          delete product.brand_id;
        }
      }
    }

    // Procesar Categorías
    if (product.category_ids) {
      let rawCategories: any[] = [];
      if (typeof product.category_ids === 'string') {
        rawCategories = (product.category_ids as string).split(',');
      } else if (Array.isArray(product.category_ids)) {
        rawCategories = product.category_ids;
      }

      if (rawCategories.length > 0) {
        const categoryIds: number[] = [];
        for (const cat of rawCategories) {
          const catStr = cat.toString().trim();
          if (!catStr) continue;

          if (/^\d+$/.test(catStr)) {
            categoryIds.push(parseInt(catStr, 10));
          } else {
            const catId = await this.findOrCreateCategory(catStr, storeId);
            categoryIds.push(catId);
          }
        }
        product.category_ids = categoryIds;
      }
    }

    // Lógica de Precios: Margen tiene preferencia
    const cost = parseFloat(product.cost_price || 0);
    let margin = parseFloat(product.profit_margin || 0);
    // Auto-fix for decimal margins (e.g. 0.3 -> 30%)
    if (margin > 0 && margin < 1) {
      margin = margin * 100;
      product.profit_margin = margin;
    }

    if (margin > 0 && cost > 0) {
      // Precio = Costo * (1 + Margen/100)
      product.base_price = cost * (1 + margin / 100);
    }

    // Normalizar Booleanos (Si/No -> true/false)
    const normalizeBool = (val: any) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        return (
          val.toLowerCase() === 'si' ||
          val.toLowerCase() === 'yes' ||
          val.toLowerCase() === 'verdadero' ||
          val.toLowerCase() === 'true'
        );
      }
      return !!val;
    };

    if (product.is_on_sale !== undefined) {
      product.is_on_sale = normalizeBool(product.is_on_sale);
    }

    if (product.available_for_ecommerce !== undefined) {
      product.available_for_ecommerce = normalizeBool(
        product.available_for_ecommerce,
      );
    }

    // Normalizar Tipo de Producto
    if (product.product_type && typeof product.product_type === 'string') {
      const t = product.product_type.toLowerCase().trim();
      if (t === 'servicio' || t === 'service') {
        product.product_type = 'service';
        // Force service defaults
        product.stock_quantity = 0;
        product.weight = undefined;
      } else {
        product.product_type = 'physical';
      }
    }

    // Normalizar Estado
    if (product.state && typeof product.state === 'string') {
      const s = product.state.toLowerCase();
      if (s === 'activo' || s === 'active' || s === 'habilitado')
        product.state = 'active';
      else if (s === 'inactivo' || s === 'inactive' || s === 'deshabilitado')
        product.state = 'inactive';
      else if (s === 'archivado' || s === 'archived')
        product.state = 'archived';
    }
  }

  private async findOrCreateBrand(
    name: string,
    storeId: number,
  ): Promise<number> {
    // Normalize: trim + lowercase for search
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return 0;

    // Search case-insensitive
    const existing = await this.prisma.brands.findFirst({
      where: {
        name: { equals: normalizedName, mode: 'insensitive' },
      },
    });

    if (existing) return existing.id;

    // Create brand with Title Case
    const titleCaseName = toTitleCase(name.trim());
    const created = await this.prisma.brands.create({
      data: {
        name: titleCaseName,
        description: 'Creada automáticamente por carga masiva',
        state: 'active',
      },
    });
    return created.id;
  }

  private async findOrCreateCategory(
    name: string,
    storeId: number,
  ): Promise<number> {
    // Normalize: trim + lowercase for slug/search
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return 0;

    const slug = generateSlug(normalizedName);

    // Category is unique by store_id + slug
    const existing = await this.prisma.categories.findFirst({
      where: {
        store_id: storeId,
        slug: slug,
      },
    });

    if (existing) return existing.id;

    // Create category with Title Case
    const titleCaseName = toTitleCase(name.trim());
    const created = await this.prisma.categories.create({
      data: {
        name: titleCaseName,
        slug: slug,
        store_id: storeId,
        description: 'Creada automáticamente por carga masiva',
        state: 'active',
      },
    });
    return created.id;
  }

  // --- Validaciones y Helpers ---

  async validateBulkProducts(
    products: BulkProductItemDto[],
    user: any,
  ): Promise<BulkValidationResultDto> {
    const errors: string[] = [];
    const validProducts: BulkProductItemDto[] = [];

    // Validar acceso básico
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      return {
        isValid: false,
        errors: ['Tienda no identificada'],
        validProducts: [],
      };
    }

    // Validar duplicados en el lote
    const skus = new Set<string>();
    const duplicateSkus = new Set<string>();

    for (const p of products) {
      if (skus.has(p.sku)) duplicateSkus.add(p.sku);
      else skus.add(p.sku);
    }

    if (duplicateSkus.size > 0) {
      errors.push(
        `SKUs duplicados en el archivo: ${Array.from(duplicateSkus).join(', ')}`,
      );
    }

    // Validar uno a uno (lógica simplificada para pre-validación,
    // la validación real de negocio ocurre al intentar crear en uploadProducts o aquí mismo)
    // Para no duplicar lógica de findOrCreate, aquí solo validamos estructura básica
    // Y chequeamos si el SKU ya existe en DB.

    for (const [index, product] of products.entries()) {
      if (!product.name || !product.sku || product.base_price === undefined) {
        errors.push(
          `Fila ${index + 1}: Faltan datos obligatorios (Nombre, SKU o Precio)`,
        );
        continue;
      }

      // Ya no bloqueamos si el SKU existe, porque ahora actualizamos
      validProducts.push(product);
    }

    return {
      isValid: errors.length === 0,
      errors,
      validProducts,
    };
  }

  async getBulkUploadTemplate(): Promise<BulkUploadTemplateDto> {
    // Deprecated in favor of Excel download, but kept for compatibility
    return {
      headers: [],
      sample_data: [],
      instructions: 'Use the new Excel download feature.',
    };
  }

  private async validateProductData(
    product: BulkProductItemDto,
    storeId: number,
  ): Promise<void> {
    if (!product.name) throw new BadRequestException('Nombre es requerido');
    if (!product.sku) throw new BadRequestException('SKU es requerido');
    if (product.base_price < 0)
      throw new BadRequestException('Precio base debe ser positivo');

    // IDs de marca y categoría ya deberían ser numéricos aquí tras el pre-procesamiento
    // Si llegaron como números directos, validamos existencia.
    if (product.brand_id && typeof product.brand_id === 'number') {
      const exists = await this.prisma.brands.findUnique({
        where: { id: product.brand_id },
      });
      if (!exists)
        throw new BadRequestException(`Marca ID ${product.brand_id} no existe`);
    }
  }

  private mapToCreateProductDto(
    product: BulkProductItemDto,
    storeId: number,
  ): any {
    return {
      name: product.name,
      base_price: product.base_price,
      sku: product.sku,
      description: product.description,
      slug: product.slug || generateSlug(product.name),
      store_id: storeId,
      brand_id: product.brand_id,
      category_ids: product.category_ids,
      stock_quantity: product.stock_quantity,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      weight: product.weight,
      is_on_sale: product['is_on_sale'],
      sale_price: product['sale_price'],
      state: product.state,
      available_for_ecommerce: product.available_for_ecommerce,
      product_type: product.product_type || 'physical',
      track_inventory: product.product_type === 'service' ? false : undefined,
    };
  }

  private mapToUpdateProductDto(product: BulkProductItemDto): any {
    return {
      name: product.name,
      base_price: product.base_price,
      sku: product.sku,
      description: product.description,
      brand_id: product.brand_id,
      category_ids: product.category_ids,
      stock_quantity: product.stock_quantity,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      weight: product.weight,
      is_on_sale: product['is_on_sale'],
      sale_price: product['sale_price'],
      state: product.state,
      available_for_ecommerce: product.available_for_ecommerce,
    };
  }

  private async processProductVariants(
    productId: number,
    variants: any[],
  ): Promise<void> {
    for (const variantData of variants) {
      await this.productsService.createVariant(productId, variantData);
    }
  }

  /**
   * Resuelve la bodega destino: prioridad código > nombre.
   * Usa cache para evitar N+1 queries por batch.
   * Retorna null si no se especificó bodega (usa default).
   */
  private async resolveWarehouse(
    warehouseCode: string | undefined,
    warehouseName: string | undefined,
    cache: Map<string, any>,
  ): Promise<any | null> {
    const code = warehouseCode?.toString().trim();
    const name = warehouseName?.toString().trim();

    if (!code && !name) return null;

    const cacheKey = code ? `code:${code.toLowerCase()}` : `name:${name!.toLowerCase()}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    let location: any = null;

    if (code) {
      location = await this.locationsService.findByCode(code);
    }

    if (!location && name) {
      location = await this.locationsService.findByName(name);
    }

    if (!location) {
      const context = RequestContextService.getContext()!;
      location = await this.prisma.inventory_locations.create({
        data: {
          name: name || code!,
          code: code || generateSlug(name!),
          type: 'warehouse',
          is_active: true,
          store_id: context.store_id!,
          organization_id: context.organization_id!,
        },
      });

      // Cache with both keys if applicable
      if (code) cache.set(`code:${code.toLowerCase()}`, location);
      if (name) cache.set(`name:${name.toLowerCase()}`, location);
      return location;
    }

    cache.set(cacheKey, location);
    return location;
  }

  private async processInitialStock(
    productId: number,
    quantity: number,
    storeId: number,
  ): Promise<void> {
    const defaultLocation =
      await this.locationsService.getDefaultLocation(storeId);
    if (!defaultLocation) return; // O lanzar error

    await this.stockLevelManager.updateStock({
      product_id: productId,
      location_id: defaultLocation.id,
      quantity_change: quantity,
      movement_type: 'initial',
      reason: 'Carga masiva inicial',
    });
  }

  private async processStockByLocation(
    productId: number,
    stockByLocation: any[],
    storeId: number,
  ): Promise<void> {
    // Implementación similar a la original
    const defaultLocation =
      await this.locationsService.getDefaultLocation(storeId);

    for (const stockData of stockByLocation) {
      const locationId = stockData.location_id || defaultLocation?.id;
      if (!locationId) continue;

      await this.stockLevelManager.updateStock({
        product_id: productId,
        location_id: locationId,
        quantity_change: stockData.quantity || 0,
        movement_type: 'initial',
        reason: stockData.notes || 'Carga masiva por ubicación',
      });
    }
  }
}
