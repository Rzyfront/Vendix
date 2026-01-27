import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { StorePrismaService } from "../../../prisma/services/store-prisma.service";
import { ProductsService } from "./products.service";
import { ProductVariantService } from "./services/product-variant.service";
import { AccessValidationService } from "@common/services/access-validation.service";
import { StockLevelManager } from "../inventory/shared/services/stock-level-manager.service";
import { LocationsService } from "../inventory/locations/locations.service";
import { RequestContextService } from "@common/context/request-context.service";
import {
  BulkProductUploadDto,
  BulkProductItemDto,
  BulkUploadResultDto,
  BulkUploadItemResultDto,
  BulkValidationResultDto,
  BulkUploadTemplateDto,
} from "./dto";
import { generateSlug } from "@common/utils/slug.util";
import * as XLSX from "xlsx";

@Injectable()
export class ProductsBulkService {
  private readonly MAX_BATCH_SIZE = 1000;

  private readonly HEADER_MAP = {
    Nombre: "name",
    SKU: "sku",
    "Precio Venta": "base_price",
    "Precio Base": "base_price",
    "Precio Compra": "cost_price",
    Costo: "cost_price",
    Margen: "profit_margin",
    "Cantidad Inicial": "stock_quantity",
    Descripción: "description",
    Categorías: "category_ids",
    Marca: "brand_id",
    Estado: "state",
    "Disponible Ecommerce": "available_for_ecommerce",
    "En Oferta": "is_on_sale",
    "Precio Oferta": "sale_price",
    Peso: "weight",
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
    private readonly variantService: ProductVariantService,
    private readonly accessValidationService: AccessValidationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly locationsService: LocationsService,
  ) {}

  async generateExcelTemplate(type: "quick" | "complete"): Promise<Buffer> {
    let headers: string[] = [];
    let exampleData: any[] = [];

    if (type === "quick") {
      headers = ["Nombre", "SKU", "Precio Venta", "Precio Compra", "Cantidad Inicial"];
      exampleData = [{ Nombre: "Camiseta Básica Blanca", SKU: "CAM-BAS-BLA-001", "Precio Venta": 15000, "Precio Compra": 8000, "Cantidad Inicial": 50 }];
    } else {
      headers = ["Nombre", "SKU", "Precio Venta", "Precio Compra", "Margen", "Cantidad Inicial", "Descripción", "Marca", "Categorías", "Estado", "Disponible Ecommerce", "Peso", "En Oferta", "Precio Oferta"];
      exampleData = [{ Nombre: "Zapatillas Running Pro", SKU: "ZAP-RUN-PRO-42", "Precio Venta": 85000, "Precio Compra": 45000, Margen: 45, "Cantidad Inicial": 20, Descripción: "Zapatillas ideales para correr largas distancias.", Marca: "Nike", Categorías: "Deportes, Calzado, Running", Estado: "activo", "Disponible Ecommerce": "Si", Peso: 0.8, "En Oferta": "No", "Precio Oferta": 0 }];
    }

    const ws = XLSX.utils.json_to_sheet(exampleData, { header: headers });
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 5, 20) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla Productos");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }

  async uploadProducts(bulkUploadDto: BulkProductUploadDto, user: any): Promise<BulkUploadResultDto> {
    const { products } = bulkUploadDto;
    if (products.length > this.MAX_BATCH_SIZE) throw new BadRequestException(`El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} productos`);
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) throw new BadRequestException("No se pudo determinar la tienda actual");
    await this.accessValidationService.validateStoreAccess(storeId, user);
    const results: BulkUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    for (const productData of products) {
      try {
        await this.preprocessProductData(productData, storeId);
        await this.validateProductData(productData, storeId);
        let resultProduct;
        const existingProduct = await this.prisma.products.findFirst({ where: { store_id: storeId, sku: productData.sku, state: { not: "archived" } } });
        await this.prisma.$transaction(async (tx) => {
          if (existingProduct) {
            resultProduct = await this.productsService.update(existingProduct.id, this.mapToUpdateProductDto(productData));
            results.push({ product: resultProduct, status: "success", message: `Product with SKU ${productData.sku} updated successfully` });
          } else {
            resultProduct = await this.productsService.create(this.mapToCreateProductDto(productData, storeId));
            const createdId = (resultProduct as any).id;
            if (productData.variants && productData.variants.length > 0) await this.processProductVariants(createdId as unknown as number, productData.variants);
            results.push({ product: resultProduct, status: "success", message: "Product created successfully" });
          }
        });
        successful++;
      } catch (error) {
        results.push({ product: null, status: "error", message: error.message, error: error.constructor.name });
        failed++;
      }
    }
    return { success: failed === 0, total_processed: products.length, successful, failed, results };
  }

  private async preprocessProductData(product: any, storeId: number) {
    if (product.brand_id && typeof product.brand_id === "string") {
      const brandName = product.brand_id.trim();
      if (/^\d+$/.test(brandName)) product.brand_id = parseInt(brandName, 10);
      else if (brandName) product.brand_id = await this.findOrCreateBrand(brandName, storeId);
      else delete product.brand_id;
    }
    if (product.category_ids) {
      let rawCategories = typeof product.category_ids === "string" ? product.category_ids.split(",") : Array.isArray(product.category_ids) ? product.category_ids : [];
      if (rawCategories.length > 0) {
        const categoryIds: number[] = [];
        for (const cat of rawCategories) {
          const catStr = cat.toString().trim();
          if (!catStr) continue;
          if (/^\d+$/.test(catStr)) categoryIds.push(parseInt(catStr, 10));
          else categoryIds.push(await this.findOrCreateCategory(catStr, storeId));
        }
        product.category_ids = categoryIds;
      }
    }
    const cost = parseFloat(product.cost_price || 0);
    let margin = parseFloat(product.profit_margin || 0);
    if (margin > 0 && margin < 1) { margin *= 100; product.profit_margin = margin; }
    if (margin > 0 && cost > 0) product.base_price = cost * (1 + margin / 100);
    const normalizeBool = (val: any) => {
      if (typeof val === "boolean") return val;
      if (typeof val === "string") return ["si", "yes", "true", "verdadero"].includes(val.toLowerCase());
      return !!val;
    };
    if (product.is_on_sale !== undefined) product.is_on_sale = normalizeBool(product.is_on_sale);
    if (product.available_for_ecommerce !== undefined) product.available_for_ecommerce = normalizeBool(product.available_for_ecommerce);
    if (product.state && typeof product.state === "string") {
      const s = product.state.toLowerCase();
      if (["activo", "active", "habilitado"].includes(s)) product.state = "active";
      else if (["inactivo", "inactive", "deshabilitado"].includes(s)) product.state = "inactive";
      else if (["archivado", "archived"].includes(s)) product.state = "archived";
    }
  }

  private async findOrCreateBrand(name: string, storeId: number): Promise<number> {
    const existing = await this.prisma.brands.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (existing) return existing.id;
    const created = await this.prisma.brands.create({ data: { name, description: "Creada automáticamente por carga masiva", state: "active" } });
    return created.id;
  }

  private async findOrCreateCategory(name: string, storeId: number): Promise<number> {
    const slug = generateSlug(name);
    const existing = await this.prisma.categories.findFirst({ where: { store_id: storeId, slug } });
    if (existing) return existing.id;
    const created = await this.prisma.categories.create({ data: { name, slug, store_id: storeId, description: "Creada automáticamente por carga masiva", state: "active" } });
    return created.id;
  }

  async validateBulkProducts(products: BulkProductItemDto[], user: any): Promise<BulkValidationResultDto> {
    const errors: string[] = [];
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) return { isValid: false, errors: ["Tienda no identificada"], validProducts: [] };
    const skus = new Set<string>();
    const duplicateSkus = new Set<string>();
    for (const p of products) { if (skus.has(p.sku)) duplicateSkus.add(p.sku); else skus.add(p.sku); }
    if (duplicateSkus.size > 0) errors.push(`SKUs duplicados en el archivo: ${Array.from(duplicateSkus).join(", ")}`);
    const validProducts: BulkProductItemDto[] = [];
    for (const [index, product] of products.entries()) {
      if (!product.name || !product.sku || product.base_price === undefined) { errors.push(`Fila ${index + 1}: Faltan datos obligatorios (Nombre, SKU o Precio)`); continue; }
      validProducts.push(product);
    }
    return { isValid: errors.length === 0, errors, validProducts };
  }

  async getBulkUploadTemplate(): Promise<BulkUploadTemplateDto> { return { headers: [], sample_data: [], instructions: "Use the new Excel download feature." }; }

  private async validateProductData(product: BulkProductItemDto, storeId: number): Promise<void> {
    if (!product.name) throw new BadRequestException("Nombre es requerido");
    if (!product.sku) throw new BadRequestException("SKU es requerido");
    if (product.base_price < 0) throw new BadRequestException("Precio base debe ser positivo");
    if (product.brand_id && typeof product.brand_id === "number") {
      const exists = await this.prisma.brands.findUnique({ where: { id: product.brand_id } });
      if (!exists) throw new BadRequestException(`Marca ID ${product.brand_id} no existe`);
    }
  }

  private mapToCreateProductDto(product: BulkProductItemDto, storeId: number): any {
    return { name: product.name, base_price: product.base_price, sku: product.sku, description: product.description, slug: product.slug || generateSlug(product.name), store_id: storeId, brand_id: product.brand_id, category_ids: product.category_ids, stock_quantity: product.stock_quantity, cost_price: product.cost_price, profit_margin: product.profit_margin, weight: product.weight, is_on_sale: product["is_on_sale"], sale_price: product["sale_price"], state: product.state, available_for_ecommerce: product.available_for_ecommerce };
  }

  private mapToUpdateProductDto(product: BulkProductItemDto): any {
    return { name: product.name, base_price: product.base_price, sku: product.sku, description: product.description, brand_id: product.brand_id, category_ids: product.category_ids, stock_quantity: product.stock_quantity, cost_price: product.cost_price, profit_margin: product.profit_margin, weight: product.weight, is_on_sale: product["is_on_sale"], sale_price: product["sale_price"], state: product.state, available_for_ecommerce: product.available_for_ecommerce };
  }

  private async processProductVariants(productId: number, variants: any[]): Promise<void> { for (const variantData of variants) await this.productsService.createVariant(productId, variantData); }

  private async processInitialStock(productId: number, quantity: number, storeId: number): Promise<void> {
    const defaultLocation = await this.locationsService.getDefaultLocation(storeId);
    if (!defaultLocation) return;
    await this.stockLevelManager.updateStock({ product_id: productId, location_id: defaultLocation.id, quantity_change: quantity, movement_type: "initial", reason: "Carga masiva inicial" });
  }

  private async processStockByLocation(productId: number, stockByLocation: any[], storeId: number): Promise<void> {
    const defaultLocation = await this.locationsService.getDefaultLocation(storeId);
    for (const stockData of stockByLocation) {
      const locationId = stockData.location_id || defaultLocation?.id;
      if (!locationId) continue;
      await this.stockLevelManager.updateStock({ product_id: productId, location_id: locationId, quantity_change: stockData.quantity || 0, movement_type: "initial", reason: stockData.notes || "Carga masiva por ubicación" });
    }
  }
}
