import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseFlowService } from './expense-flow/expense-flow.service';
import { ExpenseScannerService } from './expense-scanner.service';
import { ExpenseScanProcessor } from './expense-scan.processor';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    // Cola dedicada para el OCR asíncrono de facturas de gasto. El root BullMQ
    // (conexión Redis) es @Global vía QueueModule, así que aquí solo se declara
    // la cola local del dominio.
    BullModule.registerQueue({ name: 'expense-scan' }),
  ],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    ExpenseFlowService,
    ExpenseScannerService,
    ExpenseScanProcessor,
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
