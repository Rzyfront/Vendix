import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { DomainResolutionService } from '../services/domain-resolution.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PublicController],
  providers: [DomainResolutionService],
  exports: [DomainResolutionService],
})
export class PublicModule {}
