import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduledOrdersModule } from './scheduled-orders.module';
import { FulfillmentExceptionsController } from './fulfillment-exceptions.controller';

// Importar el módulo hace que ts-jest tipe todo su árbol (controladores,
// servicios, DTOs) sin correr el typecheck global del backend.
describe('ScheduledOrdersModule', () => {
  it('registra el controlador de agenda y exporta la disponibilidad', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ScheduledOrdersModule);
    expect(controllers).toContain(FulfillmentExceptionsController);
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ScheduledOrdersModule);
    expect(exported.map((p: { name: string }) => p.name)).toContain('FulfillmentAvailabilityService');
  });
});
