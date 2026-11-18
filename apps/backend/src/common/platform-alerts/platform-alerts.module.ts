import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PlatformOrgService } from '../services/platform-org.service';
import { PlatformAlertJobWatcherService } from './platform-alert-job-watcher.service';
import { PlatformAlertService } from './platform-alert.service';
import { TelegramNotifierService } from './telegram-notifier.service';

/**
 * Bot de monitoreo de la API (QUI-1010). Global: el filtro de excepciones
 * (main.ts), el interceptor de rendimiento y el controlador de Superadmin lo
 * usan sin importarlo. Prisma, Redis, Config, el EventEmitter y
 * `PlatformIncidentService` (QUI-1009) llegan por sus módulos globales.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    PlatformOrgService,
    TelegramNotifierService,
    PlatformAlertService,
    PlatformAlertJobWatcherService,
  ],
  exports: [PlatformAlertService, TelegramNotifierService],
})
export class PlatformAlertsModule {}
