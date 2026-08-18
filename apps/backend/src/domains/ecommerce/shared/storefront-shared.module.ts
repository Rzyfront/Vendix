import { Module } from '@nestjs/common';
import { ProductsModule } from '../../store/products/products.module';
import { StorefrontPriceService } from './services/storefront-price.service';

/**
 * Servicios compartidos por las tres superficies del storefront (catálogo,
 * carrito y checkout).
 *
 * Sigue el patrón de `OrderStockCommitModule`: cuando una regla de negocio
 * tiene que dar el MISMO número en varios módulos, el servicio vive en un
 * módulo propio y los consumidores lo importan, en vez de redeclarar el
 * provider —que es como las copias empiezan a divergir—.
 *
 * Importa `ProductsModule` porque es el dueño de `PriceResolverService` (regla
 * de propiedad de servicios compartidos: se importa el módulo dueño, no se
 * duplica el provider).
 */
@Module({
  imports: [ProductsModule],
  providers: [StorefrontPriceService],
  exports: [StorefrontPriceService],
})
export class StorefrontSharedModule {}
