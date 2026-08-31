import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';

import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';

import { ProfileCatalogCacheService } from './profile-catalog-cache.service';
import { ProfileAccountHealthService } from './profile-account-health.service';
import { ProfileAccountingValidator } from './profile-accounting.validator';
import { ProfilePreviewService, PROFILE_READER } from './profile-preview.service';

// Re-export so the symbol survives `import { PROFILE_READER } from './profiles.module'`
// in other modules. Without `export`, the symbol is module-private and TS
// callers receive `undefined`, which NestJS interprets as a class provider with
// `metatype = {provide: undefined, useExisting: ...}` → `metatype is not a constructor`.
export { PROFILE_READER };
import { ProfileVersionsService } from './profile-versions.service';
import { PreviewNumberingGuard } from './preview-numbering.guard';
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
 *
 * ## El cinturón de la numeración (ERR-11)
 *
 * `InvoiceNumberGenerator` está **sustituido** en este módulo por
 * `PreviewNumberingGuard`, que no numera: lanza `INVOICING_PREVIEW_001`.
 *
 * Es la única forma de hacer verificable la promesa de ADR-5 —«la
 * previsualización no reserva numeración»—. La alternativa era no llamar al
 * generador, que no es una garantía sino una intención: el módulo va a crecer, y
 * el día que alguien necesite un consecutivo encontrará un servicio inyectable
 * que se lo da, sin nada que lo detenga. Un consecutivo autorizado que se toma y
 * no se usa **no se puede recuperar**: la DIAN espera la serie completa, y el
 * hueco sólo se explica con un reporte de anulación.
 *
 * **La sustitución no puede escaparse de este módulo.** Los proveedores de Nest
 * se resuelven por módulo, así que `InvoiceFlowService` —que vive en
 * `InvoicingModule`— sigue recibiendo el generador REAL. Esto es lo que
 * convierte el cinturón en algo seguro de poner: no existe camino por el que
 * pueda bloquear una emisión de producción. Verificable: el paso G.2 emite una
 * factura de verdad después de tres previsualizaciones.
 *
 * ## Por qué `InvoiceCalculatorService` se provee y no se importa
 *
 * `InvoicingModule` **importa** `ProfilesModule`. Importarlo de vuelta para
 * alcanzar el calculador cerraría el ciclo y Nest fallaría al arrancar. Se
 * declara acá como proveedor propio, que es inocuo porque el calculador es puro:
 * no tiene constructor, no toca la base de datos y no guarda estado, así que dos
 * instancias son indistinguibles de una. No es duplicar la lógica —es la MISMA
 * clase, el mismo archivo—; es duplicar un objeto sin estado.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  // `REDIS_CLIENT` no se importa: `RedisModule` es `@Global()`.
  providers: [
    ProfilesService,
    ProfileVersionsService,
    ProfileCatalogCacheService,
    ProfileAccountingValidator,
    ProfileAccountHealthService,
    ProfilePreviewService,
    InvoiceCalculatorService,
    { provide: InvoiceNumberGenerator, useClass: PreviewNumberingGuard },
    // Token para el lector de perfiles del preview — resuelto a ProfilesService
    // (store-scoped) en el riel tienda, a PlatformProfilesService en el de plataforma.
    { provide: PROFILE_READER, useExisting: ProfilesService },
  ],
  exports: [
    ProfilesService,
    ProfileVersionsService,
    ProfileCatalogCacheService,
    ProfileAccountingValidator,
    ProfileAccountHealthService,
    ProfilePreviewService,
    PROFILE_READER,
  ],
})
export class ProfilesModule {}
