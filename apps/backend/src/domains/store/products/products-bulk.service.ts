import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import {
  BulkProductUploadDto,
  BulkProductItemDto,
  BulkUploadResultDto,
  BulkUploadSessionResultDto,
  MAX_BULK_UPLOAD_PAGE,
  BulkUploadItemResultDto,
  BulkValidationResultDto,
  BulkUploadTemplateDto,
  BulkProductAnalysisResultDto,
  BulkProductAnalysisItemDto,
  ProductState,
} from './dto';
import { generateSlug } from '@common/utils/slug.util';
import { toTitleCase } from '@common/utils/format.util';
import { Prisma } from '@prisma/client';
import { parseMoneyCell } from '@common/money-kernel';
import { buildReportBuffer } from '@common/reports/report-builder';
import type { ReportColumn } from '@common/reports/report-column.types';
import * as XLSX from 'xlsx';
import { Workbook } from 'exceljs';

type BulkExcelTemplateRequest = 'products' | 'services';

/** Fila del catálogo global de unidades, indexada por código para la carga. */
type UomCatalogEntry = {
  id: number;
  code: string;
  name: string;
  is_stock_eligible: boolean;
};

interface BarcodeOwner {
  kind: 'product' | 'variant' | 'presentation';
  product_id: number;
  product_name?: string;
  archived: boolean;
}

@Injectable()
export class ProductsBulkService {
  private readonly logger = new Logger(ProductsBulkService.name);
  private readonly MAX_BATCH_SIZE = 1000;
  private readonly MAX_BARCODE_LENGTH = 64;
  private readonly NULL_MARKER = '__NULL__';
  private readonly CATALOG_ONLY_IGNORED_FIELDS = new Set([
    'stock_quantity',
    'stock_by_location',
    'warehouse_code',
    'warehouse_name',
    'cost_price',
    'profit_margin',
    'min_stock_level',
    'max_stock_level',
    'reorder_point',
    'reorder_quantity',
    'requires_serial_numbers',
    'requires_batch_tracking',
  ]);

  // Campos monetarios: se parsean tolerando símbolos de moneda, separador de
  // miles y coma decimal (QUI-846). El resto de columnas numéricas conserva
  // `parseFloat` porque su formato no lleva símbolos de moneda.
  private readonly MONEY_CELL_FIELDS = new Set([
    'base_price',
    'cost_price',
    'sale_price',
  ]);

  private readonly NUMERIC_CELL_FIELDS = new Set([
    'stock_quantity',
    'weight',
    'profit_margin',
    'service_duration_minutes',
    'buffer_minutes',
    'preparation_time_minutes',
    'min_stock_level',
    'max_stock_level',
    'reorder_point',
    'reorder_quantity',
    'consultation_template_id',
    'preconsultation_template_id',
  ]);

  // Propiedad reservada que `parseFile` adjunta a la fila cuando una celda de
  // precio venía con texto (no vacía) y no se pudo interpretar como número.
  // `analyzeProducts` la convierte en error de fila; nunca se persiste.
  private readonly CELL_ERRORS_KEY = '__cell_errors';

  private readonly CATALOG_ONLY_IGNORED_FIELD_LABELS: Record<string, string> = {
    stock_quantity: 'Cantidad inicial',
    stock_by_location: 'Stock por ubicación',
    warehouse_code: 'Código de bodega',
    warehouse_name: 'Nombre de bodega',
    cost_price: 'Precio compra',
    profit_margin: 'Margen por costo',
    min_stock_level: 'Stock mínimo',
    max_stock_level: 'Stock máximo',
    reorder_point: 'Punto de reorden',
    reorder_quantity: 'Cantidad de reorden',
    requires_serial_numbers: 'Maneja series',
    requires_batch_tracking: 'Maneja lotes',
  };

  // Mapa de encabezados en Español a claves del DTO
  private readonly HEADER_MAP = {
    Nombre: 'name',
    SKU: 'sku',
    'Precio Venta': 'base_price',
    'Controla Inventario': 'track_inventory',
    Descripción: 'description',
    Categorías: 'category_ids',
    Marca: 'brand_id',
    Estado: 'state',
    'Disponible Ecommerce': 'available_for_ecommerce',
    Destacado: 'is_featured',
    'Permite Cambiar Precio POS': 'allow_pos_price_override',
    'Usa Listas de Precio': 'has_multiple_price_tiers',
    'En Oferta': 'is_on_sale',
    'Precio Oferta': 'sale_price',
    Peso: 'weight',
    Tipo: 'product_type',
    'Duración Servicio (min)': 'service_duration_minutes',
    'Modalidad Servicio': 'service_modality',
    'Tipo Precio Servicio': 'service_pricing_type',
    'Requiere Reserva': 'requires_booking',
    'Modo Reserva': 'booking_mode',
    'Buffer (min)': 'buffer_minutes',
    'Es Recurrente': 'is_recurring',
    'Instrucciones Servicio': 'service_instructions',
    'Es Consulta': 'is_consultation',
    'Enviar Preconsulta': 'send_preconsultation',
    'Plantilla Consulta ID': 'consultation_template_id',
    'Plantilla Preconsulta ID': 'preconsultation_template_id',
    'Tiempo Preparación (min)': 'preparation_time_minutes',
    'Tipo Precio': 'pricing_type',
    'Impuestos IDs': 'tax_category_ids',
    // Códigos del catálogo global de unidades (mm, m, g, kg, unit...).
    'Unidad de stock': 'stock_uom_code',
    'Unidad de compra': 'purchase_uom_code',
    'Precio por N unidades': 'price_unit_quantity',
    'Código de barras': 'barcode',
  };

  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    // Unidades (QUI-648): se aceptan las variantes que un comerciante escribe
    // a mano cuando reusa una plantilla vieja.
    'unidad de stock': 'stock_uom_code',
    'unidad stock': 'stock_uom_code',
    'unidad de inventario': 'stock_uom_code',
    'unidad de compra': 'purchase_uom_code',
    'unidad compra': 'purchase_uom_code',
    'precio por n unidades': 'price_unit_quantity',
    'precio por n': 'price_unit_quantity',
    'escala de precio': 'price_unit_quantity',
    // Código de barras: parseFile quita tildes antes de buscar, por eso las
    // claves van sin ellas.
    'codigo de barras': 'barcode',
    'codigo barras': 'barcode',
    barcode: 'barcode',
    ean: 'barcode',
    gtin: 'barcode',
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
    'disponible e-commerce': 'available_for_ecommerce',
    'available for ecommerce': 'available_for_ecommerce',
    ecommerce: 'available_for_ecommerce',
    destacado: 'is_featured',
    featured: 'is_featured',
    'is featured': 'is_featured',
    'permite cambiar precio pos': 'allow_pos_price_override',
    'permite cambio precio pos': 'allow_pos_price_override',
    'precio flexible pos': 'allow_pos_price_override',
    'allow pos price override': 'allow_pos_price_override',
    'usa listas de precio': 'has_multiple_price_tiers',
    'usa tarifas': 'has_multiple_price_tiers',
    'multiples listas de precio': 'has_multiple_price_tiers',
    'múltiples listas de precio': 'has_multiple_price_tiers',
    'has multiple price tiers': 'has_multiple_price_tiers',
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
    'es consulta': 'is_consultation',
    consulta: 'is_consultation',
    'is consultation': 'is_consultation',
    'enviar preconsulta': 'send_preconsultation',
    preconsulta: 'send_preconsultation',
    'send preconsultation': 'send_preconsultation',
    'plantilla consulta id': 'consultation_template_id',
    'consulta template id': 'consultation_template_id',
    'consultation template id': 'consultation_template_id',
    'plantilla preconsulta id': 'preconsultation_template_id',
    'preconsulta template id': 'preconsultation_template_id',
    'preconsultation template id': 'preconsultation_template_id',
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
    'impuestos ids': 'tax_category_ids',
    impuestos: 'tax_category_ids',
    'tax category ids': 'tax_category_ids',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly accessValidationService: AccessValidationService,
    private readonly s3Service: S3Service,
  ) {}

  private normalizeBooleanValue(value: any): boolean {
    if (typeof value === 'boolean') return value;

    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (
      ['si', 'yes', 'true', 'verdadero', '1', 'activo', 'active', 'x'].includes(
        normalized,
      )
    ) {
      return true;
    }

    if (
      [
        'no',
        'false',
        'falso',
        '0',
        'inactivo',
        'inactive',
        'deshabilitado',
        'disabled',
      ].includes(normalized)
    ) {
      return false;
    }

    return Boolean(value);
  }

  private normalizeNullableBooleanValue(value: any): boolean | string {
    if (value === this.NULL_MARKER) return this.NULL_MARKER;
    return this.normalizeBooleanValue(value);
  }

  /**
   * Convierte una celda de código de barras a texto exacto. Excel guarda los
   * códigos numéricos como número: se rechaza la notación científica (pierde
   * dígitos) en vez de persistir un código corrupto.
   */
  private coerceBarcodeCell(raw: unknown): { value?: string; error?: string } {
    const sciError =
      'Código de barras en notación científica: formatee la columna como texto';
    let text: string;
    if (typeof raw === 'number') {
      if (!Number.isSafeInteger(raw)) return { error: sciError };
      text = String(raw);
    } else {
      text = String(raw ?? '').trim();
    }
    if (!text) return {};
    if (/^\d[\d.]*e[+-]?\d+$/i.test(text)) {
      return { error: sciError };
    }
    if (text.length > this.MAX_BARCODE_LENGTH) {
      return {
        error: `El código de barras excede ${this.MAX_BARCODE_LENGTH} caracteres`,
      };
    }
    return { value: text };
  }

  /**
   * Parsea archivo (Excel o CSV) a array de productos usando mapeo de español
   */
  parseFile(buffer: Buffer): any[] {
    try {
      // `raw: true` sólo cambia el parseo de CSV: evita que SheetJS coaccione
      // "5.000" a `5` (o "$ 5.000" a `5`) antes de que el parser de dinero lo
      // vea. En .xlsx no tiene efecto: las celdas numéricas siguen siendo
      // números y las de texto, texto.
      const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
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
        const normalized = h
          .toString()
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
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
            const val = typeof raw === 'string' ? raw.trim() : raw;

            if (val === '' || val === null || val === undefined) {
              return;
            }

            const strVal = typeof val === 'string' ? val : String(val);

            if (
              strVal.toUpperCase() === 'NULL' ||
              strVal === '-' ||
              strVal === '--'
            ) {
              product[key] = this.NULL_MARKER;
              hasData = true;
              return;
            }

            if (key === 'barcode') {
              const coerced = this.coerceBarcodeCell(val);
              if (coerced.error) {
                const cellErrors = product[this.CELL_ERRORS_KEY] ?? [];
                cellErrors.push({
                  code: 'INVALID_BARCODE',
                  message: coerced.error,
                  field: 'barcode',
                });
                product[this.CELL_ERRORS_KEY] = cellErrors;
              } else if (coerced.value) {
                product.barcode = coerced.value;
              }
              hasData = true;
              return;
            }

            if (this.MONEY_CELL_FIELDS.has(key)) {
              const parsed = parseMoneyCell(val);
              if (parsed === null) {
                // Celda con texto que no es un número (p. ej. "cinco mil",
                // "N/A"): no se descarta en silencio. Queda marcada para que
                // la previsualización y la escritura rechacen la fila en vez
                // de persistir un precio 0 (QUI-846). Las columnas de dinero
                // que el importador ignora (Costo) no bloquean la fila.
                if (!this.CATALOG_ONLY_IGNORED_FIELD_LABELS[key]) {
                  const label =
                    key === 'base_price'
                      ? 'El precio de venta'
                      : 'El precio de oferta';
                  const cellErrors = product[this.CELL_ERRORS_KEY] ?? [];
                  cellErrors.push({
                    code: 'INVALID_PRICE',
                    message: `${label} no es un número válido. Escribe solo dígitos y separadores, por ejemplo 5000 o 5.000.`,
                    field: key,
                  });
                  product[this.CELL_ERRORS_KEY] = cellErrors;
                }
              } else {
                product[key] = parsed;
              }
              hasData = true;
              return;
            }

            if (this.NUMERIC_CELL_FIELDS.has(key)) {
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
   * Resuelve las columnas de unidad de una fila contra el catálogo global y
   * deja los FKs listos para el DTO.
   *
   * Se valida acá y no en el servicio de productos porque una fila mala debe
   * fallar nombrando el código que el comerciante escribió —"la unidad 'in' no
   * sirve como unidad de stock"— y no un id que no existe en su archivo. Una
   * fila sin estas columnas sale intacta: las plantillas viejas siguen
   * importando igual que siempre.
   */
  private applyUnitColumns(
    product: Record<string, any>,
    catalog: Map<string, UomCatalogEntry>,
  ): void {
    const resolve = (raw: any): UomCatalogEntry | null => {
      if (raw === undefined || raw === null) return null;
      const code = String(raw).trim().toLowerCase();
      if (!code) return null;
      const unit = catalog.get(code);
      if (!unit) {
        throw new BadRequestException(
          `La unidad "${raw}" no existe en el catálogo. Usa un código válido (mm, cm, m, g, kg, ml, L, unit...).`,
        );
      }
      return unit;
    };

    const stock = resolve(product.stock_uom_code);
    if (stock) {
      if (!stock.is_stock_eligible) {
        throw new BadRequestException(
          `${stock.name} (${stock.code}) no puede ser la unidad de stock porque su factor de conversión no es entero. Úsala como unidad de compra o define el stock en una unidad exacta.`,
        );
      }
      product.stock_uom_id = stock.id;
    }
    delete product.stock_uom_code;

    const purchase = resolve(product.purchase_uom_code);
    if (purchase) product.purchase_uom_id = purchase.id;
    delete product.purchase_uom_code;

    if (product.price_unit_quantity !== undefined) {
      const scale = Number(product.price_unit_quantity);
      if (!Number.isInteger(scale) || scale < 1) {
        throw new BadRequestException(
          `"Precio por N unidades" debe ser un entero mayor o igual a 1; llegó "${product.price_unit_quantity}".`,
        );
      }
      product.price_unit_quantity = scale;
    }
  }

  /** Catálogo de unidades indexado por código en minúsculas. */
  private async loadUomCatalogByCode(): Promise<Map<string, UomCatalogEntry>> {
    const rows = await this.prisma.units_of_measure.findMany({
      where: { is_active: true },
      select: { id: true, code: true, name: true, is_stock_eligible: true },
    });
    return new Map(
      rows.map((u) => [
        u.code.toLowerCase(),
        {
          id: u.id,
          code: u.code,
          name: u.name,
          is_stock_eligible: u.is_stock_eligible,
        },
      ]),
    );
  }

  private stripCatalogOnlyIgnoredFields(
    product: Record<string, any>,
  ): string[] {
    const ignored = new Set<string>();

    for (const field of this.CATALOG_ONLY_IGNORED_FIELDS) {
      if (product[field] !== undefined) {
        ignored.add(field);
        delete product[field];
      }
    }

    if (Array.isArray(product.variants)) {
      for (const variant of product.variants) {
        if (!variant || typeof variant !== 'object') continue;

        for (const field of [
          'stock_quantity',
          'stock_by_location',
          'cost_price',
          'profit_margin',
        ]) {
          if (variant[field] !== undefined) {
            ignored.add(`variants.${field}`);
            delete variant[field];
          }
        }
      }
    }

    return Array.from(ignored);
  }

  private formatIgnoredCatalogFields(fields: string[]): string {
    return fields
      .map((field) => {
        const normalizedField = field.replace(/^variants\./, '');
        const label =
          this.CATALOG_ONLY_IGNORED_FIELD_LABELS[normalizedField] ??
          normalizedField;
        return field.startsWith('variants.') ? `Variantes: ${label}` : label;
      })
      .join(', ');
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
      // Incluye archivados: un SKU de archivo que coincide con un archivado
      // se reactiva. Un archivado ya NO ocupa slug/barcode (índices únicos
      // parciales WHERE state <> 'archived'), pero sí sirve para reactivar.
      where: { store_id: storeId },
      select: {
        id: true,
        sku: true,
        name: true,
        slug: true,
        state: true,
        updated_at: true,
      },
    });
    const skuMap = new Map<
      string,
      { id: number; name: string; archived: boolean; ts: number }
    >();
    // Solo dueños NO archivados: un archivado no ocupa el slug.
    const slugMap = new Map<string, { id: number; name: string }>();
    for (const p of existingProducts) {
      const archived = p.state === 'archived';
      const ts = p.updated_at ? new Date(p.updated_at).getTime() : 0;
      if (p.sku) {
        const key = p.sku.toLowerCase();
        const prev = skuMap.get(key);
        // Con varios productos por SKU gana el no archivado (el commit lo
        // actualiza); si solo hay archivados, el más reciente (updated_at,
        // luego id mayor) se reactiva.
        const wins =
          !prev ||
          (prev.archived && !archived) ||
          (prev.archived === archived &&
            archived &&
            (ts > prev.ts || (ts === prev.ts && p.id > prev.id)));
        if (wins) {
          skuMap.set(key, { id: p.id, name: p.name, archived, ts });
        }
      }
      if (p.slug && !archived) {
        slugMap.set(p.slug, { id: p.id, name: p.name });
      }
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

    // 5b. Códigos de barras: UNA consulta por tabla sobre el set del archivo.
    const barcodeOwners = await this.loadBarcodeOwners(
      products
        .map((p) => p.barcode)
        .filter(
          (b): b is string => typeof b === 'string' && b !== this.NULL_MARKER,
        ),
      storeId,
    );
    const seenBarcodes = new Map<string, { row: number; sku: string }>();

    // 6. Analyze each product
    const analysisItems: BulkProductAnalysisItemDto[] = [];
    let ready = 0;
    let withWarnings = 0;
    let withErrors = 0;

    for (let i = 0; i < products.length; i++) {
      const product = { ...products[i] };
      const ignoredCatalogFields = this.stripCatalogOnlyIgnoredFields(product);
      const cellErrors: { code: string; message: string; field?: string }[] =
        Array.isArray(product[this.CELL_ERRORS_KEY])
          ? product[this.CELL_ERRORS_KEY]
          : [];
      const parsedBasePrice = parseMoneyCell(product.base_price);
      const item: BulkProductAnalysisItemDto = {
        row_number: i + 2, // +2 because row 1 is header, data starts at row 2
        name: product.name || '',
        sku: product.sku || '',
        barcode:
          typeof product.barcode === 'string' &&
          product.barcode !== this.NULL_MARKER
            ? product.barcode
            : undefined,
        product_type: 'physical',
        base_price: parsedBasePrice ?? 0,
        cost_price: 0,
        stock_quantity: 0,
        track_inventory: undefined,
        brand_name: undefined,
        brand_will_create: false,
        category_names: [],
        categories_will_create: [],
        warehouse_code: undefined,
        warehouse_name: undefined,
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
        item.track_inventory = this.normalizeBooleanValue(
          product.track_inventory,
        );
      } else {
        // Default: services=false, physical=true
        item.track_inventory = item.product_type === 'service' ? false : true;
      }

      // Service always false
      if (item.product_type === 'service') {
        item.track_inventory = false;
      }

      if (ignoredCatalogFields.length > 0) {
        item.warnings.push({
          code: 'CATALOG_ONLY_IGNORED_FIELDS',
          message: `Se ignoraron columnas exclusivas de inventario/compra (${this.formatIgnoredCatalogFields(ignoredCatalogFields)}). Las entradas, salidas y costos reales de inventario se gestionan desde Inventario > POP.`,
          field: ignoredCatalogFields[0],
        });
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
      // Celda de precio con texto no numérico: error de fila (no se degrada a
      // un warning que dejaría pasar el producto con precio 0).
      for (const cellError of cellErrors) {
        item.errors.push(cellError);
      }

      const hasPriceCellError = cellErrors.some((e) => e.field === 'base_price');
      if (!hasPriceCellError && parsedBasePrice === null) {
        item.errors.push({
          code: 'MISSING_PRICE',
          message:
            'El precio de venta es obligatorio: la columna "Precio Venta" está vacía.',
          field: 'base_price',
        });
      } else if (parsedBasePrice !== null && parsedBasePrice < 0) {
        item.errors.push({
          code: 'INVALID_PRICE',
          message: 'Precio de venta no puede ser negativo',
          field: 'base_price',
        });
      } else if (parsedBasePrice === 0) {
        item.warnings.push({
          code: 'NO_PRICE_SPECIFIED',
          message: 'No se especificó precio de venta',
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
          item.action = existing.archived ? 'reactivate' : 'update';
          item.existing_product_id = existing.id;
          if (existing.archived) {
            item.warnings.push({
              code: 'WILL_REACTIVATE_ARCHIVED',
              message: `El SKU corresponde al producto archivado "${existing.name}": se reactivará con los datos del archivo`,
              field: 'sku',
            });
          }
        }
      }

      // Paridad con create: el slug es único entre productos NO archivados
      // (PROD_DUP_001). Se avisa aquí, no en el commit.
      if (item.action !== 'update' && item.name) {
        const effectiveSlug = product.slug || generateSlug(item.name);
        const slugOwner = effectiveSlug ? slugMap.get(effectiveSlug) : undefined;
        if (slugOwner && slugOwner.id !== item.existing_product_id) {
          item.errors.push({
            code: 'DUPLICATE_SLUG',
            message: `El nombre genera el slug "${effectiveSlug}", que ya usa el producto "${slugOwner.name}". Cambia el nombre o la columna slug.`,
            field: 'name',
          });
        }
      }

      // Código de barras: duplicado en el archivo y choque con otro
      // producto/variante/presentación de la tienda (misma regla que
      // `assertBarcodeUnique` en el commit). Mismo SKU + mismo barcode = OK.
      if (item.barcode) {
        const skuLower = item.sku ? item.sku.toLowerCase() : '';
        const first = seenBarcodes.get(item.barcode);
        if (first && first.sku !== skuLower) {
          item.errors.push({
            code: 'DUPLICATE_BARCODE_IN_BATCH',
            message: `Código de barras duplicado en el archivo (primera aparición en fila ${first.row})`,
            field: 'barcode',
          });
        } else if (!first) {
          seenBarcodes.set(item.barcode, {
            row: item.row_number,
            sku: skuLower,
          });
        }

        const owner = barcodeOwners.get(item.barcode);
        if (owner && owner.product_id !== item.existing_product_id) {
          const where =
            owner.kind === 'variant'
              ? 'una variante'
              : owner.kind === 'presentation'
                ? 'una presentación de venta'
                : 'otro producto';
          const ownerName = owner.product_name
            ? ` del producto ${owner.archived ? 'archivado ' : ''}"${owner.product_name}"`
            : '';
          item.errors.push({
            code: 'BARCODE_IN_USE',
            message: `El código de barras ya está en uso por ${where}${ownerName} de esta tienda`,
            field: 'barcode',
          });
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

      // Cross-field validations (only when BOTH fields are explicitly present)
      if (
        item.product_type === 'service' &&
        item.action !== 'update' &&
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
        item.action !== 'update' &&
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
          message: 'Si requiere reserva, se recomienda definir modalidad.',
          field: 'service_modality',
        });
      }

      // Compute modified vs nulled fields for sparse update preview
      const modifiedFields: string[] = [];
      const nulledFields: string[] = [];

      const FIELDS_TO_TRACK = [
        'name',
        'sku',
        'barcode',
        'description',
        'base_price',
        'state',
        'product_type',
        'track_inventory',
        'available_for_ecommerce',
        'is_featured',
        'allow_pos_price_override',
        'has_multiple_price_tiers',
        'is_on_sale',
        'sale_price',
        'weight',
        'brand_id',
        'category_ids',
        'tax_category_ids',
        'pricing_type',
        'service_duration_minutes',
        'service_modality',
        'service_pricing_type',
        'requires_booking',
        'booking_mode',
        'buffer_minutes',
        'is_recurring',
        'service_instructions',
        'is_consultation',
        'send_preconsultation',
        'consultation_template_id',
        'preconsultation_template_id',
        'preparation_time_minutes',
      ];

      for (const field of FIELDS_TO_TRACK) {
        const value = product[field];
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
   * Resuelve a quién pertenece cada barcode del archivo dentro de la tienda
   * (producto, variante o presentación): una consulta por tabla, no por fila.
   */
  private async loadBarcodeOwners(
    barcodes: string[],
    storeId: number,
  ): Promise<Map<string, BarcodeOwner>> {
    const owners = new Map<string, BarcodeOwner>();
    const unique = Array.from(new Set(barcodes));
    if (unique.length === 0) return owners;

    // Un producto archivado ya no ocupa su código (índice único parcial):
    // solo cuentan productos activos y variantes de productos no archivados.
    // Las presentaciones cuentan siempre (decisión del dueño): el código de
    // una presentación de un producto archivado sigue bloqueado.
    const [productRows, variantRows, presentationRows] = await Promise.all([
      this.prisma.products.findMany({
        where: {
          store_id: storeId,
          barcode: { in: unique },
          state: { not: 'archived' },
        },
        select: { id: true, barcode: true, name: true },
      }),
      this.prisma.product_variants.findMany({
        where: {
          barcode: { in: unique },
          products: { store_id: storeId, state: { not: 'archived' } },
        },
        select: {
          product_id: true,
          barcode: true,
          products: { select: { name: true } },
        },
      }),
      this.prisma.product_price_tier_assignments.findMany({
        where: { barcode: { in: unique }, product: { store_id: storeId } },
        select: {
          product_id: true,
          barcode: true,
          product: { select: { name: true, state: true } },
        },
      }),
    ]);

    for (const r of presentationRows) {
      if (r.barcode)
        owners.set(r.barcode, {
          kind: 'presentation',
          product_id: r.product_id,
          product_name: r.product?.name,
          archived: r.product?.state === 'archived',
        });
    }
    for (const r of variantRows) {
      if (r.barcode)
        owners.set(r.barcode, {
          kind: 'variant',
          product_id: r.product_id,
          product_name: r.products?.name,
          archived: false,
        });
    }
    for (const r of productRows) {
      if (r.barcode)
        owners.set(r.barcode, {
          kind: 'product',
          product_id: r.id,
          product_name: r.name,
          archived: false,
        });
    }
    return owners;
  }

  /**
   * Procesa la carga masiva desde una sesión de análisis previa.
   * Descarga el archivo temporal de S3, lo procesa y limpia.
   */
  async uploadProductsFromSession(
    sessionId: string,
    storeId: number,
    user: any,
    page?: { offset?: number; limit?: number },
  ): Promise<BulkUploadResultDto | BulkUploadSessionResultDto> {
    const s3Key = `tmp/bulk-products/${storeId}/${sessionId}.xlsx`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.s3Service.downloadImage(s3Key);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }

    // Modo paginado: el cliente recorre el archivo en páginas de <=100 filas.
    // El S3 temporal se borra solo cuando la última página terminó (done=true);
    // ante una excepción se conserva para poder reintentar la página.
    if (page && (page.offset !== undefined || page.limit !== undefined)) {
      const offset = page.offset ?? 0;
      const limit = Math.min(page.limit ?? MAX_BULK_UPLOAD_PAGE, MAX_BULK_UPLOAD_PAGE);

      const all = this.parseFile(fileBuffer);
      const total = all.length;
      if (total > this.MAX_BATCH_SIZE) {
        throw new VendixHttpException(ErrorCodes.BULK_PROD_LIMIT_EXCEEDED);
      }
      if (offset >= total) {
        throw new BadRequestException(
          `El offset (${offset}) está fuera del archivo: contiene ${total} filas de datos`,
        );
      }

      const result = await this.uploadProducts(
        { products: all.slice(offset, offset + limit) },
        user,
        { rowOffset: offset },
      );
      const done = offset + limit >= total;
      if (done) {
        try {
          await this.s3Service.deleteFile(s3Key);
        } catch (e) {
          // Silent cleanup failure
        }
      }
      return { ...result, total, offset, limit, done };
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
   * Devuelve los encabezados en Español de la plantilla de productos físicos.
   * Reutilizado por `generateExcelTemplate` y `exportCurrentProductsAsTemplate`
   * para garantizar que el archivo exportado sea 100% compatible con la
   * carga masiva (round-trip: editar + re-cargar funciona sin cambios).
   */
  getProductTemplateHeaders(): string[] {
    return [
      'Nombre',
      'SKU',
      'Código de barras',
      'Tipo',
      'Estado',
      'Controla Inventario',
      'Precio Venta',
      'Descripción',
      'Marca',
      'Categorías',
      'Impuestos IDs',
      'Tipo Precio',
      'Disponible Ecommerce',
      'Destacado',
      'Permite Cambiar Precio POS',
      'Usa Listas de Precio',
      'Peso',
      'En Oferta',
      'Precio Oferta',
      // Unidades (QUI-648). Una fila sin estas columnas se importa con los
      // valores de siempre, así que las plantillas viejas siguen sirviendo.
      'Unidad de stock',
      'Unidad de compra',
      'Precio por N unidades',
    ];
  }

  /**
   * Genera la plantilla de carga masiva en formato Excel (.xlsx)
   */
  async generateExcelTemplate(
    type: BulkExcelTemplateRequest = 'products',
  ): Promise<Buffer> {
    const templateType = type;
    const productHeaders = this.getProductTemplateHeaders();
    const serviceHeaders = [
      'Nombre',
      'SKU',
      'Código de barras',
      'Tipo',
      'Estado',
      'Precio Venta',
      'Descripción',
      'Marca',
      'Categorías',
      'Impuestos IDs',
      'Disponible Ecommerce',
      'Destacado',
      'Permite Cambiar Precio POS',
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
      'Es Consulta',
      'Enviar Preconsulta',
      'Plantilla Consulta ID',
      'Plantilla Preconsulta ID',
      'Tiempo Preparación (min)',
    ];

    const headers =
      templateType === 'services' ? serviceHeaders : productHeaders;
    const exampleData =
      templateType === 'services'
        ? [
            {
              Nombre: 'Asesoría Tributaria',
              SKU: 'SVC-ASE-TRI-001',
              'Código de barras': '',
              Tipo: 'servicio',
              Estado: 'activo',
              'Precio Venta': 150000,
              Descripción: 'Asesoría tributaria profesional por sesión.',
              Marca: '',
              Categorías: 'Servicios, Contabilidad',
              'Impuestos IDs': '',
              'Disponible Ecommerce': 'sí',
              Destacado: 'no',
              'Permite Cambiar Precio POS': 'no',
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
              'Es Consulta': 'no',
              'Enviar Preconsulta': 'no',
              'Plantilla Consulta ID': '',
              'Plantilla Preconsulta ID': '',
              'Tiempo Preparación (min)': 15,
            },
            {
              Nombre: 'Consultoría Estratégica Virtual',
              SKU: 'SVC-CON-EST-001',
              'Código de barras': '',
              Tipo: 'servicio',
              Estado: 'activo',
              'Precio Venta': 250000,
              Descripción:
                'Consultoría estratégica virtual por sesión de 90 minutos.',
              Marca: '',
              Categorías: 'Servicios, Consultoría',
              'Impuestos IDs': '',
              'Disponible Ecommerce': 'sí',
              Destacado: 'sí',
              'Permite Cambiar Precio POS': 'no',
              'En Oferta': 'no',
              'Precio Oferta': 0,
              'Duración Servicio (min)': 90,
              'Modalidad Servicio': 'virtual',
              'Tipo Precio Servicio': 'por sesión',
              'Requiere Reserva': 'sí',
              'Modo Reserva': 'libre',
              'Buffer (min)': 10,
              'Es Recurrente': 'no',
              'Instrucciones Servicio':
                'Conexión por videollamada 5 minutos antes de la sesión.',
              'Es Consulta': 'no',
              'Enviar Preconsulta': 'no',
              'Plantilla Consulta ID': '',
              'Plantilla Preconsulta ID': '',
              'Tiempo Preparación (min)': 10,
            },
            {
              Nombre: 'Mantenimiento Preventivo Anual',
              SKU: 'SVC-MNT-PRE-001',
              'Código de barras': '',
              Tipo: 'servicio',
              Estado: 'activo',
              'Precio Venta': 480000,
              Descripción:
                'Plan de mantenimiento preventivo anual para equipos.',
              Marca: '',
              Categorías: 'Servicios, Mantenimiento',
              'Impuestos IDs': '',
              'Disponible Ecommerce': 'sí',
              Destacado: 'no',
              'Permite Cambiar Precio POS': 'sí',
              'En Oferta': 'no',
              'Precio Oferta': 0,
              'Duración Servicio (min)': 120,
              'Modalidad Servicio': 'híbrido',
              'Tipo Precio Servicio': 'suscripción',
              'Requiere Reserva': 'no',
              'Modo Reserva': '',
              'Buffer (min)': 0,
              'Es Recurrente': 'sí',
              'Instrucciones Servicio':
                'Coordinar visita técnica con anticipación de 24 horas.',
              'Es Consulta': 'no',
              'Enviar Preconsulta': 'no',
              'Plantilla Consulta ID': '',
              'Plantilla Preconsulta ID': '',
              'Tiempo Preparación (min)': 30,
            },
          ]
        : [
            {
              Nombre: 'Zapatillas Running Pro',
              SKU: 'ZAP-RUN-PRO-42',
              'Código de barras': '7702001234567',
              Tipo: 'físico',
              Estado: 'activo',
              'Controla Inventario': 'sí',
              'Precio Venta': 85000,
              Descripción: 'Zapatillas ideales para correr largas distancias.',
              Marca: 'Nike',
              Categorías: 'Deportes, Calzado',
              'Impuestos IDs': '',
              'Tipo Precio': 'unidad',
              'Disponible Ecommerce': 'sí',
              Destacado: 'sí',
              'Permite Cambiar Precio POS': 'no',
              'Usa Listas de Precio': 'no',
              Peso: 0.8,
              'En Oferta': 'no',
              'Precio Oferta': 0,
            },
            {
              Nombre: 'Leche Entera 1L',
              SKU: 'LEC-ENT-1L-COL',
              'Código de barras': '0123456789012',
              Tipo: 'físico',
              Estado: 'activo',
              'Controla Inventario': 'sí',
              'Precio Venta': 5200,
              Descripción: 'Leche entera pasteurizada de origen colombiano.',
              Marca: 'Colanta',
              Categorías: 'Alimentos, Lácteos',
              'Impuestos IDs': '',
              'Tipo Precio': 'unidad',
              'Disponible Ecommerce': 'no',
              Destacado: 'no',
              'Permite Cambiar Precio POS': 'no',
              'Usa Listas de Precio': 'no',
              Peso: 1.05,
              'En Oferta': 'no',
              'Precio Oferta': 0,
            },
            {
              Nombre: 'Frutas Orgánicas Mix 1kg',
              SKU: 'FRU-ORG-MIX-1KG',
              'Código de barras': '',
              Tipo: 'físico',
              Estado: 'activo',
              'Controla Inventario': 'no',
              'Precio Venta': 22000,
              Descripción: 'Mix de frutas orgánicas de temporada por kilo.',
              Marca: '',
              Categorías: 'Alimentos, Orgánicos',
              'Impuestos IDs': '',
              'Tipo Precio': 'peso',
              'Disponible Ecommerce': 'sí',
              Destacado: 'no',
              'Permite Cambiar Precio POS': 'sí',
              'Usa Listas de Precio': 'sí',
              Peso: 1,
              'En Oferta': 'sí',
              'Precio Oferta': 19000,
            },
          ];

    // Cada columna es texto. `key === header` preserva EXACTAMENTE los
    // encabezados (contrato round-trip: parseFile mapea POR HEADER) y reutiliza
    // las filas de ejemplo sin reindexar.
    const columns: ReportColumn[] = headers.map(
      (header): ReportColumn => ({ key: header, header, type: 'text' }),
    );

    const sheetName =
      templateType === 'services'
        ? 'Plantilla Servicios'
        : 'Plantilla Productos';

    const buffer = await buildReportBuffer({
      sheets: [{ name: sheetName, columns, rows: exampleData }],
    });
    // El builder escribe las celdas de texto pero no formatea la columna
    // vacía: sin `@` Excel convierte 0123456789012 en número y pierde el cero.
    return this.formatColumnAsText(buffer, headers.indexOf('Código de barras') + 1);
  }

  /**
   * Marca una columna (1-based) como texto (`@`) en el primer hoja del XLSX,
   * para que los códigos numéricos que el usuario escriba conserven ceros
   * iniciales y no pasen a notación científica.
   */
  private async formatColumnAsText(
    buffer: Buffer,
    columnIndex: number,
  ): Promise<Buffer> {
    if (columnIndex < 1) return buffer;
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) return buffer;
    const column = sheet.getColumn(columnIndex);
    column.numFmt = '@';
    column.eachCell({ includeEmpty: false }, (cell) => {
      cell.numFmt = '@';
    });
    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  /**
   * Genera un XLSX con los productos actuales de la tienda, usando los mismos
   * encabezados de la plantilla de Carga Masiva + 3 columnas informativas
   * (Precio Compra, Cantidad Actual, Tiene Imagen).
   *
   * El archivo es round-trip compatible con `generateExcelTemplate('products')`:
   * las 20 columnas editables pueden modificarse y re-cargarse con el flujo
   * existente. Las 3 columnas informativas son ignoradas por el parser al
   * re-cargar (no existen en `HEADER_MAP`).
   *
   * Implementa cursor pagination interna en chunks de 500 para evitar cargar
   * catálogos grandes en memoria de golpe.
   */
  async exportCurrentProductsAsTemplate(): Promise<Buffer> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    // Wrap TODO el export en try-catch para que el cliente NUNCA vea un error
    // de Prisma crudo. Errores legítimos (empty state) se re-lanzan tal cual;
    // cualquier otro fallo (Prisma, red, permisos) se convierte en un
    // mensaje amigable y se loguea para debugging.
    try {
      // Filtramos `state: { not: ProductState.ARCHIVED }` para excluir
      // productos archivados que el cliente NO ve en la UI. Usamos la constante
      // (no string literal) para que el compilador verifique el enum.
      const archivedFilter = { state: { not: ProductState.ARCHIVED } };
      const baseWhere = { store_id: storeId, ...archivedFilter };

      // Validar que la tienda tenga al menos un producto antes de generar el
      // archivo. Si count() falla (e.g. schema drift), NO fingimos que la
      // tienda está vacía — propagamos un mensaje distinto al del empty state
      // para que el usuario no crea falsamente que no tiene productos.
      let productCount = 0;
      let countSucceeded = true;
      try {
        productCount = await this.prisma.products.count({ where: baseWhere });
      } catch (err) {
        countSucceeded = false;
        this.logger.error(
          `[exportCurrentProductsAsTemplate] count() failed for store ${storeId} — probable schema drift`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      if (countSucceeded && productCount === 0) {
        throw new NotFoundException(
          'No hay productos en su tienda. Agrega productos antes de descargar la plantilla.',
        );
      }
      if (!countSucceeded) {
        throw new InternalServerErrorException(
          'No se pudo verificar el catálogo de productos. Por favor intenta de nuevo en unos minutos.',
        );
      }

      const baseHeaders = this.getProductTemplateHeaders();
      const extraHeaders = ['Precio Compra', 'Cantidad Actual', 'Tiene Imagen'];
      const headers = [...baseHeaders, ...extraHeaders];

      const rows: Record<string, any>[] = [];
      const CHUNK_SIZE = 500;
      let cursor: number | undefined = undefined;

      // Try the rich query (con stock_levels + product_images + brands + ...)
      // primero. Si falla por schema drift (común cuando prod está detrás en
      // migrations vs el dev DB completo), caemos a un fallback mínimo que
      // solo trae los campos del producto. De esta forma la mayoría de tiendas
      // recibe el export enriquecido, y solo las que tienen schema drift ven
      // un export reducido + un log de warning en backend.
      let useRichInclude = true;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let products: any[] = [];
        try {
          const findArgs: any = {
            where: baseWhere,
            orderBy: { id: 'asc' },
            take: CHUNK_SIZE,
            ...(cursor !== undefined && { skip: 1, cursor: { id: cursor } }),
          };
          if (useRichInclude) {
            findArgs.include = {
              brands: { select: { name: true } },
              product_categories: {
                include: { categories: { select: { name: true } } },
              },
              product_tax_assignments: { select: { tax_category_id: true } },
              product_images: { where: { is_main: true }, take: 1 },
              product_variants: { select: { id: true } },
              stock_levels: {
                select: {
                  product_variant_id: true,
                  quantity_available: true,
                },
              },
            };
          }
          products = await this.prisma.products.findMany(findArgs);
        } catch (err) {
          if (useRichInclude) {
            // Schema drift probable — fallback al query mínimo sin includes.
            // No incrementamos cursor porque este chunk no devolvió nada.
            this.logger.warn(
              `[exportCurrentProductsAsTemplate] rich findMany failed for store ${storeId} — falling back to minimal query (no stock/image columns)`,
              err instanceof Error ? err.stack : String(err),
            );
            useRichInclude = false;
            continue;
          }
          this.logger.error(
            `[exportCurrentProductsAsTemplate] minimal findMany failed for store ${storeId}`,
            err instanceof Error ? err.stack : String(err),
          );
          break;
        }

        if (products.length === 0) break;

        for (const p of products) {
          const hasVariants = (p.product_variants?.length ?? 0) > 0;
          const stockLevelsForTotals = hasVariants
            ? (p.stock_levels ?? []).filter(
                (sl) => sl.product_variant_id !== null,
              )
            : p.stock_levels ?? [];
          const totalStock = useRichInclude
            ? stockLevelsForTotals.reduce(
                (sum, sl) => sum + (sl.quantity_available ?? 0),
                0,
              )
            : 0;
          const hasImage = useRichInclude
            ? (p.product_images?.length ?? 0) > 0
            : false;

          rows.push({
          Nombre: p.name,
          SKU: p.sku ?? '',
          'Código de barras': p.barcode ?? '',
          Tipo: p.product_type === 'service' ? 'servicio' : 'físico',
          Estado:
            p.state === 'active'
              ? 'activo'
              : p.state === 'inactive'
                ? 'inactivo'
                : 'archivado',
          'Controla Inventario': p.track_inventory ? 'sí' : 'no',
          'Precio Venta': p.base_price ? Number(p.base_price) : 0,
          Descripción: p.description ?? '',
          Marca: p.brands?.name ?? '',
          Categorías:
            p.product_categories
              ?.map((pc) => pc.categories?.name)
              .filter(Boolean)
              .join(', ') ?? '',
          'Impuestos IDs':
            p.product_tax_assignments
              ?.map((a) => a.tax_category_id)
              .filter(Boolean)
              .join(', ') ?? '',
          'Tipo Precio': p.pricing_type === 'weight' ? 'peso' : 'unidad',
          'Disponible Ecommerce': p.available_for_ecommerce ? 'sí' : 'no',
          Destacado: p.is_featured ? 'sí' : 'no',
          'Permite Cambiar Precio POS': p.allow_pos_price_override ? 'sí' : 'no',
          'Usa Listas de Precio': p.has_multiple_price_tiers ? 'sí' : 'no',
          Peso: p.weight ? Number(p.weight) : '',
          'En Oferta': p.is_on_sale ? 'sí' : 'no',
          'Precio Oferta': p.sale_price ? Number(p.sale_price) : 0,
          'Precio Compra': p.cost_price ? Number(p.cost_price) : '',
          'Cantidad Actual': totalStock,
          'Tiene Imagen': hasImage ? 'sí' : 'no',
        });
      }

      if (products.length < CHUNK_SIZE) break;
      cursor = products[products.length - 1].id;
    }

    // Si no se recolectaron filas (tienda vacía según el count, o findMany()
    // mínimo falló por schema drift), lanzar el error correspondiente. Esto
    // evita que el cliente descargue un Excel vacío con solo headers — un
    // archivo inútil.
    if (rows.length === 0) {
      if (countSucceeded) {
        throw new NotFoundException(
          'No hay productos en su tienda. Agrega productos antes de descargar la plantilla.',
        );
      }
      throw new InternalServerErrorException(
        'No se pudo generar la plantilla en este momento. Por favor intenta de nuevo en unos minutos.',
      );
    }

    // Si la tienda no tiene productos, igual devolver una hoja con los headers
    // (fila vacía) para que el usuario vea la estructura esperada.
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [], {
      header: headers,
    });

    const colWidths = headers.map((h) => ({
      wch: Math.max(h.length + 5, 20),
    }));
    ws['!cols'] = colWidths;

    // Código de barras como texto puro: tipo 's' + formato '@' para que Excel
    // no lo convierta a número ni pierda ceros iniciales al editar/re-cargar.
    const barcodeCol = headers.indexOf('Código de barras');
    if (barcodeCol >= 0) {
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: barcodeCol })];
        if (cell) {
          cell.t = 's';
          cell.z = '@';
          cell.v = String(cell.v ?? '');
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos Actuales');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (err) {
      // Re-throw errores legítimos con mensaje ya-amigable (NotFoundException del
      // empty state, BadRequestException del contexto, etc.) — son intencionales
      // y el frontend los muestra tal cual.
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }

      // Cualquier otro error (Prisma, timeout, permisos de DB, columna
      // faltante, etc.) se loguea con contexto y se convierte a un mensaje
      // legible para el cliente. NUNCA se propaga el error crudo de Prisma
      // al frontend.
      // Mapear errores de Prisma a mensajes amigables inline (sin helper
      // module-level para evitar el bug "is not a function" que vimos en
      // producción con un deploy parcial).
      const prismaCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      const prismaMessage =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';

      let userMessage =
        'No se pudo generar la plantilla de productos. Por favor intenta de nuevo o contacta al soporte si el problema persiste.';

      switch (prismaCode) {
        case 'P1001':
        case 'P1017':
          userMessage =
            'No se pudo conectar a la base de datos. Por favor intenta de nuevo en unos minutos.';
          break;
        case 'P1002':
          userMessage =
            'La conexión con la base de datos tardó demasiado. Por favor intenta de nuevo.';
          break;
        case 'P1003':
          userMessage =
            'La base de datos no está disponible. Por favor contacta al soporte si el problema persiste.';
          break;
        case 'P2010':
          userMessage =
            'La estructura de la base de datos no es la esperada. Por favor contacta al soporte técnico.';
          break;
        case 'P2025':
          userMessage =
            'No se encontraron los productos solicitados. Por favor actualiza la página e intenta de nuevo.';
          break;
        case 'P2002':
          userMessage =
            'Hay datos duplicados en tu tienda que impiden generar la plantilla. Por favor contacta al soporte.';
          break;
        case 'P2003':
          userMessage =
            'Hay datos relacionados que faltan en tu tienda. Por favor contacta al soporte.';
          break;
      }

      // Heurísticas por mensaje (fallback cuando el código no es uno de los
      // conocidos o el error viene de otra capa). Todos genéricos para
      // NO exponer jerga técnica (DB, schema, etc.) al cliente.
      if (prismaMessage.includes('does not exist in the current database')) {
        userMessage =
          'No se pudo generar la plantilla en este momento. Por favor intenta de nuevo en unos minutos.';
      } else if (prismaMessage.includes('permission denied')) {
        userMessage =
          'No tienes permisos para acceder a estos datos. Por favor contacta al administrador de tu tienda.';
      } else if (
        prismaMessage.includes('timeout') ||
        prismaMessage.includes('timed out')
      ) {
        userMessage = 'La operación tardó demasiado. Por favor intenta de nuevo.';
      }

      throw new InternalServerErrorException(userMessage);
    }
  }

  /**
   * Procesa la carga masiva de productos
   */
  async uploadProducts(
    bulkUploadDto: BulkProductUploadDto,
    user: any,
    options: { rowOffset?: number } = {},
  ): Promise<BulkUploadResultDto> {
    const { products } = bulkUploadDto;
    const rowOffset = options.rowOffset ?? 0;

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

    // Una sola lectura del catálogo para todo el lote: son dos docenas de
    // filas globales y resolverlas por producto sería una consulta por fila.
    const uomCatalog = await this.loadUomCatalogByCode();

    const results: BulkUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    for (let rowIndex = 0; rowIndex < products.length; rowIndex++) {
      const productData = products[rowIndex];
      const rowNumber = rowOffset + rowIndex + 2; // header = fila 1; rowOffset = página de la sesión
      try {
        // Celda de código de barras inválida (notación científica / >64):
        // se rechaza la fila en vez de crearla sin el código.
        const barcodeCellError = (
          (productData as any)[this.CELL_ERRORS_KEY] as
            | { field?: string; message: string }[]
            | undefined
        )?.find((e) => e.field === 'barcode');
        if (barcodeCellError) {
          throw new BadRequestException(barcodeCellError.message);
        }

        const ignoredCatalogFields = this.stripCatalogOnlyIgnoredFields(
          productData as any,
        );

        if (ignoredCatalogFields.length > 0) {
          this.logger.warn('PRODUCT_BULK_IGNORED_INVENTORY_FIELDS', {
            storeId,
            sku: productData.sku,
            fields: ignoredCatalogFields,
          });
        }

        // Unidades por código (QUI-648) antes de validar: el resto del flujo
        // ya trabaja con los FKs resueltos.
        this.applyUnitColumns(productData as any, uomCatalog);

        // Pre-procesar: Crear marcas y categorías si son strings
        await this.preprocessProductData(productData, storeId);

        // Validar datos
        await this.validateProductData(productData, storeId);

        // Prefiere el NO archivado; si solo hay archivados, el más reciente
        // se reactiva (un archivado ya no ocupa el SKU ante un activo).
        const existingProduct =
          (await this.prisma.products.findFirst({
            where: {
              store_id: storeId,
              sku: productData.sku,
              state: { not: 'archived' },
            },
          })) ??
          (await this.prisma.products.findFirst({
            where: {
              store_id: storeId,
              sku: productData.sku,
              state: 'archived',
            },
            orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          }));

        let resultProduct;

        if (existingProduct && existingProduct.state === 'archived') {
          resultProduct = await this.reactivateArchivedProduct(
            existingProduct,
            productData,
            storeId,
          );

          results.push({
            product: resultProduct,
            status: 'success',
            action: 'reactivate',
            message: `Producto con SKU ${productData.sku} reactivado con los datos del archivo`,
          });
        } else if (existingProduct) {
          // Actualizar producto existente (sparse update: solo campos presentes)
          const updateProductDto = this.mapToUpdateProductDto(productData);
          resultProduct = await this.productsService.update(
            existingProduct.id,
            updateProductDto,
          );

          results.push({
            product: resultProduct,
            status: 'success',
            action: 'update',
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

            results.push({
              product: resultProduct,
              status: 'success',
              action: 'create',
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
            userMessage = `SKU "${productData.sku}" ya existe en la tienda.`;
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
      if (product.brand_id === this.NULL_MARKER) {
        // Se resuelve en el mapper como null para limpiar la marca.
      } else if (typeof product.brand_id === 'string') {
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
      if (product.category_ids === this.NULL_MARKER) {
        // Se resuelve en el mapper como arreglo vacío para limpiar categorías.
      } else {
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
    }

    // Procesar impuestos por ID (no crea impuestos desde carga masiva)
    if (product.tax_category_ids !== undefined) {
      if (product.tax_category_ids === this.NULL_MARKER) {
        // Se resuelve en el mapper como arreglo vacío para limpiar asignaciones.
      } else {
        const rawTaxIds =
          typeof product.tax_category_ids === 'string'
            ? product.tax_category_ids.split(',')
            : Array.isArray(product.tax_category_ids)
              ? product.tax_category_ids
              : [];
        const taxCategoryIds = rawTaxIds
          .map((id: any) => parseInt(id.toString().trim(), 10))
          .filter((id: number) => !isNaN(id) && id > 0);
        if (rawTaxIds.length > 0 && taxCategoryIds.length === 0) {
          delete product.tax_category_ids;
        } else {
          product.tax_category_ids = taxCategoryIds;
        }
      }
    }

    if (product.is_on_sale !== undefined) {
      product.is_on_sale = this.normalizeNullableBooleanValue(
        product.is_on_sale,
      );
    }

    if (product.available_for_ecommerce !== undefined) {
      product.available_for_ecommerce = this.normalizeNullableBooleanValue(
        product.available_for_ecommerce,
      );
    }

    if (product.is_featured !== undefined) {
      product.is_featured = this.normalizeNullableBooleanValue(
        product.is_featured,
      );
    }

    if (product.allow_pos_price_override !== undefined) {
      product.allow_pos_price_override = this.normalizeNullableBooleanValue(
        product.allow_pos_price_override,
      );
    }

    if (product.has_multiple_price_tiers !== undefined) {
      product.has_multiple_price_tiers = this.normalizeNullableBooleanValue(
        product.has_multiple_price_tiers,
      );
    }

    if (product.requires_booking !== undefined) {
      product.requires_booking = this.normalizeNullableBooleanValue(
        product.requires_booking,
      );
    }

    if (product.is_recurring !== undefined) {
      product.is_recurring = this.normalizeNullableBooleanValue(
        product.is_recurring,
      );
    }

    if (product.is_consultation !== undefined) {
      product.is_consultation = this.normalizeNullableBooleanValue(
        product.is_consultation,
      );
    }

    if (product.send_preconsultation !== undefined) {
      product.send_preconsultation = this.normalizeNullableBooleanValue(
        product.send_preconsultation,
      );
    }

    if (product.requires_serial_numbers !== undefined) {
      product.requires_serial_numbers = this.normalizeNullableBooleanValue(
        product.requires_serial_numbers,
      );
    }

    if (product.requires_batch_tracking !== undefined) {
      product.requires_batch_tracking = this.normalizeNullableBooleanValue(
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
      } else if (
        v === 'por sesión' ||
        v === 'por sesion' ||
        v === 'per_session'
      ) {
        product.service_pricing_type = 'per_session';
      } else if (v === 'paquete' || v === 'package') {
        product.service_pricing_type = 'package';
      } else if (
        v === 'suscripción' ||
        v === 'suscripcion' ||
        v === 'subscription'
      ) {
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
        product.track_inventory = this.normalizeBooleanValue(
          product.track_inventory,
        );
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

    // El precio es la razón de ser del producto: si la celda no se pudo
    // interpretar como número, la fila se rechaza. Permitir `undefined` aquí
    // persistía el default 0 de la base de datos (QUI-846).
    const basePrice = parseMoneyCell(product.base_price);
    if (basePrice === null) {
      throw new BadRequestException(
        'El precio de venta es obligatorio y debe ser un número válido (ej. 5000 o 5.000)',
      );
    }
    if (basePrice < 0) {
      throw new BadRequestException('Precio base debe ser positivo');
    }
    (product as any).base_price = basePrice;

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
    const resolveValue = (val: any) => (val === this.NULL_MARKER ? null : val);

    const dto: any = {
      name: product.name,
      base_price: product.base_price,
      sku: product.sku,
      barcode: resolveValue(product.barcode) ?? undefined,
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
        product.category_ids === this.NULL_MARKER ? [] : product.category_ids,
      weight:
        product.weight && typeof product.weight === 'number'
          ? product.weight
          : undefined,
      is_on_sale: product['is_on_sale'],
      sale_price: product['sale_price'],
      state: product.state,
      available_for_ecommerce: product.available_for_ecommerce,
      is_featured: product.is_featured,
      allow_pos_price_override: product.allow_pos_price_override,
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
      'pricing_type',
      'is_consultation',
      'send_preconsultation',
      'consultation_template_id',
      'preconsultation_template_id',
      'has_multiple_price_tiers',
      // Unidades y escala de precio (QUI-648): llegan ya resueltas a FK por
      // `applyUnitColumns`.
      'stock_uom_id',
      'purchase_uom_id',
      'price_unit_quantity',
    ];

    for (const field of newCatalogFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    if (product.tax_category_ids !== undefined) {
      dto.tax_category_ids =
        product.tax_category_ids === this.NULL_MARKER
          ? []
          : product.tax_category_ids;
    }

    return dto;
  }

  /**
   * Payload "set completo" para reactivar un producto archivado.
   *
   * Regla: parte de `mapToCreateProductDto` (lo que trae el archivo se aplica)
   * y todo campo que ese mapper gestiona y el archivo NO trae vuelve al valor
   * por defecto de creación (`@default` de `model products`; nullable sin
   * default => null; listas => []). Nunca se conserva lo viejo del archivado.
   * Sin `store_id`: `productsService.update` no lo acepta ni lo necesita.
   * El stock no se toca (al archivar quedó en 0).
   */
  private mapToReactivateProductDto(product: BulkProductItemDto): any {
    const { store_id: _omit, ...fromFile } = this.mapToCreateProductDto(
      product,
      0,
    );
    const defaults: Record<string, any> = {
      barcode: null,
      description: null,
      brand_id: null,
      category_ids: [],
      weight: null,
      is_on_sale: false,
      sale_price: null,
      state: 'active',
      available_for_ecommerce: false,
      is_featured: false,
      allow_pos_price_override: false,
      tax_category_ids: [],
      service_duration_minutes: null,
      service_modality: null,
      service_pricing_type: null,
      requires_booking: false,
      booking_mode: 'provider_required',
      buffer_minutes: 0,
      is_recurring: false,
      service_instructions: null,
      preparation_time_minutes: null,
      pricing_type: 'unit',
      is_consultation: false,
      send_preconsultation: false,
      consultation_template_id: null,
      preconsultation_template_id: null,
      has_multiple_price_tiers: false,
      stock_uom_id: null,
      purchase_uom_id: null,
      price_unit_quantity: 1,
    };
    const dto: any = { ...fromFile };
    for (const [field, value] of Object.entries(defaults)) {
      if (dto[field] === undefined) dto[field] = value;
    }
    return dto;
  }

  /**
   * Reactiva el producto archivado que coincide por SKU (mismo id: el
   * historial de ventas/facturas/kardex queda intacto) y le aplica el set
   * completo del archivo. `productsService.update` rechaza archivados
   * (PROD_FIND_001), así que primero se cambia el estado por el prisma
   * scoped; si el update falla se compensa devolviendo `archived`.
   */
  private async reactivateArchivedProduct(
    existing: { id: number; state: any },
    productData: BulkProductItemDto,
    storeId: number,
  ): Promise<any> {
    const dto = this.mapToReactivateProductDto(productData);
    const targetState = dto.state;
    // Un destino `archived` no tiene sentido para reactivar: se pasa por
    // `inactive` y el update deja el estado pedido por el archivo.
    const transitionState = targetState === 'archived' ? 'inactive' : targetState;

    // Antes de cambiar el estado: el slug efectivo y el barcode del archivo no
    // pueden estar ocupados por otro producto NO archivado (fila falla limpia,
    // sin P2002 crudo y sin dejar el estado cambiado).
    if (dto.slug) {
      const slugOwner = await this.prisma.products.findFirst({
        where: {
          store_id: storeId,
          slug: dto.slug,
          state: { not: 'archived' },
          id: { not: existing.id },
        },
        select: { id: true, name: true },
      });
      if (slugOwner) {
        throw new VendixHttpException(
          ErrorCodes.PROD_DUP_001,
          `El slug "${dto.slug}" ya lo usa el producto "${slugOwner.name}". Cambia el nombre o la columna slug.`,
        );
      }
    }
    if (dto.barcode) {
      const barcodeOwner = await this.prisma.products.findFirst({
        where: {
          store_id: storeId,
          barcode: dto.barcode,
          state: { not: 'archived' },
          id: { not: existing.id },
        },
        select: { id: true, name: true },
      });
      if (barcodeOwner) {
        throw new VendixHttpException(
          ErrorCodes.PROD_BARCODE_DUP_001,
          `El código de barras "${dto.barcode}" ya lo usa el producto "${barcodeOwner.name}".`,
        );
      }
    }

    await this.prisma.products.updateMany({
      where: { id: existing.id, store_id: storeId },
      data: { state: transitionState, updated_at: new Date() },
    });

    let updated: any;
    try {
      updated = await this.productsService.update(existing.id, dto);

      // Variantes del archivo: emparejar por SKU con las del producto (cualquier
      // estado). Las que el archivo no trae no se tocan.
      if (productData.variants && productData.variants.length > 0) {
        const currentVariants = await this.prisma.product_variants.findMany({
          where: { product_id: existing.id },
          select: { id: true, sku: true },
        });
        const bySku = new Map<string, number>();
        for (const v of currentVariants || []) {
          bySku.set(String(v.sku).toLowerCase(), v.id);
        }
        for (const variantData of productData.variants as any[]) {
          const variantId = variantData?.sku
            ? bySku.get(String(variantData.sku).toLowerCase())
            : undefined;
          if (variantId) {
            await this.productsService.updateVariant(variantId, variantData);
          } else {
            await this.productsService.createVariant(existing.id, variantData);
          }
        }
      }
    } catch (err) {
      await this.prisma.products
        .updateMany({
          where: { id: existing.id, store_id: storeId },
          data: { state: 'archived', updated_at: new Date() },
        })
        .catch((e) =>
          this.logger.error(
            `Compensation (re-archive) failed for product ${existing.id}`,
            e?.stack || e,
          ),
        );
      throw err;
    }

    // Fuera del try: la reactivación ya ocurrió; un fallo de auditoría no
    // debe re-archivar un producto que ya tiene los datos del archivo.
    const context = RequestContextService.getContext();
    await this.prisma.audit_logs
      .create({
        data: {
          user_id: context?.user_id ?? null,
          store_id: storeId,
          organization_id: context?.organization_id ?? null,
          action: 'PRODUCT_REACTIVATE',
          resource: 'products',
          resource_id: existing.id,
          request_id: RequestContextService.getRequestId() ?? null,
          old_values: { state: 'archived' },
          new_values: { state: targetState },
          metadata: { source: 'bulk', event: 'product_reactivated' },
        },
      })
      .catch((e) =>
        this.logger.error(
          `Audit PRODUCT_REACTIVATE failed for product ${existing.id}`,
          e?.stack || e,
        ),
      );

    return updated;
  }

  private mapToUpdateProductDto(product: BulkProductItemDto): any {
    const resolveValue = (val: any) => (val === this.NULL_MARKER ? null : val);

    const dto: any = {};

    const simpleFields = ['name', 'base_price', 'sku', 'state'];

    for (const field of simpleFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    if (product.barcode !== undefined) {
      dto.barcode = resolveValue(product.barcode);
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
      dto.available_for_ecommerce = resolveValue(
        product.available_for_ecommerce,
      );
    }

    if (product.is_featured !== undefined) {
      dto.is_featured = resolveValue(product.is_featured);
    }

    if (product.allow_pos_price_override !== undefined) {
      dto.allow_pos_price_override = resolveValue(
        product.allow_pos_price_override,
      );
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
      'pricing_type',
      'is_consultation',
      'send_preconsultation',
      'consultation_template_id',
      'preconsultation_template_id',
      'has_multiple_price_tiers',
      // Unidades y escala de precio (QUI-648): llegan ya resueltas a FK por
      // `applyUnitColumns`.
      'stock_uom_id',
      'purchase_uom_id',
      'price_unit_quantity',
    ];

    for (const field of newCatalogFields) {
      if (product[field] !== undefined) {
        dto[field] = resolveValue(product[field]);
      }
    }

    if (product.tax_category_ids !== undefined) {
      dto.tax_category_ids =
        product.tax_category_ids === this.NULL_MARKER
          ? []
          : product.tax_category_ids;
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
}
