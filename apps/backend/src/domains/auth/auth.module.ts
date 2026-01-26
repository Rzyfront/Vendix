import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EnvironmentSwitchService } from './environment-switch.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import { OrganizationsModule } from '../organization/organizations/organizations.module';
// import { AuditModule } from '../superadmin/audit/audit.module';
import { OnboardingModule } from '../organization/onboarding/onboarding.module';
import { ResponseModule } from '@common/responses/response.module';
import { LegalAcceptancesModule } from './legal-acceptances/legal-acceptances.module';
import {
  RateLimitMiddleware,
  LoginRateLimitMiddleware,
  RefreshRateLimitMiddleware,
  SessionValidationMiddleware,
} from '@common/middleware';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EmailModule,
    OrganizationsModule,
    // AuditModule, // Removed to use global CommonAuditModule
    OnboardingModule,
    LegalAcceptancesModule,
    ResponseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          secret:
            configService.get<string>('JWT_SECRET') ||
            'your-super-secret-jwt-key',
          signOptions: {
            expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ||
              '15m') as any,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EnvironmentSwitchService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionValidationMiddleware)
      .forRoutes({ path: 'auth/refresh', method: RequestMethod.POST });

    consumer
      .apply(LoginRateLimitMiddleware)
      .forRoutes({ path: 'auth/login', method: RequestMethod.POST });

    consumer
      .apply(RefreshRateLimitMiddleware)
      .forRoutes({ path: 'auth/refresh', method: RequestMethod.POST });

    consumer
      .apply(RateLimitMiddleware)
      .forRoutes(
        { path: 'auth/register-owner', method: RequestMethod.POST },
        { path: 'auth/register-customer', method: RequestMethod.POST },
        { path: 'auth/register-staff', method: RequestMethod.POST },
        { path: 'auth/forgot-password', method: RequestMethod.POST },
        { path: 'auth/reset-password', method: RequestMethod.POST },
      );
  }
}
