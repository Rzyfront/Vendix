import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './domains/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './domains/organization/users/users.module';
import { TestModule } from './test/test.module';
import { DomainsModule } from './domains/domains.module';

import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './domains/auth/guards/jwt-auth.guard';
import { RequestContextService } from '@common/context/request-context.service';
import { RequestContextInterceptor } from '@common/interceptors/request-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    PrismaModule,
    UsersModule,
    TestModule,
    DomainsModule, // ✅ Módulo de dominios (público y privado)
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestContextService, // ✅ Servicio de contexto con AsyncLocalStorage
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule { }
