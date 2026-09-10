import { Module, forwardRef } from '@nestjs/common';
import { CashRegistersController } from './cash-registers.controller';
import { CashRegistersService } from './cash-registers.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService, SETTINGS_SERVICE } from './sessions/sessions.service';
import { MovementsService } from './movements/movements.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    forwardRef(() => SettingsModule),
  ],
  controllers: [SessionsController, CashRegistersController],
  providers: [
    CashRegistersService,
    SessionsService,
    MovementsService,
    { provide: SETTINGS_SERVICE, useExisting: SettingsService },
  ],
  exports: [SessionsService, MovementsService],
})
export class CashRegistersModule {}
