import { Module } from '@nestjs/common';
import { LegalAcceptancesController } from './controllers/legal-acceptances.controller';
import { LegalAcceptancesService } from './services/legal-acceptances.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [LegalAcceptancesController],
  providers: [LegalAcceptancesService],
  exports: [LegalAcceptancesService],
})
export class LegalAcceptancesModule {}
