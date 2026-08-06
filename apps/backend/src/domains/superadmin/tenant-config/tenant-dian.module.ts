import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';

import { PrismaModule } from '../../../prisma/prisma.module';
import { OrgDianConfigService } from '../../organization/invoicing/dian-config/dian-config.service';
import { ManualCertificateIssuerAdapter } from '../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { DianConfigService } from '../../store/invoicing/dian-config/dian-config.service';
import { DianTestService } from '../../store/invoicing/dian-config/dian-test.service';
import { DianDirectModule } from '../../store/invoicing/providers/dian-direct/dian-direct.module';
import { InvoiceProviderModule } from '../../store/invoicing/providers/invoice-provider.module';

import { TenantDianConfigController } from './tenant-dian-config.controller';

/**
 * Rail DIAN de la consola de super admin.
 *
 * Provee los MISMOS servicios que los módulos de tienda y organización en vez
 * de copiarlos: el controlador es pura delegación dentro del contexto forjado
 * por `TenantContextRunner`, así que cualquier corrección en el dominio de
 * facturación llega aquí sin tocar este archivo.
 *
 * `TenantContextRunner` se provee AQUÍ y no se importa de
 * `SuperadminTenantConfigModule`: es stateless, y depender del módulo hermano
 * crearía un ciclo en cuanto el orquestador cableara este módulo dentro de
 * aquel. La garantía de aislamiento no es dónde se instancia, sino que ningún
 * módulo de tienda u organización pueda inyectarlo.
 *
 * `DianTestSetProcessor` NO se registra aquí. El worker de la cola
 * `dian-test-set` vive en un único módulo (`invoicing.module.ts`); registrarlo
 * en cada superficie levantaría tres consumidores para la misma cola. Sí se
 * registra la cola, porque cada instancia de `DianTestService` —una por módulo
 * que lo declara— necesita resolver su `@InjectQueue` como PRODUCTOR.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    DianDirectModule,
    // Exporta `FiscalProductionReadinessService`, del que depende
    // `DianConfigService` para el checklist de producción.
    InvoiceProviderModule,
    BullModule.registerQueue({ name: 'dian-test-set' }),
  ],
  controllers: [TenantDianConfigController],
  providers: [
    TenantContextRunner,
    DianConfigService,
    OrgDianConfigService,
    DianTestService,
    ManualCertificateIssuerAdapter,
  ],
})
export class TenantDianModule {}
