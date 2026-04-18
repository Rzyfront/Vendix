import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
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

  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    nombre: 'name',
    sku: 'sku',
    'precio base': 'base_price',
    'precio venta': 'base_price',
    costo: 'cost_price',
    'precio compra': 'cost_price',
    margen: 'profit_margin',
    'cantidad inicial': 'stock_quantity',
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
            // Normalizar valores vacíos
            const val =
              cellValue === undefined || cellValue === null ? '' : cellValue;

            // Si es numérico en DTO, intentar convertir
            if (
              [
                'base_price',
                'cost_price',
                'stock_quantity',
                'weight',
                'sale_price',
                'profit_margin',
              ].includes(key)
            ) {
              const num = parseFloat(val);
              product[key] = isNaN(num) ? 0 : num;
            } else if (['brand_id'].includes(key)) {
              // Enteros opcionales: vacío → null (no 0, no "")
              const strVal = val.toString().trim();
              if (strVal === '') {
                product[key] = null;
              } else {
                const num = parseInt(strVal, 10);
                product[key] = isNaN(num) ? val : num;
              }
            } else {
              product[key] = val;
            }

            if (val !== '') hasData = true;
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

      // Validate required fields
      if (!item.name) {
        item.errors.push('Nombre es requerido');
      }
      if (!item.sku) {
        item.errors.push('SKU es requerido');
      }
      if (item.base_price < 0) {
        item.errors.push('Precio de venta no puede ser negativo');
      }

      // Check margin -> price calculation
      let margin = parseFloat(product.profit_margin) || 0;
      if (margin > 0 && margin < 1) margin = margin * 100;
      if (margin > 0 && item.cost_price > 0) {
        item.base_price = item.cost_price * (1 + margin / 100);
      }

      // Check for no price at all
      if (item.base_price === 0 && item.cost_price === 0 && margin === 0) {
        item.warnings.push(
          'No se especificó precio de venta ni costo con margen',
        );
      }

      // Check duplicate SKU in batch
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        if (seenSkus.has(skuLower)) {
          item.warnings.push(
            `SKU duplicado en el archivo (primera aparición en fila ${seenSkus.get(skuLower)})`,
          );
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
            item.warnings.push(
              `Marca con ID ${brandId} no encontrada, se ignorará`,
            );
          }
        } else if (brandVal) {
          item.brand_name = brandVal;
          const exists = brandMap.has(brandVal.toLowerCase());
          if (!exists) {
            item.brand_will_create = true;
            item.warnings.push(
              `Se creará la marca "${brandVal}" automáticamente`,
            );
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
              item.warnings.push(
                `Categoría con ID ${catId} no encontrada, se ignorará`,
              );
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
          item.warnings.push(
            `Se crearán ${catsToCreate.length} categoría(s) automáticamente: ${catsToCreate.join(', ')}`,
          );
        }
      }

      // Service with stock warning
      if (item.product_type === 'service' && item.stock_quantity > 0) {
        item.warnings.push(
          'Los servicios no manejan stock. Se ignorará la cantidad.',
        );
      }

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

    for (let rowIndex = 0; rowIndex < products.length; rowIndex++) {
      const productData = products[rowIndex];
      const rowNumber = rowIndex + 2; // header = fila 1
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
          userMessage = 'Referencia inválida (marca, categoría u otro campo relacionado)';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error instanceof Prisma.PrismaClientValidationError) {
          userMessage = 'Uno de los valores proporcionados tiene un formato inválido. Verifique campos como marca, categoría o peso.';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.message?.includes('brand_id')) {
          userMessage = 'El valor de marca es inválido';
          errorCode = 'BULK_PROD_VALIDATE_001';
        } else if (error?.message?.includes('Invalid value provided')) {
          userMessage = 'Uno de los valores proporcionados tiene un formato inválido';
          errorCode = 'BULK_PROD_VALIDATE_001';
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
    // Procesar Marca (Brand)
    if (product.brand_id !== undefined && product.brand_id !== null) {
      if (typeof product.brand_id === 'string') {
        const brandName = product.brand_id.trim();
        if (!brandName) {
          delete product.brand_id;
        } else if (/^\d+$/.test(brandName)) {
          product.brand_id = parseInt(brandName, 10);
        } else {
          const brandId = await this.findOrCreateBrand(brandName, storeId);
          product.brand_id = brandId;
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
      brand_id: product.brand_id && typeof product.brand_id === 'number' ? product.brand_id : undefined,
      category_ids: product.category_ids,
      stock_quantity: product.stock_quantity,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      weight: product.weight && typeof product.weight === 'number' ? product.weight : undefined,
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
      brand_id: product.brand_id && typeof product.brand_id === 'number' ? product.brand_id : undefined,
      category_ids: product.category_ids,
      stock_quantity: product.stock_quantity,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      weight: product.weight && typeof product.weight === 'number' ? product.weight : undefined,
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
