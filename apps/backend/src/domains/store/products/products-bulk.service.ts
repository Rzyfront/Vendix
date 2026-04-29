import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
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
  BulkProductAnalysisResultDto,
  BulkProductAnalysisItemDto,
} from './dto';
import { generateSlug } from '@common/utils/slug.util';
import { toTitleCase } from '@common/utils/format.util';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductsBulkService {
  private readonly logger = new Logger(ProductsBulkService.name);
  private readonly MAX_BATCH_SIZE = 1000;
  private readonly NULL_MARKER = '__NULL__';

  // Mapa de encabezados en Español a claves del DTO
  private readonly HEADER_MAP = {
    Nombre: 'name',
    SKU: 'sku',
    'Precio Venta': 'base_price',
    'Precio Compra': 'cost_price',
    Margen: 'profit_margin',
    'Cantidad Inicial': 'stock_quantity',
    'Controla Inventario': 'track_inventory',
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
    'Duración Servicio (min)': 'service_duration_minutes',
    'Modalidad Servicio': 'service_modality',
    'Tipo Precio Servicio': 'service_pricing_type',
    'Requiere Reserva': 'requires_booking',
    'Modo Reserva': 'booking_mode',
    'Buffer (min)': 'buffer_minutes',
    'Es Recurrente': 'is_recurring',
    'Instrucciones Servicio': 'service_instructions',
    'Tiempo Preparación (min)': 'preparation_time_minutes',
    'Stock Mínimo': 'min_stock_level',
    'Stock Máximo': 'max_stock_level',
    'Punto Reorden': 'reorder_point',
    'Cantidad Reorden': 'reorder_quantity',
    'Maneja Series': 'requires_serial_numbers',
    'Maneja Lotes': 'requires_batch_tracking',
    'Tipo Precio': 'pricing_type',
  };

  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    nombre: 'name',
    sku: 'sku',
    'precio base': 'base_price',
    'precio venta': 'base_price',
    costo: 'cost_price',
    'precio compra': 'cost_price',
    margen: 'profit_margin',
    'cantidad inicial': 'stock_quantity',
    'controla inventario': 'track_inventory',
    'controla stock': 'track_inventory',
    'track inventory': 'track_inventory',
    descripción: 'description',
    descripcion: 'description',
    categorías: 'category_ids',
    categorias: 'category_ids',
    marca: 'brand_id',
    'en oferta': 'is_on_sale',
    'precio oferta': 'sale_price',
    peso: 'weight',
    'disponible ecommerce': 'available_for_ecommerce',
    estado: 'state',
    'codigo bodega': 'warehouse_code',
    'código bodega': 'warehouse_code',
    'nombre bodega': 'warehouse_name',
    tipo: 'product_type',
    type: 'product_type',
    'tipo producto': 'product_type',
    'product type': 'product_type',
    'duracion servicio': 'service_duration_minutes',
    'duracion servicio (min)': 'service_duration_minutes',
    duracion: 'service_duration_minutes',
    'modalidad servicio': 'service_modality',
    modalidad: 'service_modality',
    'tipo precio servicio': 'service_pricing_type',
    'requiere reserva': 'requires_booking',
    'modo reserva': 'booking_mode',
    buffer: 'buffer_minutes',
    'buffer (min)': 'buffer_minutes',
    'es recurrente': 'is_recurring',
    recurrente: 'is_recurring',
    'instrucciones servicio': 'service_instructions',
    instrucciones: 'service_instructions',
    'tiempo preparacion': 'preparation_time_minutes',
    'tiempo preparacion (min)': 'preparation_time_minutes',
    preparacion: 'preparation_time_minutes',
    'stock minimo': 'min_stock_level',
    'stock mínimo': 'min_stock_level',
    minimo: 'min_stock_level',
    'stock maximo': 'max_stock_level',
    'stock máximo': 'max_stock_level',
    maximo: 'max_stock_level',
    'punto reorden': 'reorder_point',
    reorden: 'reorder_point',
    'cantidad reorden': 'reorder_quantity',
    'maneja series': 'requires_serial_numbers',
    series: 'requires_serial_numbers',
    'maneja lotes': 'requires_batch_tracking',
    lotes: 'requires_batch_tracking',
    'tipo precio': 'pricing_type',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly variantService: ProductVariantService,
    private readonly accessValidationService: AccessValidationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly locationsService: LocationsService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Parsea archivo (Excel o CSV) a array de productos usando mapeo de español
   */
  parseFile(buffer: Buffer): any[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convertir a JSON array de arrays (header: 1) para inspeccionar encabezados
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        throw new BadRequestException(
          'El archivo debe contener al menos una fila de encabezados y una fila de datos',
        );
      }

      // Procesar encabezados
      const rawHeaders = jsonData[0] as string[];
      const headerMap: Record<number, string> = {};

      rawHeaders.forEach((h, index) => {
        if (!h) return;
        const normalized = h.toString().trim().toLowerCase();
        // Buscar traducción
        const dtoKey = this.HEADER_TRANSLATIONS[normalized];
        if (dtoKey) {
          headerMap[index] = dtoKey;
        }
      });

      const products: any[] = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const product: Record<string, any> = {};
        let hasData = false;

        row.forEach((cellValue, index) => {
          const key = headerMap[index];
          if (key) {
            const raw =
              cellValue === undefined || cellValue === null ? '' : cellValue;
            const val =
              typeof raw === 'string' ? raw.trim() : raw;

            if (
              val === '' ||
              val === null ||
              val === undefined
            ) {
              return;
            }

            const strVal =
              typeof val === 'string' ? val : String(val);

            if (
              strVal.toUpperCase() === 'NULL' ||
              strVal === '-' ||
              strVal === '--'
            ) {
              product[key] = this.NULL_MARKER;
              hasData = true;
              return;
            }

            if (
              [
                'base_price',
                'cost_price',
                'stock_quantity',
                'weight',
                'sale_price',
                'profit_margin',
                'service_duration_minutes',
                'buffer_minutes',
                'preparation_time_minutes',
                'min_stock_level',
                'max_stock_level',
                'reorder_point',
                'reorder_quantity',
              ].includes(key)
            ) {
              const num = parseFloat(strVal);
              if (!isNaN(num)) {
                product[key] = num;
                hasData = true;
              }
              return;
            }

            if (['brand_id'].includes(key)) {
              const trimmed = strVal.trim();
              const num = parseInt(trimmed, 10);
              if (!isNaN(num)) {
                product[key] = num;
                hasData = true;
              } else {
                product[key] = trimmed;
                hasData = true;
              }
              return;
            }

            product[key] = val;
            hasData = true;
          }
        });

        if (hasData && (product['name'] || product['sku'])) {
          products.push(product);
        }
      }

      return products;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Error al procesar el archivo: ' + error.message,
      );
    }
  }

  /**
   * Analiza un archivo Excel/CSV sin procesar los productos.
   * Retorna un análisis detallado por producto con status ready/warning/error.
   * Almacena el archivo en S3 temporal para posterior procesamiento.
   */
  async analyzeProducts(
    fileBuffer: Buffer,
    storeId: number,
  ): Promise<BulkProductAnalysisResultDto> {
    // 1. Parse file
    let products: any[];
    try {
      products = this.parseFile(fileBuffer);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_FILE_INVALID);
    }

    if (!products || products.length === 0) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_EMPTY_FILE);
    }

    if (products.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_LIMIT_EXCEEDED);
    }

    // 2. Pre-fetch existing products by SKU for this store
    const existingProducts = await this.prisma.products.findMany({
      where: { store_id: storeId, state: { not: 'archived' } },
      select: { id: true, sku: true, name: true },
    });
    const skuMap = new Map<string, { id: number; name: string }>();
    for (const p of existingProducts) {
      if (p.sku) skuMap.set(p.sku.toLowerCase(), { id: p.id, name: p.name });
    }

    // 3. Pre-fetch existing brands
    const existingBrands = await this.prisma.brands.findMany({
      select: { id: true, name: true },
    });
    const brandMap = new Map<string, number>();
    for (const b of existingBrands) {
      brandMap.set(b.name.toLowerCase(), b.id);
    }

    // 4. Pre-fetch existing categories for this store
    const existingCategories = await this.prisma.categories.findMany({
      where: { store_id: storeId },
      select: { id: true, name: true, slug: true },
    });
    const categoryMap = new Map<string, number>();
    for (const c of existingCategories) {
      categoryMap.set(c.name.toLowerCase(), c.id);
      categoryMap.set(c.slug, c.id);
    }

    // 5. Track duplicate SKUs in batch
    const seenSkus = new Map<string, number>(); // sku -> first row number

    // 6. Analyze each product
    const analysisItems: BulkProductAnalysisItemDto[] = [];
    let ready = 0;
    let withWarnings = 0;
    let withErrors = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const item: BulkProductAnalysisItemDto = {
        row_number: i + 2, // +2 because row 1 is header, data starts at row 2
        name: product.name || '',
        sku: product.sku || '',
        product_type: 'physical',
        base_price: parseFloat(product.base_price) || 0,
        cost_price: parseFloat(product.cost_price) || 0,
        stock_quantity: parseFloat(product.stock_quantity) || 0,
        track_inventory: undefined,
        brand_name: undefined,
        brand_will_create: false,
        category_names: [],
        categories_will_create: [],
        warehouse_code: product.warehouse_code || undefined,
        warehouse_name: product.warehouse_name || undefined,
        action: 'create',
        existing_product_id: undefined,
        status: 'ready',
        warnings: [],
        errors: [],
      };

      // Determine product type
      if (product.product_type) {
        const t = product.product_type.toString().toLowerCase().trim();
        if (t === 'servicio' || t === 'service') {
          item.product_type = 'service';
        }
      }

      // Resolve track_inventory: explicit > default-by-type
      if (
        product.track_inventory !== undefined &&
        product.track_inventory !== null &&
        product.track_inventory !== ''
      ) {
        if (typeof product.track_inventory === 'boolean') {
          item.track_inventory = product.track_inventory;
        } else {
          const raw = product.track_inventory.toString().toLowerCase().trim();
          item.track_inventory =
            raw === 'si' ||
            raw === 'sí' ||
            raw === 'yes' ||
            raw === 'true' ||
            raw === 'verdadero' ||
            raw === '1';
        }
      } else {
        // Default: services=false, physical=true
        item.track_inventory = item.product_type === 'service' ? false : true;
      }

      // Service always false
      if (item.product_type === 'service') {
        item.track_inventory = false;
      }

      // Validate required fields
      if (!item.name) {
        item.errors.push({
          code: 'MISSING_NAME',
          message: 'Nombre es requerido',
          field: 'name',
        });
      }
      if (!item.sku) {
        item.errors.push({
          code: 'MISSING_SKU',
          message: 'SKU es requerido',
          field: 'sku',
        });
      }
      if (item.base_price < 0) {
        item.errors.push({
          code: 'INVALID_PRICE',
          message: 'Precio de venta no puede ser negativo',
          field: 'base_price',
        });
      }

      // Check margin -> price calculation
      let margin = parseFloat(product.profit_margin) || 0;
      if (margin > 0 && margin < 1) margin = margin * 100;
      if (margin > 0 && item.cost_price > 0) {
        item.base_price = item.cost_price * (1 + margin / 100);
      }

      // Check for no price at all
      if (item.base_price === 0 && item.cost_price === 0 && margin === 0) {
        item.warnings.push({
          code: 'NO_PRICE_SPECIFIED',
          message: 'No se especificó precio de venta ni costo con margen',
          field: 'base_price',
        });
      }

      // Check duplicate SKU in batch
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        if (seenSkus.has(skuLower)) {
          item.warnings.push({
            code: 'DUPLICATE_SKU_IN_BATCH',
            message: `SKU duplicado en el archivo (primera aparición en fila ${seenSkus.get(skuLower)})`,
            field: 'sku',
          });
        } else {
          seenSkus.set(skuLower, item.row_number);
        }

        // Check if SKU exists in store
        const existing = skuMap.get(skuLower);
        if (existing) {
          item.action = 'update';
          item.existing_product_id = existing.id;
        }
      }

      // Resolve brand (dry-run - no creation)
      if (product.brand_id) {
        const brandVal = product.brand_id.toString().trim();
        if (/^\d+$/.test(brandVal)) {
          // Numeric ID - check if exists
          const brandId = parseInt(brandVal, 10);
          const found = existingBrands.find((b) => b.id === brandId);
          if (found) {
            item.brand_name = found.name;
          } else {
            item.warnings.push({
              code: 'BRAND_ID_NOT_FOUND',
              message: `Marca con ID ${brandId} no encontrada, se ignorará`,
              field: 'brand_id',
            });
          }
        } else if (brandVal) {
          item.brand_name = brandVal;
          const exists = brandMap.has(brandVal.toLowerCase());
          if (!exists) {
            item.brand_will_create = true;
            item.warnings.push({
              code: 'AUTO_CREATE_BRANDS',
              message: `Se creará la marca "${brandVal}" automáticamente`,
              field: 'brand_id',
            });
          }
        }
      }

      // Resolve categories (dry-run - no creation)
      if (product.category_ids) {
        let rawCategories: string[] = [];
        if (typeof product.category_ids === 'string') {
          rawCategories = product.category_ids
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean);
        } else if (Array.isArray(product.category_ids)) {
          rawCategories = product.category_ids
            .map((c: any) => c.toString().trim())
            .filter(Boolean);
        }

        const catNames: string[] = [];
        const catsToCreate: string[] = [];

        for (const cat of rawCategories) {
          if (/^\d+$/.test(cat)) {
            const catId = parseInt(cat, 10);
            const found = existingCategories.find((c) => c.id === catId);
            if (found) {
              catNames.push(found.name);
            } else {
              item.warnings.push({
                code: 'CATEGORY_ID_NOT_FOUND',
                message: `Categoría con ID ${catId} no encontrada, se ignorará`,
                field: 'category_ids',
              });
            }
          } else {
            catNames.push(cat);
            if (!categoryMap.has(cat.toLowerCase())) {
              catsToCreate.push(cat);
            }
          }
        }

        item.category_names = catNames;
        item.categories_will_create = catsToCreate;
        if (catsToCreate.length > 0) {
          item.warnings.push({
            code: 'AUTO_CREATE_CATEGORIES',
            message: `Se crearán ${catsToCreate.length} categoría(s) automáticamente: ${catsToCreate.join(', ')}`,
            field: 'category_ids',
          });
        }
      }

      // Service with stock warning
      if (item.product_type === 'service' && item.stock_quantity > 0) {
        item.warnings.push({
          code: 'SERVICE_NO_STOCK',
          message: 'Los servicios no manejan stock. Se ignorará la cantidad.',
          field: 'stock_quantity',
        });
      }

      // Cross-field validations (only when BOTH fields are explicitly present)
      if (
        item.product_type === 'service' &&
        item.action === 'create' &&
        product.service_duration_minutes === undefined
      ) {
        item.warnings.push({
          code: 'SERVICE_NO_DURATION',
          message:
            'Los productos de servicio deberían tener duración definida.',
          field: 'service_duration_minutes',
        });
      }

      if (
        item.product_type === 'service' &&
        item.action === 'create' &&
        product.service_pricing_type === undefined
      ) {
        item.warnings.push({
          code: 'SERVICE_NO_PRICING_TYPE',
          message:
            'Los productos de servicio deberían tener tipo de precio definido.',
          field: 'service_pricing_type',
        });
      }

      if (
        product.requires_booking !== undefined &&
        product.service_modality === undefined
      ) {
        item.warnings.push({
          code: 'BOOKING_NO_MODALITY',
          message:
            'Si requiere reserva, se recomienda definir modalidad.',
          field: 'service_modality',
        });
      }

      if (
        product.min_stock_level !== undefined &&
        product.max_stock_level !== undefined &&
        Number(product.min_stock_level) > Number(product.max_stock_level)
      ) {
        item.warnings.push({
          code: 'MIN_GT_MAX_STOCK',
          message: 'Stock mínimo no puede ser mayor que stock máximo.',
          field: 'min_stock_level',
        });
      }

      if (
        product.reorder_point !== undefined &&
        product.max_stock_level !== undefined &&
        Number(product.reorder_point) > Number(product.max_stock_level)
      ) {
        item.warnings.push({
          code: 'REORDER_GT_MAX',
          message: 'Punto de reorden no puede ser mayor que stock máximo.',
          field: 'reorder_point',
        });
      }

      if (
        product.requires_batch_tracking !== undefined &&
        product.track_inventory !== undefined &&
        product.requires_batch_tracking === true &&
        product.track_inventory === false
      ) {
        item.warnings.push({
          code: 'BATCH_REQUIRES_INVENTORY',
          message:
            'Manejo de lotes requiere control de inventario activo.',
          field: 'requires_batch_tracking',
        });
      }

      // Deprecation warning for stock fields
      if (product.stock_quantity > 0 || product.cost_price > 0) {
        item.warnings.push({
          code: 'STOCK_FIELD_DEPRECATED',
          message:
            'El stock será ignorado en futuras versiones. Usa Inventario > POP > Carga masiva para ingresar mercancía con costo y respaldo contable.',
          field:
            product.stock_quantity > 0 ? 'stock_quantity' : 'cost_price',
        });
      }

      // Compute modified vs nulled fields for sparse update preview
      const modifiedFields: string[] = [];
      const nulledFields: string[] = [];

      const FIELDS_TO_TRACK = [
        'name',
        'sku',
        'description',
        'base_price',
        'cost_price',
        'profit_margin',
        'stock_quantity',
        'state',
        'product_type',
        'track_inventory',
        'available_for_ecommerce',
        'is_on_sale',
        'sale_price',
        'weight',
        'brand_id',
        'category_ids',
        'pricing_type',
        'service_duration_minutes',
        'service_modality',
        'service_pricing_type',
        'requires_booking',
        'booking_mode',
        'buffer_minutes',
        'is_recurring',
        'service_instructions',
        'preparation_time_minutes',
        'min_stock_level',
        'max_stock_level',
        'reorder_point',
        'reorder_quantity',
        'requires_serial_numbers',
        'requires_batch_tracking',
      ];

      for (const field of FIELDS_TO_TRACK) {
        const value = (product as any)[field];
        if (value === undefined) continue; // sparse: not provided → don't touch
        if (value === this.NULL_MARKER) {
          nulledFields.push(field);
        } else {
          modifiedFields.push(field);
        }
      }

      item.modified_fields = modifiedFields;
      item.nulled_fields = nulledFields;

      // Determine final status
      if (item.errors.length > 0) {
        item.status = 'error';
        withErrors++;
      } else if (item.warnings.length > 0) {
        item.status = 'warning';
        withWarnings++;
      } else {
        item.status = 'ready';
        ready++;
      }

      analysisItems.push(item);
    }

    // 7. Store file in S3 temp
    const sessionId = uuidv4();
    const s3Key = `tmp/bulk-products/${storeId}/${sessionId}.xlsx`;
    await this.s3Service.uploadFile(
      fileBuffer,
      s3Key,
      'application/octet-stream',
    );

    // 8. Return analysis result
    return {
      session_id: sessionId,
      total_products: products.length,
      ready,
      with_warnings: withWarnings,
      with_errors: withErrors,
      products: analysisItems,
    };
  }

  /**
   * Procesa la carga masiva desde una sesión de análisis previa.
   * Descarga el archivo temporal de S3, lo procesa y limpia.
   */
  async uploadProductsFromSession(
    sessionId: string,
    storeId: number,
    user: any,
  ): Promise<BulkUploadResultDto> {
    const s3Key = `tmp/bulk-products/${storeId}/${sessionId}.xlsx`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.s3Service.downloadImage(s3Key);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }

    try {
      const products = this.parseFile(fileBuffer);
      const result = await this.uploadProducts({ products }, user);
      return result;
    } finally {
      // Clean up temp file
      try {
        await this.s3Service.deleteFile(s3Key);
      } catch (e) {
        // Silent cleanup failure
      }
    }
  }

  /**
   * Cancela una sesión de análisis y limpia el archivo temporal.
   */
  async cancelSession(sessionId: string, storeId: number): Promise<void> {
    const s3Key = `tmp/bulk-products/${storeId}/${sessionId}.xlsx`;
    try {
      await this.s3Service.deleteFile(s3Key);
    } catch (e) {
      // File may not exist, silently ignore
    }
  }

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
        'Estado',
        'Controla Inventario',
        'Precio Venta',
        'Precio Compra',
      ];
      exampleData = [
        {
          Nombre: 'Producto Ejemplo 1',
          SKU: 'SKU-001',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 15000,
          'Precio Compra': 8000,
        },
        {
          Nombre: 'Producto Ejemplo 2',
          SKU: 'SKU-002',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 25000,
          'Precio Compra': 12000,
        },
        {
          Nombre: 'Producto Ejemplo 3',
          SKU: 'SKU-003',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 42000,
          'Precio Compra': 19000,
        },
        {
          Nombre: 'Producto Ejemplo 4',
          SKU: 'SKU-004',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 85000,
          'Precio Compra': 45000,
        },
        {
          Nombre: 'Producto Ejemplo 5',
          SKU: 'SKU-005',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 32000,
          'Precio Compra': 18000,
        },
        {
          Nombre: 'Producto Ejemplo 6',
          SKU: 'SKU-006',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 55000,
          'Precio Compra': 27000,
        },
        {
          Nombre: 'Producto Ejemplo 7',
          SKU: 'SKU-007',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 18000,
          'Precio Compra': 9000,
        },
        {
          Nombre: 'Servicio Ejemplo 1',
          SKU: 'SVC-001',
          Tipo: 'servicio',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 50000,
          'Precio Compra': 0,
        },
        {
          Nombre: 'Servicio Ejemplo 2',
          SKU: 'SVC-002',
          Tipo: 'servicio',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 35000,
          'Precio Compra': 0,
        },
        {
          Nombre: 'Producto Ejemplo 8',
          SKU: 'SKU-008',
          Tipo: 'físico',
          Estado: 'inactivo',
          'Controla Inventario': 'sí',
          'Precio Venta': 18000,
          'Precio Compra': 9000,
        },
      ];
    } else {
      headers = [
        'Nombre',
        'SKU',
        'Tipo',
        'Estado',
        'Controla Inventario',
        'Precio Venta',
        'Precio Compra',
        'Margen',
        'Descripción',
        'Marca',
        'Categorías',
        'Tipo Precio',
        'Disponible Ecommerce',
        'Peso',
        'En Oferta',
        'Precio Oferta',
        'Duración Servicio (min)',
        'Modalidad Servicio',
        'Tipo Precio Servicio',
        'Requiere Reserva',
        'Modo Reserva',
        'Buffer (min)',
        'Es Recurrente',
        'Instrucciones Servicio',
        'Tiempo Preparación (min)',
        'Stock Mínimo',
        'Stock Máximo',
        'Punto Reorden',
        'Cantidad Reorden',
        'Maneja Series',
        'Maneja Lotes',
      ];
      exampleData = [
        {
          Nombre: 'Zapatillas Running Pro',
          SKU: 'ZAP-RUN-PRO-42',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 85000,
          'Precio Compra': 45000,
          Margen: 45,
          Descripción: 'Zapatillas ideales para correr largas distancias.',
          Marca: 'Nike',
          Categorías: 'Deportes, Calzado',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'sí',
          Peso: 0.8,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': 10,
          'Stock Máximo': 200,
          'Punto Reorden': 20,
          'Cantidad Reorden': 50,
          'Maneja Series': 'no',
          'Maneja Lotes': 'no',
        },
        {
          Nombre: 'Asesoría Tributaria',
          SKU: 'SVC-ASE-TRI-001',
          Tipo: 'servicio',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 150000,
          'Precio Compra': 60000,
          Margen: 60,
          Descripción: 'Asesoría tributaria profesional por sesión.',
          Marca: '',
          Categorías: 'Servicios, Contabilidad',
          'Tipo Precio': '',
          'Disponible Ecommerce': 'sí',
          Peso: 0,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': 60,
          'Modalidad Servicio': 'presencial',
          'Tipo Precio Servicio': 'por hora',
          'Requiere Reserva': 'sí',
          'Modo Reserva': 'proveedor',
          'Buffer (min)': 15,
          'Es Recurrente': 'no',
          'Instrucciones Servicio': 'Traer cédula y comprobante de pago.',
          'Tiempo Preparación (min)': 15,
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': '',
          'Maneja Lotes': '',
        },
        {
          Nombre: 'Leche Entera 1L',
          SKU: 'LEC-ENT-1L-COL',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 5200,
          'Precio Compra': 3800,
          Margen: 37,
          Descripción: 'Leche entera pasteurizada de origen colombiano.',
          Marca: 'Colanta',
          Categorías: 'Alimentos, Lácteos',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'no',
          Peso: 1.05,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': 50,
          'Stock Máximo': 500,
          'Punto Reorden': 100,
          'Cantidad Reorden': 200,
          'Maneja Series': 'no',
          'Maneja Lotes': 'sí',
        },
        {
          Nombre: 'Camiseta Dry-Fit Running',
          SKU: 'CAM-DRY-RUN-M01',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 65000,
          'Precio Compra': 32000,
          Margen: 50,
          Descripción: 'Camiseta deportiva transpirable para hombre.',
          Marca: 'Adidas',
          Categorías: 'Deportes, Ropa Deportiva',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'sí',
          Peso: 0.15,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': 'no',
          'Maneja Lotes': 'no',
        },
        {
          Nombre: 'Consultoría Estratégica Virtual',
          SKU: 'SVC-CON-EST-001',
          Tipo: 'servicio',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 250000,
          'Precio Compra': 100000,
          Margen: 150,
          Descripción: 'Consultoría estratégica virtual por sesión de 90 minutos.',
          Marca: '',
          Categorías: 'Servicios, Consultoría',
          'Tipo Precio': '',
          'Disponible Ecommerce': 'sí',
          Peso: 0,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': 90,
          'Modalidad Servicio': 'virtual',
          'Tipo Precio Servicio': 'por sesión',
          'Requiere Reserva': 'sí',
          'Modo Reserva': 'libre',
          'Buffer (min)': 10,
          'Es Recurrente': 'no',
          'Instrucciones Servicio': 'Conexión por Zoom 5 minutos antes de la sesión.',
          'Tiempo Preparación (min)': 10,
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': '',
          'Maneja Lotes': '',
        },
        {
          Nombre: 'Escritorio Plegable Madera',
          SKU: 'ESC-PLE-MAD-120',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 180000,
          'Precio Compra': 95000,
          Margen: 47,
          Descripción:
            'Escritorio plegable de madera 120x60cm para home office.',
          Marca: 'Muebles Express',
          Categorías: 'Hogar, Muebles, Oficina',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'sí',
          Peso: 15,
          'En Oferta': 'sí',
          'Precio Oferta': 155000,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': 5,
          'Stock Máximo': 50,
          'Punto Reorden': 8,
          'Cantidad Reorden': 15,
          'Maneja Series': 'no',
          'Maneja Lotes': 'no',
        },
        {
          Nombre: 'Aceite de Oliva Extra Virgen 500ml',
          SKU: 'ACE-OLI-EXV-500',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 38000,
          'Precio Compra': 24000,
          Margen: 58,
          Descripción: 'Aceite de oliva importado, primera prensada en frío.',
          Marca: 'Olivetto',
          Categorías: 'Alimentos, Aceites',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'sí',
          Peso: 0.55,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': 'no',
          'Maneja Lotes': 'sí',
        },
        {
          Nombre: 'Teclado Mecánico RGB',
          SKU: 'TEC-MEC-RGB-K70',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 320000,
          'Precio Compra': 180000,
          Margen: 78,
          Descripción:
            'Teclado mecánico con switches Cherry MX e iluminación RGB.',
          Marca: 'Corsair',
          Categorías: 'Tecnología, Periféricos',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'sí',
          Peso: 1.2,
          'En Oferta': 'sí',
          'Precio Oferta': 280000,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': 'sí',
          'Maneja Lotes': 'no',
        },
        {
          Nombre: 'Mantenimiento Preventivo Anual',
          SKU: 'SVC-MNT-PRE-001',
          Tipo: 'servicio',
          Estado: 'activo',
          'Controla Inventario': 'no',
          'Precio Venta': 480000,
          'Precio Compra': 200000,
          Margen: 71,
          Descripción: 'Plan de mantenimiento preventivo anual para equipos.',
          Marca: '',
          Categorías: 'Servicios, Mantenimiento',
          'Tipo Precio': '',
          'Disponible Ecommerce': 'sí',
          Peso: 0,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': 120,
          'Modalidad Servicio': 'híbrido',
          'Tipo Precio Servicio': 'suscripción',
          'Requiere Reserva': 'no',
          'Modo Reserva': '',
          'Buffer (min)': 0,
          'Es Recurrente': 'sí',
          'Instrucciones Servicio': 'Coordinar visita técnica con anticipación de 24 horas.',
          'Tiempo Preparación (min)': 30,
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': '',
          'Maneja Lotes': '',
        },
        {
          Nombre: 'Bloqueador Solar Facial SPF 60',
          SKU: 'BLO-SOL-FAC-060',
          Tipo: 'físico',
          Estado: 'inactivo',
          'Controla Inventario': 'sí',
          'Precio Venta': 48000,
          'Precio Compra': 28000,
          Margen: 71,
          Descripción: 'Protector solar facial oil-free con SPF 60.',
          Marca: 'La Roche-Posay',
          Categorías: 'Belleza, Cuidado Personal',
          'Tipo Precio': 'unidad',
          'Disponible Ecommerce': 'no',
          Peso: 0.1,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': 'no',
          'Maneja Lotes': 'sí',
        },
        {
          Nombre: 'Frutas Orgánicas Mix 1kg',
          SKU: 'FRU-ORG-MIX-1KG',
          Tipo: 'físico',
          Estado: 'activo',
          'Controla Inventario': 'sí',
          'Precio Venta': 22000,
          'Precio Compra': 9000,
          Margen: 59,
          Descripción: 'Mix de frutas orgánicas de temporada por kilo.',
          Marca: '',
          Categorías: 'Alimentos, Orgánicos',
          'Tipo Precio': 'peso',
          'Disponible Ecommerce': 'sí',
          Peso: 1.0,
          'En Oferta': 'no',
          'Precio Oferta': 0,
          'Duración Servicio (min)': '',
          'Modalidad Servicio': '',
          'Tipo Precio Servicio': '',
          'Requiere Reserva': '',
          'Modo Reserva': '',
          'Buffer (min)': '',
          'Es Recurrente': '',
          'Instrucciones Servicio': '',
          'Tiempo Preparación (min)': '',
          'Stock Mínimo': '',
          'Stock Máximo': '',
          'Punto Reorden': '',
          'Cantidad Reorden': '',
          'Maneja Series': 'no',
          'Maneja Lotes': 'no',
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

    // Cache de bodegas para evitar N+1 queries
    const locationCache = new Map<string, any>();

    for (let rowIndex = 0; rowIndex < products.length; rowIndex++) {
      const productData = products[rowIndex];
      const rowNumber = rowIndex + 2; // header = fila 1
      try {
        if ((productData.stock_quantity ?? 0) > 0 || (productData.cost_price ?? 0) > 0) {
          this.logger.warn('PRODUCT_BULK_DEPRECATED_STOCK_FIELD', {
            storeId,
            sku: productData.sku,
            stock: productData.stock_quantity,
            cost: productData.cost_price,
          });
        }

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

        if (existingProduct) {
          // Actualizar producto existente (sparse update: solo campos presentes)
          const updateProductDto = this.mapToUpdateProductDto(productData);
          resultProduct = await this.productsService.update(
            existingProduct.id,
            updateProductDto,
          );

          // Asignar stock a bodega si hay cantidad, bodega resuelta y controla inventario
          const isPhysical =
            (productData.product_type || 'physical') !== 'service';
          const hasExplicitStock =
            productData.stock_quantity !== undefined &&
            String(productData.stock_quantity) !== this.NULL_MARKER;
          const stockQty =
            hasExplicitStock && !isNaN(Number(productData.stock_quantity))
              ? Number(productData.stock_quantity)
              : 0;
          if (
            isPhysical &&
            hasExplicitStock &&
            (productData.track_inventory ?? true) &&
            stockQty > 0
          ) {
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
                source_module: 'product_bulk_legacy',
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
          let createdId: number | null = null;
          try {
            resultProduct = await this.productsService.create(createProductDto);
            createdId = resultProduct.id;

            // Variantes
            if (productData.variants && productData.variants.length > 0) {
              await this.processProductVariants(
                createdId as unknown as number,
                productData.variants,
              );
            }

            // Asignar stock inicial a bodega
            const isPhysical =
              (productData.product_type || 'physical') !== 'service';
            const stockQty = productData.stock_quantity || 0;
            if (
              isPhysical &&
              (productData.track_inventory ?? true) &&
              stockQty > 0
            ) {
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
                  source_module: 'product_bulk_legacy',
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
                .catch((e) =>
                  this.logger.error(
                    `Cleanup failed for product ${createdId}`,
                    e?.stack || e,
                  ),
                );
            }
            throw createErr;
          }
        }

        successful++;
      } catch (error) {
        // Log con stack y contexto para diagnosticar errores silenciosos
        this.logger.error(
          `Bulk product row failed (row ${rowNumber}, sku=${productData?.sku || 'n/a'}): ${error?.message || error}`,
          error?.stack,
        );

        let userMessage = 'Error procesando el producto';
        let errorCode: string | undefined;

        // Map known errors to user-friendly messages
        if (error instanceof VendixHttpException) {
          userMessage = error.message || userMessage;
          errorCode = error.errorCode;
        } else if (error instanceof BadRequestException) {
          userMessage = error.message;
        } else if (error?.code === 'P2002') {
          const target = Array.isArray(error?.meta?.target)
            ? (error.meta.target as string[]).join(', ')
            : error?.meta?.target || 'desconocido';

          if (typeof target === 'string' && target.includes('slug')) {
            const generated = generateSlug(productData.name || '');
            userMessage = `El nombre genera un slug duplicado ("${generated}"). Otro producto en la tienda ya lo usa.`;
          } else if (typeof target === 'string' && target.includes('sku')) {
            userMessage = `SKU "${productData.sku}" ya existe en la tienda (posiblemente archivado).`;
          } else {
            userMessage = `Violación de unicidad en campo(s): ${target}`;
          }
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.code === 'P2003') {
          userMessage =
            'Referencia inválida (marca, categoría u otro campo relacionado)';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.code === 'P2025') {
          userMessage = 'Registro referenciado no encontrado';
          errorCode = 'BULK_PROD_REF_001';
        } else if (error?.errorCode === 'INV_FIND_001') {
          userMessage =
            'No se encontró ubicación de inventario para asignar stock';
          errorCode = 'INV_FIND_001';
        } else if (error?.errorCode === 'INV_CONTEXT_001') {
          userMessage = 'Contexto de tienda/organización inválido';
          errorCode = 'INV_CONTEXT_001';
        } else if (error instanceof Prisma.PrismaClientValidationError) {
          userMessage =
            'Uno de los valores proporcionados tiene un formato inválido. Verifique campos como marca, categoría o peso.';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.message?.includes('brand_id')) {
          userMessage = 'El valor de marca es inválido';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.message?.includes('Invalid value provided')) {
          userMessage =
            'Uno de los valores proporcionados tiene un formato inválido';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.message && typeof error.message === 'string') {
          // Fallback: mostrar el mensaje real (truncado) en vez del genérico
          userMessage =
            error.message.length > 200
              ? error.message.slice(0, 200) + '...'
              : error.message;
        }

        results.push({
          row_number: rowNumber,
          product_name: productData.name || undefined,
          sku: productData.sku || undefined,
          product: null,
          status: 'error',
          message: userMessage,
          error_code: errorCode,
        });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total_processed: products.length,
      successful,
      failed,
      skipped: 0,
      results,
    };
  }

  /**
   * Pre-procesa datos para convertir Nombres de Marca/Categoría a IDs
   * Crea las entidades si no existen.
   */
  private async preprocessProductData(product: any, storeId: number) {
    // Procesar Marca (Brand) — tolerante: si falla resolver/crear, el producto sube sin marca
    if (product.brand_id !== undefined && product.brand_id !== null) {
      if (typeof product.brand_id === 'string') {
        const brandName = product.brand_id.trim();
        if (!brandName) {
          delete product.brand_id;
        } else if (/^\d+$/.test(brandName)) {
          product.brand_id = parseInt(brandName, 10);
        } else {
          try {
            const brandId = await this.findOrCreateBrand(brandName, storeId);
            product.brand_id = brandId || undefined;
          } catch (err) {
            this.logger.warn(
              `Bulk: no se pudo resolver/crear marca "${brandName}" para store ${storeId}: ${err?.message}. Subiendo producto sin marca.`,
            );
            product.brand_id = undefined;
          }
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

    if (product.requires_booking !== undefined) {
      product.requires_booking = normalizeBool(product.requires_booking);
    }

    if (product.is_recurring !== undefined) {
      product.is_recurring = normalizeBool(product.is_recurring);
    }

    if (product.requires_serial_numbers !== undefined) {
      product.requires_serial_numbers = normalizeBool(
        product.requires_serial_numbers,
      );
    }

    if (product.requires_batch_tracking !== undefined) {
      product.requires_batch_tracking = normalizeBool(
        product.requires_batch_tracking,
      );
    }

    // Enum normalizations
    if (
      product.service_modality !== undefined &&
      typeof product.service_modality === 'string' &&
      product.service_modality !== this.NULL_MARKER
    ) {
      const v = product.service_modality.toLowerCase().trim();
      if (v === 'presencial' || v === 'in_person') {
        product.service_modality = 'in_person';
      } else if (v === 'virtual') {
        product.service_modality = 'virtual';
      } else if (v === 'hibrido' || v === 'híbrido' || v === 'hybrid') {
        product.service_modality = 'hybrid';
      }
    }

    if (
      product.service_pricing_type !== undefined &&
      typeof product.service_pricing_type === 'string' &&
      product.service_pricing_type !== this.NULL_MARKER
    ) {
      const v = product.service_pricing_type.toLowerCase().trim();
      if (v === 'por hora' || v === 'per_hour') {
        product.service_pricing_type = 'per_hour';
      } else if (v === 'por sesión' || v === 'por sesion' || v === 'per_session') {
        product.service_pricing_type = 'per_session';
      } else if (v === 'paquete' || v === 'package') {
        product.service_pricing_type = 'package';
      } else if (v === 'suscripción' || v === 'suscripcion' || v === 'subscription') {
        product.service_pricing_type = 'subscription';
      }
    }

    if (
      product.booking_mode !== undefined &&
      typeof product.booking_mode === 'string' &&
      product.booking_mode !== this.NULL_MARKER
    ) {
      const v = product.booking_mode.toLowerCase().trim();
      if (v === 'proveedor' || v === 'provider_required') {
        product.booking_mode = 'provider_required';
      } else if (v === 'libre' || v === 'free_booking') {
        product.booking_mode = 'free_booking';
      }
    }

    if (
      product.pricing_type !== undefined &&
      typeof product.pricing_type === 'string' &&
      product.pricing_type !== this.NULL_MARKER
    ) {
      const v = product.pricing_type.toLowerCase().trim();
      if (v === 'unidad' || v === 'unit') {
        product.pricing_type = 'unit';
      } else if (v === 'peso' || v === 'weight') {
        product.pricing_type = 'weight';
      }
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

    // Normalizar Controla Inventario (track_inventory)
    if (
      product.track_inventory !== undefined &&
      product.track_inventory !== null &&
      product.track_inventory !== ''
    ) {
      if (typeof product.track_inventory === 'string') {
        product.track_inventory = normalizeBool(product.track_inventory);
      } else {
        product.track_inventory = !!product.track_inventory;
      }
    }

    // Services never track inventory
    if (product.product_type === 'service') {
      product.track_inventory = false;
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
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return 0;

    const existing = await this.prisma.brands.findFirst({
      where: {
        store_id: storeId,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
    });

    if (existing) return existing.id;

    const titleCaseName = toTitleCase(name.trim());
    const created = await this.prisma.brands.create({
      data: {
        store_id: storeId,
        name: titleCaseName,
        slug: generateSlug(titleCaseName),
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

    // IDs de marca y categoría ya deberían ser numéricos aquí tras el pre-procesamiento.
    // Tolerante: si la marca no existe o no pertenece al store, se sube el producto sin marca.
    if (product.brand_id && typeof product.brand_id === 'number') {
      const exists = await this.prisma.brands.findFirst({
        where: { id: product.brand_id, store_id: storeId },
      });
      if (!exists) {
        this.logger.warn(
          `Bulk: marca id ${product.brand_id} no existe en store ${storeId}. Subiendo producto sin marca.`,
        );
        (product as any).brand_id = undefined;
      }
    }
  }

  private mapToCreateProductDto(
    product: BulkProductItemDto,
    storeId: number,
  ): any {
    const resolveValue = (val: any) =>
      val === this.NULL_MARKER ? null : val;

    const dto: any = {
      name: product.name,
      base_price: product.base_price,
      sku: product.sku,
      description: resolveValue(product.description),
      slug: product.slug || generateSlug(product.name),
      store_id: storeId,
      brand_id:
        product.brand_id && typeof product.brand_id === 'number'
          ? product.brand_id
          : product.brand_id === this.NULL_MARKER
            ? null
            : undefined,
      category_ids:
        product.category_ids === this.NULL_MARKER
          ? []
          : product.category_ids,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      weight:
        product.weight && typeof product.weight === 'number'
          ? product.weight
          : undefined,
      is_on_sale: product['is_on_sale'],
      sale_price: product['sale_price'],
      state: product.state,
      available_for_ecommerce: product.available_for_ecommerce,
      product_type: product.product_type || 'physical',
      track_inventory:
        product.product_type === 'service'
          ? false
          : (product.track_inventory ?? true),
    };

    const newCatalogFields = [
      'service_duration_minutes',
      'service_modality',
      'service_pricing_type',
      'requires_booking',
      'booking_mode',
      'buffer_minutes',
      'is_recurring',
      'service_instructions',
      'preparation_time_minutes',
      'min_stock_level',
      'max_stock_level',
      'reorder_point',
      'reorder_quantity',
      'requires_serial_numbers',
      'requires_batch_tracking',
      'pricing_type',
    ];

    for (const field of newCatalogFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    return dto;
  }

  private mapToUpdateProductDto(product: BulkProductItemDto): any {
    const resolveValue = (val: any) =>
      val === this.NULL_MARKER ? null : val;

    const dto: any = {};

    const simpleFields = [
      'name',
      'base_price',
      'sku',
      'cost_price',
      'profit_margin',
      'state',
    ];

    for (const field of simpleFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    if (product.description !== undefined) {
      dto.description = resolveValue(product.description);
    }

    if (
      product.brand_id !== undefined &&
      product.brand_id !== this.NULL_MARKER &&
      typeof product.brand_id === 'number'
    ) {
      dto.brand_id = product.brand_id;
    } else if (product.brand_id === this.NULL_MARKER) {
      dto.brand_id = null;
    }

    if (product.category_ids !== undefined) {
      if (product.category_ids === this.NULL_MARKER) {
        dto.category_ids = [];
      } else {
        dto.category_ids = product.category_ids;
      }
    }

    if (product.weight !== undefined) {
      dto.weight =
        typeof product.weight === 'number' ? product.weight : undefined;
    }

    if (product['is_on_sale'] !== undefined) {
      dto.is_on_sale = resolveValue(product['is_on_sale']);
    }

    if (product['sale_price'] !== undefined) {
      dto.sale_price = resolveValue(product['sale_price']);
    }

    if (product.available_for_ecommerce !== undefined) {
      dto.available_for_ecommerce = resolveValue(product.available_for_ecommerce);
    }

    if (product.product_type !== undefined) {
      dto.product_type = resolveValue(product.product_type);
    }

    if (product.track_inventory !== undefined) {
      dto.track_inventory = resolveValue(product.track_inventory);
    }

    const newCatalogFields = [
      'service_duration_minutes',
      'service_modality',
      'service_pricing_type',
      'requires_booking',
      'booking_mode',
      'buffer_minutes',
      'is_recurring',
      'service_instructions',
      'preparation_time_minutes',
      'min_stock_level',
      'max_stock_level',
      'reorder_point',
      'reorder_quantity',
      'requires_serial_numbers',
      'requires_batch_tracking',
      'pricing_type',
    ];

    for (const field of newCatalogFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    return dto;
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

    const cacheKey = code
      ? `code:${code.toLowerCase()}`
      : `name:${name!.toLowerCase()}`;

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
      source_module: 'product_bulk_legacy',
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
        source_module: 'product_bulk_legacy',
      });
    }
  }
}
