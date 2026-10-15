import { Injectable, OnModuleInit } from '@nestjs/common';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { DianHabilitationScannerService } from './dian-config/dian-habilitation-scanner.service';
import { ResolutionScannerService } from './resolutions/resolution-scanner.service';
import { InvoiceDraftScannerService } from './invoice-draft-scan/invoice-draft-scanner.service';

/**
 * Registra UNA sola vez los handlers `dian_habilitation`, `dian_resolution` e
 * `invoice_draft` de la cola `ai-scan`. Los scanners se proveen también en otros módulos
 * (org, superadmin); este registrar se declara solo en `InvoicingModule`.
 */
@Injectable()
export class FiscalScanHandlersRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: AiScanHandlerRegistry,
    private readonly habilitationScanner: DianHabilitationScannerService,
    private readonly resolutionScanner: ResolutionScannerService,
    private readonly invoiceDraftScanner: InvoiceDraftScannerService,
  ) {}

  onModuleInit(): void {
    this.registry.register('dian_habilitation', ({ files }) =>
      this.habilitationScanner.scanHabilitationFromFiles(files),
    );
    this.registry.register('dian_resolution', ({ files }) =>
      this.resolutionScanner.scanResolutionFromFiles(files),
    );
    // Borrador de factura de venta: la nota libre viaja en `params.note`.
    this.registry.register('invoice_draft', ({ files, params }) =>
      this.invoiceDraftScanner.scanDraftFromFiles(files, {
        note: typeof params?.note === 'string' ? params.note : null,
      }),
    );
  }
}
