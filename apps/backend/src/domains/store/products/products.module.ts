import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createProductTools } from '../../../ai-engine/tools/domains/products.tools';
import { createProductWriteTools } from '../../../ai-engine/tools/domains/writes.tools';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsBulkController } from './products-bulk.controller';
import { ProductsBulkService } from './products-bulk.service';
import { ProductsBulkImageController } from './products-bulk-image.controller';
import { ProductsBulkImageService } from './products-bulk-image.service';
import { ProductsBulkEditController } from './products-bulk-edit.controller';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ProductVariantService } from './services/product-variant.service';
import { PriceResolverService } from './services/price-resolver.service';
import { ResponseModule } from '@common/responses/response.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';
import { AccessValidationService } from '@common/services/access-validation.service';
import { QrService } from '@common/services/qr.service';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
// `AutoEntryService.validateProductAccountCodes()` — la subcuenta PUC escrita a
// mano sobre un producto/variante se valida contra el `chart_of_accounts` de la
// organización ANTES de persistirla. Sin esto, un código con forma válida pero
// inexistente se guardaba y la factura acreditaba en silencio la cuenta por
// defecto.
//
// La arista es SEGURA en las dos direcciones: `AccountingModule` sólo importa
// Response/Prisma/S3/AccountsPayable/Bull, ninguno de los cuales llega a
// `ProductsModule`; y el archivo `auto-entry.service.ts` no alcanza —ni
// transitivamente— ningún archivo de `products/`, así que tampoco hay ciclo de
// import a nivel de módulo compilado (swc iza los `export *`).
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    ResponseModule,
    InventoryModule,
    PrismaModule,
    S3Module,
    PromotionsModule,
    // F4 — SettingsService.getFiscalData() para el gate "no responsable de IVA".
    SettingsModule,
    // Exporta `AutoEntryService`: valida la subcuenta PUC del producto/variante.
    AccountingModule,
  ],
  controllers: [
    ProductsController,
    ProductsBulkController,
    ProductsBulkImageController,
    // QUI-567. Va después de ProductsController: sus rutas POST de 2 segmentos
    // (`/bulk-edit`, `/bulk-edit/preview`) no colisionan con los `@Post(':id/...')`
    // de aquel, y el `@Get(':id')` no aplica porque bulk-edit sólo expone POST.
    ProductsBulkEditController,
  ],
  providers: [
    ProductsService,
    ProductsBulkService,
    ProductsBulkImageService,
    ProductsBulkEditService,
    ProductVariantService,
    PriceResolverService,
    AccessValidationService,
    QrService,
  ],
  exports: [
    ProductsService,
    ProductsBulkService,
    ProductsBulkImageService,
    ProductsBulkEditService,
    ProductVariantService,
    PriceResolverService,
  ],
})
export class ProductsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly productsService: ProductsService,
    private readonly priceResolver: PriceResolverService,
    private readonly settingsService: SettingsService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Registers the products tool family for the AI agent. It lives here and not
   * in `AIEngineModule` because that module is `@Global()`: importing one
   * domain module per tool family into it generates dependency cycles.
   * `AIToolRegistry` is exported globally, so the dependency points from the
   * domain to the engine and this module imports nothing extra.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createProductTools({
        productsService: this.productsService,
        priceResolver: this.priceResolver,
        settingsService: this.settingsService,
        prisma: this.prisma,
      }),
    );

    // `update_product_price` y `create_product`. Ambas delegan en
    // `ProductsService`, que ya es propiedad de este módulo: registrarlas desde
    // aquí no cuesta ningún import cruzado entre dominios.
    this.toolRegistry.registerMany(
      createProductWriteTools({
        productsService: this.productsService,
        prisma: this.prisma,
      }),
    );
  }
}
