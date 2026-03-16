import { Module } from '@nestjs/common';
import { CashRegistersController } from './cash-registers.controller';
import { CashRegistersService } from './cash-registers.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService } from './sessions/sessions.service';
import { MovementsService } from './movements/movements.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [SessionsController, CashRegistersController],
  providers: [CashRegistersService, SessionsService, MovementsService],
  exports: [SessionsService, MovementsService],
})
export class CashRegistersModule {}
