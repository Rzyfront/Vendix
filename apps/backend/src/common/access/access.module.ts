import { Global, Module } from '@nestjs/common';
import { AccessAuditLogger } from './access-audit.logger';
import { AccessGateModeService } from './access-gate-mode.service';
import { AccessGateService } from './access-gate.service';
import { IndustryModuleGuard } from '../guards/industry-module.guard';
import { PlanModuleRulesService } from './plan-module-rules.service';

/**
 * Global so `@UseGuards(IndustryModuleGuard)` resolves in any domain module
 * without per-module wiring. Redis and Prisma modules are already global.
 */
@Global()
@Module({
  providers: [
    AccessAuditLogger,
    AccessGateModeService,
    AccessGateService,
    IndustryModuleGuard,
    PlanModuleRulesService,
  ],
  exports: [
    AccessAuditLogger,
    AccessGateModeService,
    AccessGateService,
    IndustryModuleGuard,
    PlanModuleRulesService,
  ],
})
export class AccessModule {}
