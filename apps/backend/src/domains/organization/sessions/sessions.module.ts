import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';

@Module({
  imports: [],
  controllers: [SessionsController],
  providers: [SessionsService, OrganizationPrismaService],
  exports: [SessionsService],
})
export class SessionsModule {}
