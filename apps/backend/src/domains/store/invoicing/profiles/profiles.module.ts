import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';

import { ProfileCatalogCacheService } from './profile-catalog-cache.service';
import { ProfileVersionsService } from './profile-versions.service';
import { ProfilesService } from './profiles.service';

/**
 * Proveedores de los perfiles de facturación. **Sin controllers, a propósito.**
 *
 * `ProfilesController` se declara en el array de `InvoicingModule`, delante de
 * `InvoicingController`, y no acá. La razón es de ENRUTADO y está verificada, no
 * supuesta: `InvoicingController` monta en `store/invoicing` y declara
 * `@Get(':id')`, así que `GET /api/store/invoicing/profiles` entra por ese
 * handler —`ParseIntPipe` recibe la cadena «profiles»— y responde **400**. Se
 * midió: el listado entero era inalcanzable.
 *
 * Express resuelve por ORDEN DE REGISTRO, y el orden lo fija la posición en el
 * array `controllers` del módulo. Los controllers de un módulo IMPORTADO se
 * registran DESPUÉS de los del importador, así que un `ProfilesModule` con su
 * propio controller queda irremediablemente detrás de `:id`. Es el mismo motivo
 * por el que `ResolutionsController` y `DianConfigController` ya viven en ese
 * array por delante de `InvoicingController`.
 *
 * Los proveedores sí viven acá y se exportan: mantiene el grafo legible y deja
 * la dependencia declarada en un solo sitio.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  // `REDIS_CLIENT` no se importa: `RedisModule` es `@Global()`.
  providers: [ProfilesService, ProfileVersionsService, ProfileCatalogCacheService],
  exports: [ProfilesService, ProfileVersionsService, ProfileCatalogCacheService],
})
export class ProfilesModule {}
