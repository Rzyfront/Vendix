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
import * as XLSX from 'xlsx';

@Injectable()
export class ProductsBulkService {
  private readonly MAX_BATCH_SIZE = 1000;

  // Mapa de encabezados en Español a claves del DTO
  private readonly HEADER_MAP = {
    Nombre: 'name',
    SKU: 'sku',
    'Precio Venta': 'base_price',
    'Precio Base': 'base_price', // Aliased for compatibility
    'Precio Compra': 'cost_price',
    Costo: 'cost_price', // Aliased for compatibility
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
        'Precio Venta',
        'Precio Compra',
        'Cantidad Inicial',
      ];
      exampleData = [
        {
          Nombre: 'Camiseta Básica Blanca',
          SKU: 'CAM-BAS-BLA-001',
          'Precio Venta': 15000,
          'Precio Compra': 8000,
          'Cantidad Inicial': 50,
        },
      ];
    } else {
      headers = [
        'Nombre',
        'SKU',
        'Precio Venta',
        'Precio Compra',
        'Margen',
        'Cantidad Inicial',
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
        {
          Nombre: 'Zapatillas Running Pro',
          SKU: 'ZAP-RUN-PRO-42',
          'Precio Venta': 85000,
          'Precio Compra': 45000,
          Margen: 45,
          'Cantidad Inicial': 20,
          Descripción: 'Zapatillas ideales para correr largas distancias.',
          Marca: 'Nike',
          Categorías: 'Deportes, Calzado, Running',
          Estado: 'activo',
          'Disponible Ecommerce': 'Si',
          Peso: 0.8,
          'En Oferta': 'No',
          'Precio Oferta': 0,
        },
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

    for (const productData of products) {
      try {
        // Pre-procesar: Crear marcas y categorías si son strings
        await this.preprocessProductData(productData, storeId);

        // Validar datos
        await this.validateProductData(productData, storeId);

        let resultProduct;

        // Check for existing product by SKU
        const existingProduct = await this.prisma.products.findFirst({
          where: {
            store_id: storeId,
            sku: productData.sku,
            state: { not: 'archived' },
          },
        });

        // Wrap operations in a transaction for data integrity
        await this.prisma.$transaction(async (tx) => {
          if (existingProduct) {
            // Actualizar producto existente
            const updateProductDto = this.mapToUpdateProductDto(productData);
            resultProduct = await this.productsService.update(
              existingProduct.id,
              updateProductDto,
            );

            results.push({
              product: resultProduct,
              status: 'success',
              message: `Product with SKU ${productData.sku} updated successfully`,
            });
          } else {
            // Crear nuevo producto
            const createProductDto = this.mapToCreateProductDto(
              productData,
              storeId,
            );

            resultProduct = await this.productsService.create(createProductDto);
            const createdId = (resultProduct as any).id;

            // Variantes
            if (productData.variants && productData.variants.length > 0) {
              await this.processProductVariants(
                createdId as unknown as number,
                productData.variants,
              );
            }

            results.push({
              product: resultProduct,
              status: 'success',
              message: 'Product created successfully',
            });
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
    const existing = await this.prisma.brands.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
      },
    });

    if (existing) return existing.id;

    // Crear marca
    const created = await this.prisma.brands.create({
      data: {
        name: name,
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
    const slug = generateSlug(name);

    // La categoría es única por store_id + slug
    const existing = await this.prisma.categories.findFirst({
      where: {
        store_id: storeId,
        slug: slug,
      },
    });

    if (existing) return existing.id;

    // Crear categoría
    const created = await this.prisma.categories.create({
      data: {
        name: name,
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

    for (const [index, product] of products.entries()) {
      if (!product.name || !product.sku || product.base_price === undefined) {
        errors.push(
          `Fila ${index + 1}: Faltan datos obligatorios (Nombre, SKU o Precio)`,
        );
        continue;
      }
      validProducts.push(product);
    }

    return {
      isValid: errors.length === 0,
      errors,
      validProducts,
    };
  }

  async getBulkUploadTemplate(): Promise<BulkUploadTemplateDto> {
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

  private async processInitialStock(
    productId: number,
    quantity: number,
    storeId: number,
  ): Promise<void> {
    const defaultLocation =
      await this.locationsService.getDefaultLocation(storeId);
    if (!defaultLocation) return;

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
