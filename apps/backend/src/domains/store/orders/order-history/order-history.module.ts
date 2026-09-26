import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { OrderHistoryService } from './order-history.service';

/**
 * Plan order-truth-and-invoice-tz — Objetivo 5. Único módulo que expone
 * `OrderHistoryService`, el único escritor de `order_events`. No importa
 * dominios de orden a propósito (evita ciclos); son ellos quienes importan
 * este módulo cuando se cablean los escritores (paso 6 del plan, fuera de
 * este alcance).
 */
@Module({
  imports: [PrismaModule],
  providers: [OrderHistoryService],
  exports: [OrderHistoryService],
})
export class OrderHistoryModule {}
