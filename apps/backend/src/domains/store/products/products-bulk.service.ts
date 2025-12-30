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
  ProductState,
} from './dto';
import { generateSlug } from '@common/utils/slug.util';

@Injectable()
export class ProductsBulkService {
  private readonly MAX_BATCH_SIZE = 100;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly variantService: ProductVariantService,
    private readonly accessValidationService: AccessValidationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly locationsService: LocationsService,
  ) { }

  /**
   * Procesa la carga masiva de productos
   */
  async uploadProducts(
    bulkUploadDto: BulkProductUploadDto,
    user: any,
  ): Promise<BulkUploadResultDto> {
    const { products } = bulkUploadDto;

    // Validar tamaño del lote
    if (products.length > this.MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} productos`,
      );
    }

    // Validar acceso a la tienda
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    await this.accessValidationService.validateStoreAccess(storeId, user);

    const results: BulkUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    // Procesar cada producto individualmente
    for (const productData of products) {
      try {
        // Validar datos del producto
        await this.validateProductData(productData, storeId);

        // Crear el producto usando el servicio existente
        const createProductDto = this.mapToCreateProductDto(
          productData,
          storeId,
        );
        const createdProduct =
          await this.productsService.create(createProductDto);

        // Procesar variantes si existen
        if (productData.variants && productData.variants.length > 0) {
          await this.processProductVariants(
            (createdProduct as any).id,
            productData.variants,
          );
        }

        // Procesar stock por ubicación si existe
        if (
          productData.stock_by_location &&
          productData.stock_by_location.length > 0
        ) {
          await this.processStockByLocation(
            (createdProduct as any).id,
            productData.stock_by_location,
          );
        }

        results.push({
          product: createdProduct,
          status: 'success',
          message: 'Product created successfully',
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
   * Valida productos antes del procesamiento masivo
   */
  async validateBulkProducts(
    products: BulkProductItemDto[],
    user: any,
  ): Promise<BulkValidationResultDto> {
    const errors: string[] = [];
    const validProducts: BulkProductItemDto[] = [];

    // Validar tamaño del lote
    if (products.length > this.MAX_BATCH_SIZE) {
      errors.push(
        `El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} productos`,
      );
      return { isValid: false, errors, validProducts };
    }

    // Validar acceso a la tienda
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      errors.push('No se pudo determinar la tienda actual');
      return { isValid: false, errors, validProducts };
    }

    try {
      await this.accessValidationService.validateStoreAccess(storeId, user);
    } catch (error) {
      errors.push(error.message);
      return { isValid: false, errors, validProducts };
    }

    // Verificar SKUs duplicados en el lote
    const skus = new Set<string>();
    const duplicateSkus = new Set<string>();

    for (const product of products) {
      if (skus.has(product.sku)) {
        duplicateSkus.add(product.sku);
      } else {
        skus.add(product.sku);
      }
    }

    if (duplicateSkus.size > 0) {
      errors.push(
        `Duplicate SKU found in batch: ${Array.from(duplicateSkus).join(', ')}`,
      );
    }

    // Validar cada producto individualmente
    for (const [index, product] of products.entries()) {
      try {
        // Skip if this SKU is a duplicate in the batch
        if (duplicateSkus.has(product.sku)) {
          // We don't add to validProducts, and we don't need to add another error message 
          // because we already added "Duplicate SKU found in batch" globally.
          // OR we can add a specific error for this row if desired, but user just wants it excluded from valid.
          continue;
        }

        await this.validateProductData(product, storeId);

        // Verificar si el SKU ya existe en la base de datos
        const existingProduct = await this.prisma.products.findFirst({
          where: {
            sku: product.sku,
          },
        });

        if (existingProduct) {
          errors.push(`SKU already exists: ${product.sku}`);
          continue;
        }

        validProducts.push(product);
      } catch (error) {
        errors.push(`Product ${index + 1}: ${error.message}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      validProducts,
    };
  }

  /**
   * Obtiene la plantilla para carga masiva
   */
  async getBulkUploadTemplate(): Promise<BulkUploadTemplateDto> {
    return {
      headers: [
        'name',
        'base_price',
        'sku',
        'description',
        'brand_id',
        'category_ids',
        'stock_quantity',
        'cost_price',
        'weight',
      ],
      sample_data: [
        {
          name: 'Sample Product',
          base_price: '99.99',
          sku: 'SAMPLE-001',
          description: 'Sample product description',
          brand_id: '1',
          category_ids: '1,2',
          stock_quantity: '10',
          cost_price: '75.00',
          weight: '0.5',
        },
      ],
      instructions:
        `Use this template to upload products in bulk.\n` +
        `- Required fields: name, base_price, sku\n` +
        `- category_ids: comma-separated category IDs\n` +
        `- stock_quantity: initial stock quantity\n` +
        `- brand_id: numeric brand ID\n` +
        `- cost_price: product cost price\n` +
        `- weight: product weight in kg`,
    };
  }

  /**
   * Valida los datos de un producto individual
   */
  private async validateProductData(
    product: BulkProductItemDto,
    storeId: number,
  ): Promise<void> {
    // Validar campos requeridos
    if (!product.name || product.name.trim() === '') {
      throw new BadRequestException('Product name is required');
    }

    if (product.base_price == null || product.base_price < 0) {
      throw new BadRequestException('Base price must be positive');
    }

    if (!product.sku || product.sku.trim() === '') {
      throw new BadRequestException('SKU is required');
    }

    // Validar brand_id si se proporciona
    if (product.brand_id) {
      const brand = await this.prisma.brands.findFirst({
        where: {
          id: product.brand_id,
          state: { not: 'archived' },
        },
      });

      if (!brand) {
        throw new BadRequestException(`Brand not found: ${product.brand_id}`);
      }
    }

    // Validar category_ids si se proporcionan
    if (product.category_ids && product.category_ids.length > 0) {
      for (const categoryId of product.category_ids) {
        const category = await this.prisma.categories.findFirst({
          where: {
            id: categoryId,
            state: { not: 'archived' },
          },
        });

        if (!category) {
          throw new BadRequestException(`Category not found: ${categoryId}`);
        }
      }
    }
  }

  /**
   * Mapea BulkProductItemDto a CreateProductDto
   */
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
      weight: product.weight,
    };
  }

  /**
   * Procesa las variantes de un producto
   */
  private async processProductVariants(
    productId: number,
    variants: any[],
  ): Promise<void> {
    for (const variantData of variants) {
      await this.productsService.createVariant(productId, variantData);
    }
  }

  /**
   * Procesa el stock por ubicación
   */
  private async processStockByLocation(
    productId: number,
    stockByLocation: any[],
  ): Promise<void> {
    // Obtener contexto para store_id
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    // Obtener ubicación por defecto si no se especifica
    const defaultLocation =
      await this.locationsService.getDefaultLocation(storeId);

    for (const stockData of stockByLocation) {
      const locationId = stockData.location_id || defaultLocation?.id;
      if (!locationId) {
        throw new BadRequestException(
          'No location specified and no default location found',
        );
      }

      await this.stockLevelManager.updateStock({
        product_id: productId,
        location_id: locationId,
        quantity_change: stockData.quantity || 0,
        movement_type: 'initial',
        reason: stockData.notes || 'Initial stock on bulk upload',
      });
    }
  }
}
