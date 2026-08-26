import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DianDirectModule } from '../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { BullModule } from '@nestjs/bullmq';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
import { DianConfigService } from '../../../store/invoicing/dian-config/dian-config.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { ResolutionScannerService } from '../../../store/invoicing/resolutions/resolution-scanner.service';
import { FiscalProductionReadinessService } from '../../../store/invoicing/providers/fiscal-production-readiness.service';
import { DianNumberingRangeService } from '../../../store/invoicing/dian-config/dian-numbering-range.service';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { SubscriptionFiscalController } from './subscription-fiscal.controller';
import { SubscriptionFiscalListener } from './subscription-fiscal.listener';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase B.5
 *
 * V1 providers + factory wiring para la facade `PlatformInvoicingService`.
 *
 * Antes: este modulo solo manejaba el rail SaaS. Ahora co-habita
 * el rail plataforma (MvpV1) — el legacy sigue operativo y la nueva
 * API (`/sales-invoices`, `/support-documents`, `/customers/search`,
 * etc.) entra por `PlatformInvoicingController`. Las responsabilidades
 * legacy NO cambian: `SubscriptionFiscalService` sigue emitiendo
 * invoices SaaS bajo el camino legacy y se inyecta ademas en la
 * facade MvpV1 como `subscriptionFiscalService` (usada para
 * delegar `listResolutionsForEmission`).
 *
 * Por que importamos `InvoicingModule` aqui: el facade reusa
 * `InvoicingService` + `InvoiceFlowService` del rail tienda como
 * motor de aritmetica, validators y cadena UBL. `InvoicingModule`
 * NO importa este modulo, asi que no hay ciclo de DI.
 *
 * Por que la facade usa un `useFactory` y NO `@Injectable()` puro:
 * `PlatformInvoicingService` recibe sus dependencias via un objeto
 * `Deps` plano. Eso permite tests deterministicos sin NestJS runtime
 * y mantiene la clase aislable. El modulo construye el `Deps` una
 * sola vez y lo inyecta. Sin el factory la clase estaria atada al
 * DI de Nest y seria mas dificil de probar.
 */
import { InvoicingModule } from '../../../store/invoicing/invoicing.module';
import { InvoicingService } from '../../../store/invoicing/invoicing.service';
import { InvoiceFlowService } from '../../../store/invoicing/invoice-flow/invoice-flow.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformInvoicingPersistenceService } from './platform-invoicing-persistence.service';
import { PlatformInvoicingService } from './platform-invoicing.service';
import { PlatformInvoicingController } from './platform-invoicing.controller';
import { PlatformProfilesService } from './platform-profiles.service';
import { PlatformProfilesController } from './platform-profiles.controller';
import { PlatformCreditNotesService } from './platform-credit-notes.service';
import { PlatformDeliveryService } from './platform-delivery.service';
import { PlatformDianEventsService } from './platform-dian-events.service';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    DianDirectModule,
    BullModule.registerQueue({ name: 'dian-test-set' }),
    // InvoicingModule provee los servicios de aritmetica/validator/UBL
    // del riel tienda. La facade los consume sin copiarlos.
    InvoicingModule,
  ],
  controllers: [
    SubscriptionFiscalController,
    // PlatformInvoicingController expone los nuevos paths MvpV1.
    // Aisla las rutas V1 del legacy para minimizar conflictos.
    PlatformInvoicingController,
    // PlatformProfilesController expone los 14 endpoints del sistema de
    // perfiles plataforma (B.2 del CP-platform-invoicing-parity).
    // Rutas estáticas ANTES de :id, mismo orden de declaración que el
    // controller de tienda para evitar colisión con ParseIntPipe.
    PlatformProfilesController,
  ],
  providers: [
    ManualCertificateIssuerAdapter,
    DianTestService,
    DianConfigService,
    FiscalScopeService,
    ResolutionScannerService,
    PlatformOrgService,
    FiscalProductionReadinessService,
    DianNumberingRangeService,
    CustomerFiscalIdentityValidator,
    FiscalDocumentValidator,
    SubscriptionFiscalService,
    SubscriptionFiscalListener,
    // MvpV1 providers (Phase B.5):
    // Servicio read-only de busqueda de tenants (ADR-7).
    PlatformTenantsService,
    // Servicio de persistencia de snapshots (acquirer + invoice).
    PlatformInvoicingPersistenceService,
    // Facade con `useFactory` que arma el `Deps` con las dependencias
    // inyectadas del riel tienda + legacy + MvpV1.
    // PlatformInvoicingService inyecta sus deps via @Injectable standard.
    // Se declara como provider normal (no useFactory) para que Nest resuelva
    // via constructor y no requiera el truco del deps object.
    PlatformInvoicingService,
    // B.2: motor de perfiles plataforma (ADR-1 fachada, ADR-2 nullable,
    // ADR-4 ámbito). Reutiliza ProfileCatalogCacheService, ProfileAccountingValidator
    // y AuditService del riel tienda vía DI (ya provistos por InvoicingModule).
    PlatformProfilesService,
    // C.2: notas crédito/débito plataforma (ADR-7). Persiste vía
    // InvoicingService.create() del riel tienda con RequestContext sintetizado;
    // NO toca el servicio tienda — compuerta dura verificada por su spec.
    PlatformCreditNotesService,
    // C.3: reenvío por correo plataforma (H2 invoice_delivery_events.store_id
    // ya nullable). C.3.5 pendiente: armado de ZIP + SMTP (siguiente slice).
    PlatformDeliveryService,
    // C.4: eventos RADIAN plataforma (H2 dian_document_events.store_id nullable).
    // C.4.5 pendiente: transmisión SOAP al provider DIAN (siguiente slice).
    PlatformDianEventsService,
  ],
  exports: [SubscriptionFiscalService],
})
export class SubscriptionFiscalModule {}
