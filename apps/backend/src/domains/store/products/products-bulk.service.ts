import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { assertVariantsAllowed } from './services/tiers-variants-exclusive.util';
import { AccessValidationService } from '@common/services/access-validation.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { InventoryAdjustmentsService } from '../inventory/adjustments/inventory-adjustments.service';
import { LocationsService } from '../inventory/locations/locations.service';
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
  BulkInitialLoadSummaryDto,
  BulkProductAnalysisItemDto,
  BulkVariantAnalysisItemDto,
  BulkValidationMessage,
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
  private readonly MAX_BATCH_SIZE = 10000;
  private readonly MAX_BARCODE_LENGTH = 64;
  private readonly NULL_MARKER = '__NULL__';
  private readonly CATALOG_ONLY_IGNORED_FIELDS = new Set([
    'stock_by_location',
    'warehouse_code',
    'warehouse_name',
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

  // Claves internas que `parseFile` adjunta a cada producto/variante parseado.
  // Nunca llegan a los DTO de persistencia (los mappers construyen el DTO campo
  // por campo y el helper de variantes las descarta).
  private readonly ROW_NUMBER_KEY = '__row_number';
  private readonly ORPHAN_VARIANT_KEY = '__orphan_variant';
  private readonly IGNORED_FIELDS_KEY = '__ignored_fields';
  private readonly VARIANT_ATTR_SLOTS = [1, 2, 3];

  private readonly INITIAL_LOAD_DESCRIPTION =
    'Carga inicial (carga masiva de productos)';

  private readonly INITIAL_LOAD_AS_COUNT_VARIANCE =
    'La cantidad inicial se aplicará como diferencia de conteo (count_variance): la carga inicial solo permite entradas positivas con existencia previa en 0. Se conserva el costo actual.';

  private initialLoadLocationKey(storeId: number, sessionId: string): string {
    return `tmp/bulk-products/${storeId}/${sessionId}.initial-load.json`;
  }

  private async readSessionInitialLoadLocation(
    storeId: number,
    sessionId: string,
    products: Record<string, any>[],
  ): Promise<number | undefined> {
    if (!products.some((p) => this.hasInitialLoadQuantity(p))) return undefined;
    try {
      const data = JSON.parse(
        (
          await this.s3Service.downloadImage(
            this.initialLoadLocationKey(storeId, sessionId),
          )
        ).toString('utf8'),
      );
      if (Number.isInteger(data.location_id) && data.location_id > 0) {
        return data.location_id;
      }
    } catch {
      // No elegir otra bodega silenciosamente si la sesión es anterior al
      // snapshot, expiró o no se puede leer su metadata.
    }
    throw new BadRequestException(
      'No se pudo recuperar la bodega de esta sesión. Vuelve a analizar el archivo antes de cargar inventario.',
    );
  }

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
    // Variantes (filas hijas de un producto del mismo archivo).
    'SKU Padre': 'parent_sku',
    'Atributo 1': 'attr_name_1',
    'Valor 1': 'attr_value_1',
    'Atributo 2': 'attr_name_2',
    'Valor 2': 'attr_value_2',
    'Atributo 3': 'attr_name_3',
    'Valor 3': 'attr_value_3',
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
    // Variantes: parseFile quita tildes y pasa a minúsculas antes de buscar.
    'sku padre': 'parent_sku',
    'sku del padre': 'parent_sku',
    'sku producto padre': 'parent_sku',
    'parent sku': 'parent_sku',
    'parent_sku': 'parent_sku',
    'atributo 1': 'attr_name_1',
    'atributo1': 'attr_name_1',
    'nombre atributo 1': 'attr_name_1',
    'attribute 1': 'attr_name_1',
    'valor 1': 'attr_value_1',
    'valor1': 'attr_value_1',
    'valor atributo 1': 'attr_value_1',
    'value 1': 'attr_value_1',
    'atributo 2': 'attr_name_2',
    'atributo2': 'attr_name_2',
    'nombre atributo 2': 'attr_name_2',
    'attribute 2': 'attr_name_2',
    'valor 2': 'attr_value_2',
    'valor2': 'attr_value_2',
    'valor atributo 2': 'attr_value_2',
    'value 2': 'attr_value_2',
    'atributo 3': 'attr_name_3',
    'atributo3': 'attr_name_3',
    'nombre atributo 3': 'attr_name_3',
    'attribute 3': 'attr_name_3',
    'valor 3': 'attr_value_3',
    'valor3': 'attr_value_3',
    'valor atributo 3': 'attr_value_3',
    'value 3': 'attr_value_3',
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
    private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
    private readonly locationsService: LocationsService,
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

            // Un SKU numérico (p. ej. 675493067) llega como number desde Excel;
            // todo el flujo lo trata como texto (toLowerCase, match exacto).
            if (key === 'sku' || key === 'parent_sku') {
              product[key] =
                typeof val === 'number' && Number.isInteger(val)
                  ? val.toFixed(0)
                  : strVal;
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
                const label =
                  key === 'base_price'
                    ? 'El precio de venta'
                    : key === 'cost_price'
                      ? 'El precio de compra'
                      : 'El precio de oferta';
                const cellErrors = product[this.CELL_ERRORS_KEY] ?? [];
                cellErrors.push({
                  code: 'INVALID_PRICE',
                  message: `${label} no es un número válido. Escribe solo dígitos y separadores, por ejemplo 5000 o 5.000.`,
                  field: key,
                });
                product[this.CELL_ERRORS_KEY] = cellErrors;
              } else {
                product[key] = parsed;
              }
              hasData = true;
              return;
            }

            if (key === 'stock_quantity') {
              // Cantidad inicial: estricta. Un texto no numérico no se descarta
              // en silencio (el usuario creería que cargó inventario): queda
              // como error de celda y la fila se rechaza en análisis y commit.
              const qty =
                typeof val === 'number'
                  ? val
                  : Number(strVal.replace(/\s/g, '').replace(',', '.'));
              if (Number.isFinite(qty)) {
                product[key] = qty;
              } else {
                const cellErrors = product[this.CELL_ERRORS_KEY] ?? [];
                cellErrors.push({
                  code: 'INVALID_INITIAL_QUANTITY',
                  message:
                    'La cantidad inicial no es un número válido. Escribe solo dígitos, por ejemplo 12 o 3,5.',
                  field: 'stock_quantity',
                });
                product[this.CELL_ERRORS_KEY] = cellErrors;
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

        if (
          hasData &&
          (product['name'] || product['sku'] || product['parent_sku'])
        ) {
          // Fila real de la hoja (1 = encabezado): el análisis y el commit la
          // usan para reportar errores aunque la agrupación reordene filas.
          product[this.ROW_NUMBER_KEY] = i + 1;
          products.push(product);
        }
      }

      return this.groupVariantRows(products);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Error al procesar el archivo: ' + error.message,
      );
    }
  }

  /** Texto de una celda ya parseada: vacío si no hay dato o es el marcador NULL. */
  private cleanCellText(value: unknown): string {
    if (value === undefined || value === null || value === this.NULL_MARKER) {
      return '';
    }
    return String(value).trim();
  }

  /** Etiqueta de columna (encabezado de la plantilla) de una clave de DTO. */
  private columnLabelForKey(key: string): string {
    for (const [label, mapped] of Object.entries(this.HEADER_MAP)) {
      if (mapped === key) return label;
    }
    return this.CATALOG_ONLY_IGNORED_FIELD_LABELS[key] ?? key;
  }

  private stripVariantColumns(row: Record<string, any>): void {
    delete row['parent_sku'];
    for (const n of this.VARIANT_ATTR_SLOTS) {
      delete row[`attr_name_${n}`];
      delete row[`attr_value_${n}`];
    }
  }

  /**
   * Agrupa las filas con `SKU Padre` bajo el producto del archivo cuyo SKU
   * coincide (sin distinguir mayúsculas; el padre puede venir antes o después).
   * Una fila-variante sin padre en el archivo (o cuyo padre es a su vez
   * variante) sale como producto independiente marcado `__orphan_variant` con
   * un error de celda: el análisis la rechaza y el commit la salta.
   * Un archivo sin la columna sale igual que antes (más `__row_number`).
   */
  private groupVariantRows(rows: any[]): any[] {
    const parentBySku = new Map<string, any>();
    for (const row of rows) {
      if (this.cleanCellText(row['parent_sku'])) continue;
      const sku = this.cleanCellText(row['sku']).toLowerCase();
      if (sku && !parentBySku.has(sku)) parentBySku.set(sku, row);
    }

    const out: any[] = [];
    for (const row of rows) {
      const parentSku = this.cleanCellText(row['parent_sku']);
      if (!parentSku) {
        this.stripVariantColumns(row);
        out.push(row);
        continue;
      }

      const parent = parentBySku.get(parentSku.toLowerCase());
      if (!parent) {
        const orphan: Record<string, any> = { ...row };
        this.stripVariantColumns(orphan);
        orphan[this.ORPHAN_VARIANT_KEY] = true;
        orphan[this.CELL_ERRORS_KEY] = [
          ...(Array.isArray(row[this.CELL_ERRORS_KEY])
            ? row[this.CELL_ERRORS_KEY]
            : []),
          {
            code: 'VARIANT_PARENT_NOT_FOUND',
            message: `El SKU Padre "${parentSku}" no corresponde a un producto de este archivo. El producto padre debe estar en otra fila, sin SKU Padre.`,
            field: 'parent_sku',
          },
        ];
        out.push(orphan);
        continue;
      }

      if (!Array.isArray(parent.variants)) parent.variants = [];
      parent.variants.push(this.buildVariantFromRow(row, parent));
    }
    return out;
  }

  private buildVariantFromRow(
    row: Record<string, any>,
    parent: Record<string, any>,
  ): Record<string, any> {
    const attributes: Record<string, string> = {};
    const values: string[] = [];
    for (const n of this.VARIANT_ATTR_SLOTS) {
      const name = this.cleanCellText(row[`attr_name_${n}`]);
      const value = this.cleanCellText(row[`attr_value_${n}`]);
      if (name && value) {
        attributes[name] = value;
        values.push(value);
      }
    }

    // Convención del editor: `<nombre padre> <valor1> <valor2>...`.
    const name =
      this.cleanCellText(row['name']) ||
      `${this.cleanCellText(parent['name'])} ${values.join(' ')}`.trim();

    const variant: Record<string, any> = {
      sku: this.cleanCellText(row['sku']),
      name,
      attributes,
      [this.ROW_NUMBER_KEY]: row[this.ROW_NUMBER_KEY],
    };
    if (row['base_price'] !== undefined && row['base_price'] !== this.NULL_MARKER) {
      variant['price'] = row['base_price'];
    }
    if (typeof row['barcode'] === 'string' && row['barcode'] !== this.NULL_MARKER) {
      variant['barcode'] = row['barcode'];
    }
    if (row['is_on_sale'] !== undefined && row['is_on_sale'] !== this.NULL_MARKER) {
      variant['is_on_sale'] = this.normalizeBooleanValue(row['is_on_sale']);
    }
    if (row['sale_price'] !== undefined && row['sale_price'] !== this.NULL_MARKER) {
      variant['sale_price'] = row['sale_price'];
    }
    if (Array.isArray(row[this.CELL_ERRORS_KEY])) {
      variant[this.CELL_ERRORS_KEY] = row[this.CELL_ERRORS_KEY];
    }

    // Columnas de producto con dato que una fila-variante no usa.
    const applicable = new Set([
      'name',
      'sku',
      'parent_sku',
      'base_price',
      'barcode',
      'is_on_sale',
      'sale_price',
    ]);
    const ignored: string[] = [];
    for (const key of Object.keys(row)) {
      if (key.startsWith('__') || applicable.has(key)) continue;
      if (key.startsWith('attr_name_') || key.startsWith('attr_value_')) continue;
      ignored.push(this.columnLabelForKey(key));
    }
    if (ignored.length > 0) variant[this.IGNORED_FIELDS_KEY] = ignored;

    return variant;
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

  /**
   * Cantidad inicial de una fila ya parseada: `null` si la celda venía vacía
   * (o con el marcador NULL), el número si es válido, `NaN` si no es numérica.
   */
  private readInitialQuantity(product: Record<string, any>): number | null {
    const raw = product?.stock_quantity;
    if (raw === undefined || raw === null || raw === '') return null;
    if (raw === this.NULL_MARKER) return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : Number.NaN;
  }

  /** Precio Compra de la fila como costo unitario de la carga (>= 0), o null. */
  private resolveInitialCost(product: Record<string, any>): number | null {
    const raw = product?.cost_price;
    if (raw === undefined || raw === null || raw === this.NULL_MARKER) {
      return null;
    }
    const parsed = parseMoneyCell(raw);
    return parsed !== null && parsed >= 0 ? parsed : null;
  }

  /** Producto físico sin variantes en el archivo y sin `Controla Inventario = no`. */
  private isInitialLoadCandidate(product: Record<string, any>): boolean {
    if (product?.[this.ORPHAN_VARIANT_KEY]) return false;
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      return false;
    }
    const type = this.cleanCellText(product.product_type).toLowerCase();
    if (type === 'servicio' || type === 'service') return false;
    const tracked = product.track_inventory;
    if (
      tracked !== undefined &&
      tracked !== null &&
      tracked !== '' &&
      tracked !== this.NULL_MARKER &&
      !this.normalizeBooleanValue(tracked)
    ) {
      return false;
    }
    return true;
  }

  /** Fila con cantidad inicial válida (>= 0) que el commit cargaría. */
  private hasInitialLoadQuantity(product: Record<string, any>): boolean {
    const qty = this.readInitialQuantity(product);
    return (
      qty !== null &&
      Number.isFinite(qty) &&
      qty >= 0 &&
      this.isInitialLoadCandidate(product)
    );
  }

  private summarizeInitialLoad(products: any[]): BulkInitialLoadSummaryDto {
    let rows = 0;
    let units = 0;
    for (const p of products) {
      if (!this.hasInitialLoadQuantity(p)) continue;
      rows++;
      units += this.readInitialQuantity(p) as number;
    }
    return {
      rows_with_quantity: rows,
      total_units: units,
      requires_ack: rows > 0,
    };
  }

  /** Lanza PROD_BULK_INITIAL_LOAD_ACK_001 si hay cantidades y no hubo consentimiento. */
  private assertInitialLoadAck(products: any[], ack: boolean | undefined): void {
    if (ack === true) return;
    if (this.summarizeInitialLoad(products).requires_ack) {
      throw new VendixHttpException(ErrorCodes.PROD_BULK_INITIAL_LOAD_ACK_001);
    }
  }

  /**
   * Aplica una cantidad ABSOLUTA: initial_load solo con existencia 0 y entrada
   * positiva; en cualquier otro caso usa count_variance, sin cambiar el costo.
   * `createAdjustment` abre su transacción y emite el evento contable tras el
   * commit. Si el stock actual ya coincide, no hace nada.
   */
  private async applyInitialLoadAdjustment(params: {
    productId: number;
    quantity: number;
    unitCost: number | null;
    locationId: number;
    userId: number | undefined;
  }): Promise<boolean> {
    const current = await this.prisma.stock_levels.findFirst({
      where: {
        product_id: params.productId,
        product_variant_id: null,
        location_id: params.locationId,
      },
      select: { quantity_on_hand: true },
    });
    const quantityBefore = Number(current?.quantity_on_hand ?? 0);
    const initialLoad = quantityBefore === 0 && params.quantity > 0;
    if (quantityBefore === params.quantity) return !initialLoad;

    const adjustment = await this.inventoryAdjustmentsService.createAdjustment(
      {
        product_id: params.productId,
        location_id: params.locationId,
        type: initialLoad ? 'initial_load' : 'count_variance',
        quantity_after: params.quantity,
        ...(initialLoad &&
        params.unitCost !== null &&
        params.unitCost !== undefined
          ? { unit_cost: params.unitCost }
          : {}),
        description: this.INITIAL_LOAD_DESCRIPTION,
      } as any,
      { approvedByUserId: params.userId, initialLoadFallback: true },
    );
    return !initialLoad || adjustment.adjustment_type === 'count_variance';
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

    // Snapshot durable por sesión, compartido por análisis y todas las páginas.
    // No volver a resolver el default en cada commit: podría cambiar a mitad
    // del archivo y repartir el inventario entre bodegas distintas.
    let initialLoadLocationId: number | undefined;
    const initialStockByProduct = new Map<number, number>();
    if (products.some((p) => this.hasInitialLoadQuantity(p))) {
      const location = await this.locationsService.getDefaultLocation(storeId);
      if (!location?.id) throw new VendixHttpException(ErrorCodes.INV_FIND_001);
      initialLoadLocationId = Number(location.id);
      const stocks = await this.prisma.stock_levels.findMany({
        where: { location_id: initialLoadLocationId, product_variant_id: null },
        select: { product_id: true, quantity_on_hand: true },
      });
      for (const stock of stocks) {
        initialStockByProduct.set(
          stock.product_id,
          Number(stock.quantity_on_hand),
        );
      }
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
        cost_price: true,
      },
    });
    const skuMap = new Map<
      string,
      { id: number; name: string; archived: boolean; ts: number; cost: number }
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
          skuMap.set(key, {
            id: p.id,
            name: p.name,
            archived,
            ts,
            cost: Number(p.cost_price ?? 0),
          });
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

    // 5c. Variantes: una sola consulta con los SKU de variante del archivo.
    const fileVariantSkus = new Set<string>();
    for (const p of products) {
      for (const v of p.variants ?? []) {
        const sku = this.cleanCellText(v.sku);
        if (sku) fileVariantSkus.add(sku);
      }
    }
    const variantOwners = await this.loadVariantSkuOwners(
      Array.from(fileVariantSkus),
      storeId,
    );
    const fileProductSkus = new Set<string>();
    for (const p of products) {
      const sku = this.cleanCellText(p.sku).toLowerCase();
      if (sku) fileProductSkus.add(sku);
    }
    const seenVariantSkus = new Map<string, number>(); // sku -> primera fila
    let totalVariants = 0;

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
      const parsedCostPrice =
        product.cost_price === undefined ||
        product.cost_price === this.NULL_MARKER
          ? null
          : parseMoneyCell(product.cost_price);
      const initialQty = this.readInitialQuantity(product);
      const item: BulkProductAnalysisItemDto = {
        // Fila real de la hoja (la agrupación de variantes ya no la preserva
        // por posición); `i + 2` solo para filas que no pasaron por parseFile.
        row_number: products[i][this.ROW_NUMBER_KEY] ?? i + 2,
        name: product.name || '',
        sku: product.sku || '',
        barcode:
          typeof product.barcode === 'string' &&
          product.barcode !== this.NULL_MARKER
            ? product.barcode
            : undefined,
        product_type: 'physical',
        base_price: parsedBasePrice ?? 0,
        cost_price: parsedCostPrice !== null && parsedCostPrice >= 0 ? parsedCostPrice : 0,
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
          message: `Se ignoraron columnas exclusivas de inventario (${this.formatIgnoredCatalogFields(ignoredCatalogFields)}). Estas columnas no se cargan desde aquí; las ubicaciones, mínimos y lotes se gestionan desde Inventario.`,
          field: ignoredCatalogFields[0],
        });
      }

      // Cantidad inicial (carga inicial de inventario): sólo aplica a producto
      // físico sin variantes que controla inventario.
      if (initialQty !== null) {
        if (!Number.isFinite(initialQty)) {
          // La celda no numérica ya viaja como error de celda desde parseFile.
        } else if (initialQty < 0) {
          item.errors.push({
            code: 'INVALID_INITIAL_QUANTITY',
            message: 'La cantidad inicial no puede ser negativa',
            field: 'stock_quantity',
          });
        } else if (
          Array.isArray(product.variants) &&
          product.variants.length > 0
        ) {
          item.warnings.push({
            code: 'INITIAL_QUANTITY_NOT_FOR_VARIANTS',
            message:
              'La cantidad inicial no aplica a productos con variantes; usa el ajuste masivo con el SKU de cada variante',
            field: 'stock_quantity',
          });
        } else if (this.isInitialLoadCandidate(product)) {
          item.stock_quantity = initialQty;
        }
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
      const hasPriceCellError = cellErrors.some(
        (e) => e.field === 'base_price',
      );
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

      const hasInventoryQuantity = this.hasInitialLoadQuantity(product);
      const quantityBefore =
        item.existing_product_id === undefined
          ? 0
          : (initialStockByProduct.get(item.existing_product_id) ?? 0);
      const validInitialLoad =
        hasInventoryQuantity && quantityBefore === 0 && (initialQty ?? 0) > 0;
      const ignoreExistingCost = item.action !== 'create' && !validInitialLoad;
      if (
        ignoreExistingCost &&
        (product.cost_price !== undefined ||
          cellErrors.some((e) => e.field === 'cost_price'))
      ) {
        item.warnings.push({
          code: 'EXISTING_COST_IGNORED',
          message:
            'Se ignoró Precio Compra: el costo de productos existentes solo se modifica con una carga inicial válida (existencia 0 y entrada positiva).',
          field: 'cost_price',
        });
        item.cost_price = skuMap.get(item.sku.toLowerCase())?.cost ?? 0;
      }
      for (const cellError of cellErrors) {
        if (ignoreExistingCost && cellError.field === 'cost_price') continue;
        item.errors.push(cellError);
      }
      if (hasInventoryQuantity && !validInitialLoad) {
        item.warnings.push({
          code: 'INITIAL_LOAD_AS_COUNT_VARIANCE',
          message: this.INITIAL_LOAD_AS_COUNT_VARIANCE,
          field: 'stock_quantity',
        });
      }
      const catalogCost = skuMap.get(item.sku.toLowerCase())?.cost ?? 0;
      const effectiveCost = ignoreExistingCost
        ? catalogCost
        : this.resolveInitialCost(product) ?? catalogCost;
      if (validInitialLoad) item.cost_price = effectiveCost;
      if (
        (item.action === 'create' || hasInventoryQuantity) &&
        item.product_type === 'physical' &&
        effectiveCost <= 0
      ) {
        item.warnings.push({
          code: 'MISSING_INITIAL_COST',
          message:
            'No se informó un Precio Compra mayor a 0. Los productos nuevos sin costo quedarán valorados en 0; revisa el costo antes de confirmar la carga.',
          field: 'cost_price',
        });
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

      // Variantes colgadas de este producto (filas con SKU Padre).
      let variantsHaveErrors = false;
      let variantsHaveWarnings = false;
      if (Array.isArray(product.variants) && product.variants.length > 0) {
        const analyzed = this.analyzeVariants(product.variants, {
          parentExistingId: item.existing_product_id,
          parentBasePrice: parsedBasePrice,
          fileProductSkus,
          seenVariantSkus,
          existingProductSkus: skuMap,
          variantOwners,
        });
        item.variants = analyzed;
        totalVariants += analyzed.length;
        variantsHaveErrors = analyzed.some((v) => v.status === 'error');
        variantsHaveWarnings = analyzed.some((v) => v.status === 'warning');

        // `createVariant` exige producto activo: variantes nuevas sobre un
        // producto existente cuyo Estado del archivo es inactivo fallarían.
        if (
          item.existing_product_id !== undefined &&
          this.isInactiveStateCell(product.state) &&
          analyzed.some((v) => v.action === 'create')
        ) {
          item.errors.push({
            code: 'VARIANTS_ON_INACTIVE_PRODUCT',
            message:
              'No se pueden agregar variantes a un producto inactivo. Activa el producto o quita las variantes nuevas.',
            field: 'state',
          });
        }

        // Multitarifa ⊕ variantes: excluyentes (misma regla que `create`).
        if (
          product.has_multiple_price_tiers !== undefined &&
          product.has_multiple_price_tiers !== this.NULL_MARKER &&
          this.normalizeBooleanValue(product.has_multiple_price_tiers)
        ) {
          item.errors.push({
            code: 'VARIANTS_WITH_PRICE_TIERS',
            message:
              'Un producto no puede usar listas de precio y tener variantes a la vez. Quita las variantes o desactiva "Usa Listas de Precio".',
            field: 'has_multiple_price_tiers',
          });
        }
      }

      // Determine final status
      if (item.errors.length > 0 || variantsHaveErrors) {
        item.status = 'error';
        withErrors++;
      } else if (item.warnings.length > 0 || variantsHaveWarnings) {
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
    if (initialLoadLocationId !== undefined) {
      await this.s3Service.uploadFile(
        Buffer.from(JSON.stringify({ location_id: initialLoadLocationId })),
        this.initialLoadLocationKey(storeId, sessionId),
        'application/json',
      );
    }

    // 8. Return analysis result
    return {
      session_id: sessionId,
      total_products: products.length,
      total_variants: totalVariants,
      ready,
      with_warnings: withWarnings,
      with_errors: withErrors,
      products: analysisItems,
      initial_load: this.summarizeInitialLoad(products),
    };
  }

  /**
   * Resuelve a qué producto activo de la tienda pertenece cada SKU de variante
   * del archivo: UNA consulta sobre el set completo. Un producto archivado no
   * ocupa el SKU (misma regla que el código de barras).
   */
  private async loadVariantSkuOwners(
    skus: string[],
    storeId: number,
  ): Promise<Map<string, { product_id: number; product_name?: string }>> {
    const owners = new Map<string, { product_id: number; product_name?: string }>();
    if (skus.length === 0) return owners;
    const rows = await this.prisma.product_variants.findMany({
      where: {
        sku: { in: skus },
        products: { store_id: storeId, state: { not: 'archived' } },
      },
      select: {
        sku: true,
        product_id: true,
        products: { select: { name: true } },
      },
    });
    for (const r of rows || []) {
      owners.set(String(r.sku).toLowerCase(), {
        product_id: r.product_id,
        product_name: r.products?.name,
      });
    }
    return owners;
  }

  /** Clave normalizada (sin tildes, minúsculas) de una combinación de atributos. */
  private variantAttributesKey(attributes: Record<string, string>): string {
    const norm = (t: string) =>
      t
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return JSON.stringify(
      Object.entries(attributes)
        .map(([k, v]) => [norm(k), norm(String(v))])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    );
  }

  /**
   * Validación de variantes que NO depende de la base de datos: atributos,
   * combinación repetida, SKU (vacío / repetido en el archivo o igual al de un
   * producto del archivo), precio, oferta y errores de celda de la fila.
   * La comparten el análisis y el commit, para que un archivo que el análisis
   * rechaza no se pueda crear igual. `onSku` deja al llamador insertar sus
   * chequeos contra la BD justo después de los de SKU (orden de errores estable).
   */
  private validateVariantRows(
    variants: any[],
    ctx: {
      parentBasePrice: number | null;
      fileProductSkus: Set<string>;
      seenVariantSkus: Map<string, number>;
      onSku?: (
        skuLower: string,
        errors: (string | BulkValidationMessage)[],
      ) => void;
    },
  ): {
    sku: string;
    attributes: Record<string, string>;
    price: number | null;
    rowNumber: number;
    errors: (string | BulkValidationMessage)[];
    warnings: (string | BulkValidationMessage)[];
  }[] {
    const seenCombos = new Set<string>();
    const out: ReturnType<ProductsBulkService['validateVariantRows']> = [];

    for (const v of variants) {
      const errors: (string | BulkValidationMessage)[] = [];
      const warnings: (string | BulkValidationMessage)[] = [];
      const sku = this.cleanCellText(v.sku);
      const attributes: Record<string, string> =
        v.attributes && typeof v.attributes === 'object' ? v.attributes : {};
      const rowNumber: number = v[this.ROW_NUMBER_KEY] ?? 0;

      if (Object.keys(attributes).length === 0) {
        errors.push({
          code: 'VARIANT_NO_ATTRIBUTES',
          message:
            'La variante necesita al menos un par Atributo/Valor (por ejemplo Color = Negro).',
          field: 'attributes',
        });
      } else {
        const combo = this.variantAttributesKey(attributes);
        if (seenCombos.has(combo)) {
          errors.push({
            code: 'VARIANT_DUPLICATE_ATTRIBUTES',
            message:
              'Otra variante de este producto tiene la misma combinación de atributos.',
            field: 'attributes',
          });
        } else {
          seenCombos.add(combo);
        }
      }

      if (!sku) {
        errors.push({
          code: 'VARIANT_SKU_REQUIRED',
          message: 'El SKU de la variante es obligatorio.',
          field: 'sku',
        });
      } else {
        const skuLower = sku.toLowerCase();
        const firstRow = ctx.seenVariantSkus.get(skuLower);
        if (firstRow !== undefined) {
          errors.push({
            code: 'VARIANT_DUPLICATE_SKU',
            message: `SKU de variante repetido en el archivo (primera aparición en fila ${firstRow}).`,
            field: 'sku',
          });
        } else {
          ctx.seenVariantSkus.set(skuLower, rowNumber);
          if (ctx.fileProductSkus.has(skuLower)) {
            errors.push({
              code: 'VARIANT_DUPLICATE_SKU',
              message:
                'El SKU de la variante coincide con el SKU de un producto del archivo.',
              field: 'sku',
            });
          }
        }
        ctx.onSku?.(skuLower, errors);
      }

      // Precio: vacío = hereda del padre; si viene debe ser un número > 0.
      const cellErrors: { code: string; message: string; field?: string }[] =
        Array.isArray(v[this.CELL_ERRORS_KEY]) ? v[this.CELL_ERRORS_KEY] : [];
      for (const cellError of cellErrors) errors.push(cellError);
      let price: number | null = null;
      if (v.price !== undefined) {
        const parsed = parseMoneyCell(v.price);
        if (parsed === null || parsed <= 0) {
          if (!cellErrors.some((e) => e.field === 'base_price')) {
            errors.push({
              code: 'INVALID_PRICE',
              message:
                'El precio de la variante debe ser un número mayor que 0, o dejarse vacío para heredar el del producto.',
              field: 'price',
            });
          }
        } else {
          price = parsed;
        }
      }
      if (v.is_on_sale === true) {
        const sale =
          v.sale_price === undefined ? null : parseMoneyCell(v.sale_price);
        const reference = price ?? ctx.parentBasePrice;
        if (
          sale === null ||
          sale <= 0 ||
          (reference !== null && sale >= reference)
        ) {
          errors.push({
            code: 'VARIANT_SALE_PRICE_INVALID',
            message:
              'Una variante en oferta necesita un precio de oferta mayor que 0 y menor que su precio.',
            field: 'sale_price',
          });
        }
      }

      const ignored: string[] = Array.isArray(v[this.IGNORED_FIELDS_KEY])
        ? v[this.IGNORED_FIELDS_KEY]
        : [];
      if (ignored.length > 0) {
        warnings.push({
          code: 'VARIANT_IGNORED_FIELDS',
          message: `Se ignoraron columnas de producto en una fila-variante (${ignored.join(', ')}). Se definen en la fila del producto padre.`,
          field: ignored[0],
        });
      }

      out.push({ sku, attributes, price, rowNumber, errors, warnings });
    }
    return out;
  }

  /**
   * Regla ÚNICA de colisión de SKU de variante contra la BD (análisis y
   * commit): el SKU no puede pertenecer a un producto activo de la tienda ni a
   * una variante de OTRO producto. Una variante del MISMO producto (padre
   * existente) con ese SKU no es colisión: es el upsert por SKU.
   */
  private buildVariantSkuDbChecks(ctx: {
    parentExistingId?: number;
    existingProductSkus: Map<string, { id: number; archived: boolean }>;
    variantOwners: Map<string, { product_id: number; product_name?: string }>;
  }) {
    const isTakenByProduct = (skuLower: string) => {
      const owner = ctx.existingProductSkus.get(skuLower);
      return !!owner && !owner.archived;
    };
    const isOwnVariant = (skuLower: string) => {
      const owner = ctx.variantOwners.get(skuLower);
      return (
        !!owner &&
        ctx.parentExistingId !== undefined &&
        owner.product_id === ctx.parentExistingId
      );
    };
    const onSku = (
      skuLower: string,
      errors: (string | BulkValidationMessage)[],
    ) => {
      if (isTakenByProduct(skuLower)) {
        errors.push({
          code: 'VARIANT_SKU_TAKEN',
          message: 'El SKU de la variante ya lo usa un producto de la tienda.',
          field: 'sku',
        });
        return;
      }
      const variantOwner = ctx.variantOwners.get(skuLower);
      if (variantOwner && !isOwnVariant(skuLower)) {
        const ownerName = variantOwner.product_name
          ? ` del producto "${variantOwner.product_name}"`
          : ' de otro producto';
        errors.push({
          code: 'VARIANT_SKU_TAKEN',
          message: `El SKU de la variante ya lo usa una variante${ownerName} de la tienda.`,
          field: 'sku',
        });
      }
    };
    return { isTakenByProduct, isOwnVariant, onSku };
  }

  private analyzeVariants(
    variants: any[],
    ctx: {
      parentExistingId?: number;
      parentBasePrice: number | null;
      fileProductSkus: Set<string>;
      seenVariantSkus: Map<string, number>;
      existingProductSkus: Map<string, { id: number; archived: boolean }>;
      variantOwners: Map<string, { product_id: number; product_name?: string }>;
    },
  ): BulkVariantAnalysisItemDto[] {
    const { isTakenByProduct, isOwnVariant, onSku } =
      this.buildVariantSkuDbChecks(ctx);

    const validated = this.validateVariantRows(variants, {
      parentBasePrice: ctx.parentBasePrice,
      fileProductSkus: ctx.fileProductSkus,
      seenVariantSkus: ctx.seenVariantSkus,
      onSku,
    });

    return validated.map((r, i) => {
      const skuLower = r.sku.toLowerCase();
      return {
        row_number: r.rowNumber,
        sku: r.sku,
        name: variants[i].name || '',
        attributes: r.attributes,
        price: r.price,
        action:
          r.sku && !isTakenByProduct(skuLower) && isOwnVariant(skuLower)
            ? 'update'
            : 'create',
        status:
          r.errors.length > 0
            ? 'error'
            : r.warnings.length > 0
              ? 'warning'
              : 'ready',
        warnings: r.warnings,
        errors: r.errors,
      };
    });
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
    options: { initialLoadAck?: boolean } = {},
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
      const limit = Math.min(
        page.limit ?? MAX_BULK_UPLOAD_PAGE,
        MAX_BULK_UPLOAD_PAGE,
      );

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

      // Consentimiento sobre el archivo COMPLETO (no sobre la página): se
      // exige en cualquier página, antes de escribir nada.
      this.assertInitialLoadAck(all, options.initialLoadAck);

      const initialLoadLocationId = await this.readSessionInitialLoadLocation(
        storeId,
        sessionId,
        all,
      );

      const result = await this.uploadProducts(
        { products: all.slice(offset, offset + limit) },
        user,
        {
          rowOffset: offset,
          initialLoad: options.initialLoadAck === true,
          initialLoadLocationId,
        },
      );
      const done = offset + limit >= total;
      if (done) {
        try {
          await this.s3Service.deleteFile(s3Key);
          if (initialLoadLocationId !== undefined) {
            await this.s3Service.deleteFile(
              this.initialLoadLocationKey(storeId, sessionId),
            );
          }
        } catch (e) {
          // Silent cleanup failure
        }
      }
      return { ...result, total, offset, limit, done };
    }

    // Fuera del try: si falta el consentimiento el archivo temporal se conserva
    // para que el cliente reintente con `initial_load_ack`.
    const products = this.parseFile(fileBuffer);
    this.assertInitialLoadAck(products, options.initialLoadAck);
    const initialLoadLocationId = await this.readSessionInitialLoadLocation(
      storeId,
      sessionId,
      products,
    );

    try {
      const result = await this.uploadProducts({ products }, user, {
        initialLoad: options.initialLoadAck === true,
        initialLoadLocationId,
      });
      return result;
    } finally {
      // Clean up temp file
      try {
        await this.s3Service.deleteFile(s3Key);
        if (initialLoadLocationId !== undefined) {
          await this.s3Service.deleteFile(
            this.initialLoadLocationKey(storeId, sessionId),
          );
        }
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
      await this.s3Service.deleteFile(
        this.initialLoadLocationKey(storeId, sessionId),
      );
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
      // Carga inicial de inventario (opcionales). "Cantidad Inicial" es el
      // saldo ABSOLUTO de la ubicación por defecto y exige consentimiento al
      // confirmar la carga; "Precio Compra" es el costo del producto.
      'Cantidad Inicial',
      'Precio Compra',
      // Unidades (QUI-648). Una fila sin estas columnas se importa con los
      // valores de siempre, así que las plantillas viejas siguen sirviendo.
      'Unidad de stock',
      'Unidad de compra',
      'Precio por N unidades',
      // Variantes: una fila con `SKU Padre` cuelga del producto de ese SKU.
      // Van al final, así que una plantilla vieja sigue sirviendo igual.
      'SKU Padre',
      'Atributo 1',
      'Valor 1',
      'Atributo 2',
      'Valor 2',
      'Atributo 3',
      'Valor 3',
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
              'Cantidad Inicial': 24,
              'Precio Compra': 52000,
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
              'Cantidad Inicial': 120,
              'Precio Compra': 3800,
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
            // Familia con variantes: el padre define el producto; cada fila con
            // `SKU Padre` es una variante (SKU y precio propios; sin precio
            // hereda el del padre).
            {
              Nombre: 'Camiseta Básica',
              SKU: 'CAM-BAS',
              Tipo: 'físico',
              Estado: 'activo',
              'Controla Inventario': 'sí',
              'Precio Venta': 45000,
              Descripción: 'Camiseta de algodón en varios colores y tallas.',
              Categorías: 'Ropa',
              'Disponible Ecommerce': 'sí',
            },
            {
              'SKU Padre': 'CAM-BAS',
              SKU: 'CAM-BAS-NEG-M',
              'Atributo 1': 'Color',
              'Valor 1': 'Negro',
              'Atributo 2': 'Talla',
              'Valor 2': 'M',
            },
            {
              'SKU Padre': 'CAM-BAS',
              SKU: 'CAM-BAS-BLA-L',
              'Precio Venta': 49000,
              'Atributo 1': 'Color',
              'Valor 1': 'Blanco',
              'Atributo 2': 'Talla',
              'Valor 2': 'L',
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
      // 'Precio Compra' ya viaja en los encabezados base. El export NO rellena
      // 'Cantidad Inicial' (re-subirlo no debe re-cargar inventario).
      const extraHeaders = ['Cantidad Actual', 'Tiene Imagen'];
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
              product_variants: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  barcode: true,
                  price_override: true,
                  attributes: true,
                },
                orderBy: { id: 'asc' },
              },
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

          // Una fila por variante justo después de su padre: round-trip con la
          // carga masiva (SKU Padre + hasta 3 pares Atributo/Valor).
          if (hasVariants && Array.isArray(p.product_variants)) {
            if (!p.sku) {
              this.logger.warn(
                `[exportCurrentProductsAsTemplate] product ${p.id} has variants but no SKU: variant rows omitted (SKU Padre would be empty)`,
              );
            } else {
              for (const v of p.product_variants) {
                rows.push(this.buildVariantExportRow(p, v));
              }
            }
          }
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

  /** Producto del archivo con `Usa Listas de Precio` = sí (ignora NULL). */
  private fileEnablesPriceTiers(product: any): boolean {
    const v = product?.has_multiple_price_tiers;
    return (
      v !== undefined &&
      v !== null &&
      v !== this.NULL_MARKER &&
      this.normalizeBooleanValue(v)
    );
  }

  private isInactiveStateCell(state: unknown): boolean {
    if (typeof state !== 'string') return false;
    return ['inactivo', 'inactive', 'deshabilitado'].includes(
      state.trim().toLowerCase(),
    );
  }

  /**
   * Datos de BD para validar variantes en el commit con la MISMA regla que el
   * análisis: dueños de SKU de variante (1 consulta) y productos de la tienda
   * por SKU (1 consulta: SKUs de variante para VARIANT_SKU_TAKEN + SKUs de los
   * padres para saber el id existente). Sin variantes parseadas en la página no
   * consulta nada.
   */
  private async loadVariantCommitContext(
    products: any[],
    storeId: number,
  ): Promise<{
    existingProductSkus: Map<string, { id: number; archived: boolean }>;
    variantOwners: Map<string, { product_id: number; product_name?: string }>;
  } | null> {
    const variantSkus = new Set<string>();
    const parentSkus = new Set<string>();
    for (const p of products) {
      const vs = (Array.isArray(p?.variants) ? p.variants : []).filter(
        (v: any) => v?.[this.ROW_NUMBER_KEY] !== undefined,
      );
      if (vs.length === 0) continue;
      const parentSku = this.cleanCellText(p.sku);
      if (parentSku) parentSkus.add(parentSku);
      for (const v of vs) {
        const sku = this.cleanCellText(v.sku);
        if (sku) variantSkus.add(sku);
      }
    }
    if (variantSkus.size === 0) return null;

    const variantOwners = await this.loadVariantSkuOwners(
      Array.from(variantSkus),
      storeId,
    );
    const rows = await this.prisma.products.findMany({
      where: {
        store_id: storeId,
        sku: { in: Array.from(new Set([...variantSkus, ...parentSkus])) },
      },
      select: { id: true, sku: true, state: true },
    });
    const existingProductSkus = new Map<
      string,
      { id: number; archived: boolean }
    >();
    for (const r of rows || []) {
      if (!r.sku) continue;
      const key = String(r.sku).toLowerCase();
      const archived = r.state === 'archived';
      const prev = existingProductSkus.get(key);
      // Gana el no archivado (el commit actualiza ese).
      if (!prev || (prev.archived && !archived)) {
        existingProductSkus.set(key, { id: r.id, archived });
      }
    }
    return { existingProductSkus, variantOwners };
  }

  /**
   * Rechaza (BadRequestException con el primer error, prefijado con la fila de
   * la variante) un producto cuyas variantes del archivo no pasan la validación
   * pura. Solo valida variantes parseadas (llevan `__row_number`); las que
   * llegan por el API legacy las valida `ProductsService`. Incluye multitarifa
   * del archivo ⊕ variantes.
   */
  private assertFileVariantsValid(
    product: any,
    fileProductSkus: Set<string>,
    seenVariantSkus: Map<string, number>,
    dbCtx?: {
      existingProductSkus: Map<string, { id: number; archived: boolean }>;
      variantOwners: Map<
        string,
        { product_id: number; product_name?: string }
      >;
    } | null,
  ): void {
    const variants = (
      Array.isArray(product?.variants) ? product.variants : []
    ).filter((v: any) => v?.[this.ROW_NUMBER_KEY] !== undefined);
    if (variants.length === 0) return;

    if (this.fileEnablesPriceTiers(product)) {
      throw new BadRequestException(
        'Un producto no puede usar listas de precio y tener variantes a la vez.',
      );
    }

    // Mismo chequeo contra la BD que el análisis. El padre existente (activo)
    // permite que sus propias variantes se upserteen por SKU sin colisión.
    const parentOwner = dbCtx?.existingProductSkus.get(
      this.cleanCellText(product.sku).toLowerCase(),
    );
    const onSku = dbCtx
      ? this.buildVariantSkuDbChecks({
          parentExistingId:
            parentOwner && !parentOwner.archived ? parentOwner.id : undefined,
          existingProductSkus: dbCtx.existingProductSkus,
          variantOwners: dbCtx.variantOwners,
        }).onSku
      : undefined;

    const validated = this.validateVariantRows(variants, {
      parentBasePrice: parseMoneyCell(product.base_price),
      fileProductSkus,
      seenVariantSkus,
      onSku,
    });
    for (const r of validated) {
      const first = r.errors[0];
      if (first) {
        throw new BadRequestException(
          `Variante fila ${r.rowNumber}: ${typeof first === 'string' ? first : first.message}`,
        );
      }
    }
  }

  /**
   * `createVariant` exige producto ACTIVE y el update + upsert no son atómicos:
   * si el estado resultante (Estado del archivo, o el actual si no lo trae) no
   * es activo y la fila trae variantes NUEVAS, falla la fila ANTES del update.
   * (No replica el bloqueo por insumo de receta/reserva de `createVariant`.)
   */
  private async assertNoNewVariantsOnInactive(
    existingProduct: { id: number; state: any },
    productData: any,
  ): Promise<void> {
    const variants = Array.isArray(productData?.variants)
      ? productData.variants
      : [];
    if (variants.length === 0) return;
    const resulting =
      typeof productData.state === 'string' && productData.state
        ? productData.state
        : existingProduct.state;
    if (resulting === 'active') return;

    const current = await this.prisma.product_variants.findMany({
      where: { product_id: existingProduct.id },
      select: { sku: true },
    });
    const have = new Set(
      (current || []).map((v: any) => String(v.sku).toLowerCase()),
    );
    const hasNew = variants.some(
      (v: any) => !have.has(this.cleanCellText(v.sku).toLowerCase()),
    );
    if (hasNew) {
      throw new BadRequestException(
        'No se pueden agregar variantes a un producto inactivo.',
      );
    }
  }

  /**
   * Guarda multitarifa ⊕ variantes para un producto EXISTENTE al que el
   * archivo le agrega/actualiza variantes. `create` ya la aplica en su flujo;
   * `update` no ve las variantes, y `createVariant` no la aplica.
   */
  private async assertVariantsAllowedOnExisting(
    productId: number,
    productData: any,
  ): Promise<void> {
    if (!Array.isArray(productData?.variants) || productData.variants.length === 0) {
      return;
    }
    // El archivo apaga multitarifa explícitamente: el update lo hará antes.
    const v = productData.has_multiple_price_tiers;
    if (
      v !== undefined &&
      v !== this.NULL_MARKER &&
      !this.normalizeBooleanValue(v)
    ) {
      return;
    }
    await assertVariantsAllowed(this.prisma as any, productId, {
      action: 'bulk_upsert_variants',
    });
  }

  /** Fila de export de una variante (columnas de plantilla; el resto vacío). */
  private buildVariantExportRow(
    parent: { id: number; sku: string },
    variant: {
      sku: string;
      name?: string | null;
      barcode?: string | null;
      price_override?: unknown;
      attributes?: unknown;
    },
  ): Record<string, any> {
    const attrs =
      variant.attributes &&
      typeof variant.attributes === 'object' &&
      !Array.isArray(variant.attributes)
        ? Object.entries(variant.attributes as Record<string, unknown>)
        : [];
    if (attrs.length > this.VARIANT_ATTR_SLOTS.length) {
      this.logger.warn(
        `[exportCurrentProductsAsTemplate] variant ${variant.sku} of product ${parent.id} has ${attrs.length} attributes: only the first ${this.VARIANT_ATTR_SLOTS.length} are exported`,
      );
    }
    const row: Record<string, any> = {
      'SKU Padre': parent.sku,
      SKU: variant.sku,
      Nombre: variant.name ?? '',
      'Precio Venta':
        variant.price_override !== null && variant.price_override !== undefined
          ? Number(variant.price_override)
          : '',
      'Código de barras': variant.barcode ?? '',
    };
    this.VARIANT_ATTR_SLOTS.forEach((n, idx) => {
      const pair = attrs[idx];
      if (!pair) return;
      row[`Atributo ${n}`] = pair[0];
      row[`Valor ${n}`] = String(pair[1] ?? '');
    });
    return row;
  }

  /**
   * Procesa la carga masiva de productos
   */
  async uploadProducts(
    bulkUploadDto: BulkProductUploadDto,
    user: any,
    options: {
      rowOffset?: number;
      initialLoad?: boolean;
      initialLoadLocationId?: number;
    } = {},
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

    // Carga inicial: sólo con consentimiento (`options.initialLoad`). La
    // Las sesiones reutilizan el snapshot del análisis. El método directo
    // resuelve el default solo una vez por lote.
    const initialLoadEnabled =
      options.initialLoad === true &&
      (products as any[]).some((p) => this.hasInitialLoadQuantity(p));
    let initialLoadLocationId: number | null =
      options.initialLoadLocationId ?? null;
    if (initialLoadEnabled && initialLoadLocationId === null) {
      const defaultLocation =
        await this.locationsService.getDefaultLocation(storeId);
      if (!defaultLocation?.id) {
        throw new VendixHttpException(ErrorCodes.INV_FIND_001);
      }
      initialLoadLocationId = Number(defaultLocation.id);
    }

    const results: BulkUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    // Alcance de la validación de variantes en commit: el lote recibido (la
    // página) para duplicados dentro del archivo. Entre páginas, y contra el
    // resto de la tienda, el SKU se verifica contra la BD con la misma regla
    // del análisis (la BD solo tiene @@unique([product_id, sku])).
    const fileProductSkus = new Set<string>();
    for (const p of products) {
      const sku = this.cleanCellText((p as any).sku).toLowerCase();
      if (sku) fileProductSkus.add(sku);
    }
    const seenVariantSkus = new Map<string, number>();
    const variantDbCtx = await this.loadVariantCommitContext(
      products as any[],
      storeId,
    );

    for (let rowIndex = 0; rowIndex < products.length; rowIndex++) {
      const productData = products[rowIndex];
      // Fila real de la hoja si el producto viene de parseFile (la agrupación
      // de variantes rompe la posición); si no, posición + rowOffset de la
      // página de la sesión (header = fila 1).
      const rowNumber =
        (productData as any)[this.ROW_NUMBER_KEY] ??
        rowOffset + rowIndex + 2;
      try {
        const rowWarnings: string[] = [];
        // Variante huérfana (su SKU Padre no está en el archivo): el análisis
        // ya la marcó como error; el commit no crea un producto con ella.
        if ((productData as any)[this.ORPHAN_VARIANT_KEY]) {
          results.push({
            row_number: rowNumber,
            product_name: productData.name || undefined,
            sku: productData.sku || undefined,
            product: null,
            status: 'skipped',
            message:
              'Fila omitida: su SKU Padre no corresponde a un producto del archivo.',
            error_code: 'VARIANT_PARENT_NOT_FOUND',
          });
          skipped++;
          continue;
        }

        // Celda de código de barras inválida (notación científica / >64):
        // se rechaza la fila en vez de crearla sin el código.
        const barcodeCellError = (
          (productData as any)[this.CELL_ERRORS_KEY] as
            | { field?: string; message: string }[]
            | undefined
        )?.find((e) => e.field === 'barcode' || e.field === 'stock_quantity');
        if (barcodeCellError) {
          throw new BadRequestException(barcodeCellError.message);
        }

        // Variantes del archivo: misma validación pura que el análisis. El
        // commit procesa todo el archivo de la sesión (no solo filas 'ready'),
        // así que sin esto se crearían variantes sin atributos o repetidas.
        this.assertFileVariantsValid(
          productData as any,
          fileProductSkus,
          seenVariantSkus,
          variantDbCtx,
        );

        // La cantidad inicial NUNCA viaja a ProductsService.create/update: el
        // stock entra sólo por el ajuste `initial_load`. Se lee y se retira de
        // la fila antes de armar cualquier DTO.
        const rawInitialQty = this.readInitialQuantity(productData as any);
        const fileInitialCandidate = this.isInitialLoadCandidate(
          productData as any,
        );
        delete (productData as any).stock_quantity;
        if (
          options.initialLoad === true &&
          rawInitialQty !== null &&
          (!Number.isFinite(rawInitialQty) || rawInitialQty < 0)
        ) {
          throw new BadRequestException(
            'La cantidad inicial debe ser un número mayor o igual a 0',
          );
        }
        const initialQty =
          initialLoadEnabled &&
          initialLoadLocationId !== null &&
          rawInitialQty !== null &&
          fileInitialCandidate
            ? rawInitialQty
            : null;
        const initialCost = this.resolveInitialCost(productData as any);

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

        // Elegibilidad final de la carga inicial (producto existente incluido):
        // servicios y productos que no controlan inventario ignoran la
        // cantidad; un producto con variantes en la BD la rechaza ANTES de
        // escribir (stock base en un producto con variantes queda en una fila
        // muerta, QUI-486).
        let loadQty: number | null = initialQty;
        if (loadQty !== null && existingProduct) {
          const fileTracked = (productData as any).track_inventory;
          const tracked =
            fileTracked !== undefined &&
            fileTracked !== null &&
            fileTracked !== this.NULL_MARKER
              ? this.normalizeBooleanValue(fileTracked)
              : ((existingProduct as any).track_inventory ?? true);
          const fileType = (productData as any).product_type;
          const isService =
            fileType !== undefined && fileType !== null
              ? fileType === 'service'
              : (existingProduct as any).product_type === 'service';
          if (!tracked || isService) {
            loadQty = null;
          } else {
            const dbVariant = await this.prisma.product_variants.findMany({
              where: { product_id: existingProduct.id },
              select: { id: true },
              take: 1,
            });
            if ((dbVariant ?? []).length > 0) {
              throw new BadRequestException(
                'La cantidad inicial no aplica a productos con variantes; usa el ajuste masivo con el SKU de cada variante',
              );
            }
          }
        }
        const currentStock =
          loadQty !== null && existingProduct
            ? await this.prisma.stock_levels.findFirst({
                where: {
                  product_id: existingProduct.id,
                  product_variant_id: null,
                  location_id: initialLoadLocationId,
                },
                select: { quantity_on_hand: true },
              })
            : null;
        const validInitialLoad =
          loadQty !== null &&
          loadQty > 0 &&
          Number(currentStock?.quantity_on_hand ?? 0) === 0;
        const costCellError = (
          (productData as any)[this.CELL_ERRORS_KEY] as
            | { field?: string; message: string }[]
            | undefined
        )?.find((e) => e.field === 'cost_price');
        if (costCellError && (!existingProduct || validInitialLoad)) {
          throw new BadRequestException(costCellError.message);
        }
        if (existingProduct) {
          if (
            !validInitialLoad &&
            ((productData as any).cost_price !== undefined || costCellError)
          ) {
            rowWarnings.push(
              'Se ignoró Precio Compra y se conservó el costo del producto existente.',
            );
          }
          // El catálogo no modifica el costo de existentes, ni al reactivar.
          // Una carga inicial válida lo lleva al circuito de valoración del ajuste.
          delete (productData as any).cost_price;
        }
        const applyInitialLoad = async (productId: number) => {
          if (loadQty === null || initialLoadLocationId === null) return;
          try {
            const degraded = await this.applyInitialLoadAdjustment({
              productId,
              quantity: loadQty,
              unitCost: initialCost,
              locationId: initialLoadLocationId,
              userId: user?.id,
            });
            if (degraded) rowWarnings.push(this.INITIAL_LOAD_AS_COUNT_VARIANCE);
          } catch (adjustError: any) {
            const detail =
              typeof adjustError?.message === 'string'
                ? adjustError.message
                : 'error desconocido';
            throw new BadRequestException(
              `El producto se guardó, pero no se pudo registrar la carga inicial de inventario: ${detail}`,
            );
          }
        };

        if (existingProduct && existingProduct.state === 'archived') {
          resultProduct = await this.reactivateArchivedProduct(
            existingProduct,
            productData,
            storeId,
          );
          await applyInitialLoad(existingProduct.id);

          results.push({
            product: resultProduct,
            status: 'success',
            action: 'reactivate',
            message: `Producto con SKU ${productData.sku} reactivado con los datos del archivo`,
          });
        } else if (existingProduct) {
          // Actualizar producto existente (sparse update: solo campos presentes)
          // Multi-tarifa ⊕ variantes: `update` no ve las variantes (se upsertan
          // aparte), así que la guarda se aplica aquí, antes de tocar nada.
          await this.assertVariantsAllowedOnExisting(
            existingProduct.id,
            productData,
          );
          await this.assertNoNewVariantsOnInactive(
            existingProduct,
            productData,
          );
          const updateProductDto = this.mapToUpdateProductDto(productData);
          resultProduct = await this.productsService.update(
            existingProduct.id,
            updateProductDto,
          );

          // Variantes del archivo: upsert por SKU, sin borrar las ausentes.
          await this.upsertVariantsBySku(
            existingProduct.id,
            productData.variants,
            productData.base_price,
          );
          await applyInitialLoad(existingProduct.id);

          results.push({
            product: resultProduct,
            status: 'success',
            action: 'update',
            message: `Producto con SKU ${productData.sku} actualizado exitosamente`,
          });
        } else {
          // Crear nuevo producto. Las variantes viajan DENTRO del DTO de
          // create: `ProductsService.create` las persiste en su misma
          // transacción (padre + variantes son una unidad).
          const createProductDto = this.mapToCreateProductDto(
            productData,
            storeId,
          );
          resultProduct = await this.productsService.create(createProductDto);
          if (loadQty !== null && resultProduct?.id !== undefined) {
            await applyInitialLoad(Number(resultProduct.id));
          }

          results.push({
            product: resultProduct,
            status: 'success',
            action: 'create',
            message: 'Producto creado exitosamente',
          });
        }

        if (rowWarnings.length > 0) {
          results[results.length - 1].message +=
            ` Advertencia: ${rowWarnings.join(' ')}`;
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
          const rawTarget = error?.meta?.target;
          const constraint = error?.meta?.driverAdapterError?.cause?.constraint;
          const targetText = [
            Array.isArray(rawTarget) ? rawTarget.join(', ') : rawTarget,
            // Driver adapter: { fields: [...] } o { index: '<nombre>' }.
            constraint ? JSON.stringify(constraint) : undefined,
          ]
            .filter((v) => typeof v === 'string' && v)
            .join(' ');
          const target = targetText || 'desconocido';

          if (target.includes('slug')) {
            const generated = generateSlug(productData.name || '');
            userMessage = `El nombre genera un slug duplicado ("${generated}"). Otro producto en la tienda ya lo usa.`;
          } else if (target.includes('sku')) {
            userMessage = `SKU "${productData.sku}" ya existe en la tienda.`;
          } else if (target.includes('barcode')) {
            userMessage = `El código de barras ya está en uso por otro producto de la tienda.`;
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
      skipped,
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
      // Precio Compra: se persiste en el producto. `stock_quantity` NUNCA se
      // mapea aquí: el stock entra sólo por el ajuste `initial_load`.
      cost_price: this.resolveInitialCost(product as any) ?? undefined,
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

    const variantDtos = this.buildVariantDtos(
      (product as any).variants,
      product.base_price,
    );
    if (variantDtos.length > 0) dto.variants = variantDtos;

    return dto;
  }

  /**
   * Convierte las variantes parseadas (o las del API legacy) en DTOs de
   * variante: descarta las claves internas `__*`, y traduce el `price` del
   * archivo a `price_override` solo si difiere del precio del padre (sin
   * precio, o igual al del padre, la variante hereda y no manda override).
   * Una celda de variante inválida (p. ej. código de barras) rechaza el
   * producto completo.
   */
  private buildVariantDtos(
    variants: any[] | undefined,
    parentBasePrice: unknown,
  ): any[] {
    if (!Array.isArray(variants) || variants.length === 0) return [];
    const parentPrice = parseMoneyCell(parentBasePrice);

    return variants.map((variant) => {
      const cellError = (
        Array.isArray(variant?.[this.CELL_ERRORS_KEY])
          ? variant[this.CELL_ERRORS_KEY]
          : []
      )[0];
      if (cellError) {
        throw new BadRequestException(
          `Variante ${variant.sku || ''} (fila ${variant[this.ROW_NUMBER_KEY] ?? '?'}): ${cellError.message}`,
        );
      }

      const { price, ...rest } = variant;
      const dto: Record<string, any> = { ...rest };
      for (const key of Object.keys(dto)) {
        if (key.startsWith('__')) delete dto[key];
      }
      if (
        dto.price_override === undefined &&
        price !== undefined &&
        price !== null
      ) {
        const parsed = parseMoneyCell(price);
        if (parsed !== null && parsed !== parentPrice) {
          dto.price_override = parsed;
        }
      }
      return dto;
    });
  }

  /**
   * Upsert de variantes por SKU sobre un producto existente (activo o
   * reactivado): actualiza las que ya existen y crea las nuevas. Las variantes
   * que el archivo no trae NO se tocan (`ProductsService.update` con
   * `variants` las borraría, por eso no se usa).
   */
  private async upsertVariantsBySku(
    productId: number,
    variants: any[] | undefined,
    parentBasePrice: unknown,
  ): Promise<void> {
    const dtos = this.buildVariantDtos(variants, parentBasePrice);
    if (dtos.length === 0) return;

    const currentVariants = await this.prisma.product_variants.findMany({
      where: { product_id: productId },
      select: { id: true, sku: true },
    });
    const bySku = new Map<string, number>();
    for (const v of currentVariants || []) {
      bySku.set(String(v.sku).toLowerCase(), v.id);
    }
    for (const dto of dtos) {
      const variantId = dto.sku
        ? bySku.get(String(dto.sku).toLowerCase())
        : undefined;
      if (variantId) {
        const { sku: _sku, ...fields } = dto;
        // Sin override (precio vacío o igual al del padre) la variante hereda:
        // se limpia un override previo. En creación no hace falta.
        if (fields.price_override === undefined) fields.price_override = null;
        await this.productsService.updateVariant(variantId, fields as any);
      } else {
        await this.productsService.createVariant(productId, dto as any);
      }
    }
  }

  /**
   * Payload "set completo" para reactivar un producto archivado.
   *
   * Regla: parte de `mapToCreateProductDto` (lo que trae el archivo se aplica)
   * y todo campo que ese mapper gestiona y el archivo NO trae vuelve al valor
   * por defecto de creación (`@default` de `model products`; nullable sin
   * default => null; listas => []). El costo es la excepción: lo administra
   * Inventario y se conserva hasta que una entrada válida lo recalcule.
   * Sin `store_id`: `productsService.update` no lo acepta ni lo necesita.
   * El stock no se toca (al archivar quedó en 0).
   */
  private mapToReactivateProductDto(product: BulkProductItemDto): any {
    // `variants` se queda fuera: el update no las acepta (borraría las
    // ausentes); se emparejan por SKU aparte en `reactivateArchivedProduct`.
    const {
      store_id: _omit,
      variants: _variants,
      cost_price: _inventoryCost,
      ...fromFile
    } = this.mapToCreateProductDto(product, 0);
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
      await this.upsertVariantsBySku(
        existing.id,
        productData.variants,
        productData.base_price,
      );
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
}
