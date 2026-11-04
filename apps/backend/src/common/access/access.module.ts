import { Global, Module } from '@nestjs/common';
import { AccessAuditLogger } from './access-audit.logger';
import { AccessGateModeService } from './access-gate-mode.service';
import { AccessGateService } from './access-gate.service';
import { IndustryModuleGuard } from '../guards/industry-module.guard';

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
  ],
  exports: [
    AccessAuditLogger,
    AccessGateModeService,
    AccessGateService,
    IndustryModuleGuard,
  ],
})
export class AccessModule {}
