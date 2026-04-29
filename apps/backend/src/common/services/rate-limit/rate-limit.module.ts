import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DomainRegistrationGuard } from './domain-registration.guard';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [DomainRegistrationGuard],
  exports: [DomainRegistrationGuard],
})
export class RateLimitModule {}
