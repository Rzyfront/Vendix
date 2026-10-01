import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { CashRegistersController } from './cash-registers.controller';
import { CashRegistersService } from './cash-registers.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService, SETTINGS_SERVICE } from './sessions/sessions.service';
import { MovementsService } from './movements/movements.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createCashRegisterTools } from '../../../ai-engine/tools/domains/cash-register.tools';

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
export class CashRegistersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly sessions: SessionsService,
    private readonly movements: MovementsService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createCashRegisterTools({
        sessionsService: this.sessions,
        movementsService: this.movements,
      }),
    );
  }
}
