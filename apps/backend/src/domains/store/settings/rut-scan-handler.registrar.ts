import { Injectable, OnModuleInit } from '@nestjs/common';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { RutScannerService } from './rut-scanner.service';

/**
 * Registra UNA sola vez el handler `rut` de la cola `ai-scan`.
 * `RutScannerService` se provee en varios módulos (store, org, superadmin);
 * registrar en su `onModuleInit` lanzaría por kind duplicado, por eso el
 * registro vive en este provider, declarado solo en el módulo de settings de store.
 */
@Injectable()
export class RutScanHandlerRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: AiScanHandlerRegistry,
    private readonly rutScanner: RutScannerService,
  ) {}

  onModuleInit(): void {
    this.registry.register('rut', ({ files }) =>
      this.rutScanner.scanRutFromFiles(files),
    );
  }
}
