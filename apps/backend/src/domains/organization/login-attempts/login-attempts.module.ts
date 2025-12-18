import { Module } from '@nestjs/common';
import { LoginAttemptsController } from './login-attempts.controller';
import { LoginAttemptsService } from './login-attempts.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';

@Module({
  imports: [],
  controllers: [LoginAttemptsController],
  providers: [LoginAttemptsService, OrganizationPrismaService],
  exports: [LoginAttemptsService],
})
export class LoginAttemptsModule {}
