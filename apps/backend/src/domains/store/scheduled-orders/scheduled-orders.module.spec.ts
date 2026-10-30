import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduledOrdersModule } from './scheduled-orders.module';
import { FulfillmentExceptionsController } from './fulfillment-exceptions.controller';
import { ScheduledOrdersController } from './scheduled-orders.controller';

// Importar el módulo hace que ts-jest tipe todo su árbol (controladores,
// servicios, DTOs) sin correr el typecheck global del backend.
describe('ScheduledOrdersModule', () => {
  it('registra el controlador de agenda y exporta la disponibilidad', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ScheduledOrdersModule);
    // Rutas fijas antes de `:id`: el orden del arreglo es el orden de registro.
    expect(controllers).toEqual([FulfillmentExceptionsController, ScheduledOrdersController]);
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ScheduledOrdersModule);
    expect(exported.map((p: { name: string }) => p.name)).toContain('FulfillmentAvailabilityService');
  });
});
