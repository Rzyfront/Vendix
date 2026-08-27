import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../../common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { S3Module } from '../../../../common/services/s3.module';
import { EmailModule } from '../../../../email/email.module';
import { ModuleFlowGuard } from '../../../../common/guards/module-flow.guard';
// BE-E5 (E.5): `FiscalInvoicePdfRenderService` se importa desde el módulo
// print-formats para que el ZIP de reenvío lleve el PDF re-renderizado en el
// formato configurado de la tienda — ver `InvoiceDeliveryService.deliver`,
// paso 5.b. La dependencia con `print-formats.module.ts` no introduce ciclo:
// este módulo importa `PrismaModule`/`S3Module`/`EmailModule` y `print-formats`
// depende sólo de `PrismaModule`/`S3Module` + `QrService` (transversal). El
// servicio aquí consumido ya está exportado por `PrintFormatsModule`.
import { PrintFormatsModule } from '../../print-formats/print-formats.module';
import { InvoiceDeliveryController } from './invoice-delivery.controller';
import { InvoiceDeliveryService } from './invoice-delivery.service';

/**
 * Módulo anidado de E.6 (reenvío de facturas), mismo patrón que
 * `profiles/profiles.module.ts` salvo por el desdoblamiento controller/módulo:
 * ver el docblock de `InvoiceDeliveryController` para por qué éste sí puede
 * declarar su controller adentro.
 *
 * NO importa `InvoicingModule` ni ninguno de sus providers — evita el ciclo
 * que se daría al re-exportar `InvoicePdfService` (tiene `@OnEvent`, una
 * segunda instancia duplicaría el envío de PDFs). Todo lo que este módulo
 * necesita (`StorePrismaService`, `S3Service`, `EmailService`,
 * `FiscalGateService` para `ModuleFlowGuard`) llega de módulos independientes.
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    EmailModule,
    PrintFormatsModule,
  ],
  controllers: [InvoiceDeliveryController],
  providers: [InvoiceDeliveryService, ModuleFlowGuard],
})
export class InvoiceDeliveryModule {}
