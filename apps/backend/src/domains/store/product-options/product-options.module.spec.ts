import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProductOptionsModule } from './product-options.module';
import { ProductOptionsController } from './product-options.controller';
import { EcommerceProductOptionsController } from './ecommerce-product-options.controller';

// Importar el módulo hace que ts-jest tipe su árbol (controladores, servicios, DTOs).
describe('ProductOptionsModule', () => {
  it('registra los controladores y exporta el cálculo de precio', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ProductOptionsModule);
    expect(controllers).toEqual([ProductOptionsController, EcommerceProductOptionsController]);
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ProductOptionsModule);
    expect(exported.map((p: { name: string }) => p.name)).toEqual(['ProductOptionsService', 'OptionPricingService']);
  });
});
