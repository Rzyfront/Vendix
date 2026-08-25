import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../../common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { S3Module } from '../../../../common/services/s3.module';
import { EmailModule } from '../../../../email/email.module';
import { ModuleFlowGuard } from '../../../../common/guards/module-flow.guard';
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
  imports: [ResponseModule, PrismaModule, S3Module, EmailModule],
  controllers: [InvoiceDeliveryController],
  providers: [InvoiceDeliveryService, ModuleFlowGuard],
})
export class InvoiceDeliveryModule {}
