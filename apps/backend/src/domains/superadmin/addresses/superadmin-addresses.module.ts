import { Module } from '@nestjs/common';
import { DianGeographyController } from './dian-geography.controller';
import { AddressesModule } from '../../store/addresses/addresses.module';
import { ResponseModule } from '@common/responses/response.module';

/**
 * Endpoints super-admin para el catálogo DANE (Divipola).
 *
 * Reutiliza `DianMunicipalitiesService` que ya viene exportado por
 * `AddressesModule` (módulo de tienda). Es dato de referencia público —
 * 1122 municipios + 33 departamentos — así que no necesita scope de tienda.
 */
@Module({
  imports: [AddressesModule, ResponseModule],
  controllers: [DianGeographyController],
})
export class SuperadminAddressesModule {}
