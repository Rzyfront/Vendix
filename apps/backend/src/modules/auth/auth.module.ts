import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuditModule } from '../audit/audit.module';
import { RateLimitMiddleware, LoginRateLimitMiddleware, RefreshRateLimitMiddleware } from '../../common/utils/rate-limit.middleware';
import { SessionValidationMiddleware } from '../../common/utils/session-validation.middleware';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EmailModule,
    OrganizationsModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'your-super-secret-jwt-key',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
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
        { path: 'auth/reset-password', method: RequestMethod.POST }
      );
  }
}
