import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * Módulo de Dominios
 *
 * Maneja toda la lógica relacionada con dominios:
 * - Resolución de dominios (público con @Public())
 * - CRUD de dominios (privado)
 * - Verificación DNS
 * - Todo consolidado en DomainsService
 */
@Module({
  imports: [
    PrismaModule,
    EventEmitterModule.forRoot(), // EventEmitter para gestión de caché
  ],
  controllers: [DomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
