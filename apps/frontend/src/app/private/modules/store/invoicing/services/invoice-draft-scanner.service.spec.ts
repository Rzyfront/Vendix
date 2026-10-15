import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import { AiScanJobService } from '../../../../../core/services/ai-scan-job.service';
import type { InvoiceDraftScanResult } from '../interfaces/invoice-draft-scan.interface';
import {
  INVOICE_DRAFT_SCAN_PLATFORM_PATH,
  InvoiceDraftScannerService,
  buildInvoiceDraftScanFormData,
} from './invoice-draft-scanner.service';

const file = (name: string, type = 'application/pdf'): File =>
  new File(['x'], name, { type });

/**
 * Escáner de «Nueva factura»: la forma del multipart es el contrato con el
 * backend (`files` × N + `note` opcional) y la ruta es la `.../async` de la
 * cola `ai-scan`.
 */
describe('InvoiceDraftScannerService', () => {
  it('FormData: un `files` por documento y la nota recortada', () => {
    const data = buildInvoiceDraftScanFormData(
      [file('cotizacion.pdf'), file('rut.png', 'image/png'), file('oc.webp', 'image/webp')],
      '  facturar el 50 % del anticipo  ',
    );
    const files = data.getAll('files') as File[];
    expect(files.length).toBe(3);
    expect(files.map((f) => f.name)).toEqual([
      'cotizacion.pdf',
      'rut.png',
      'oc.webp',
    ]);
    expect(data.get('note')).toBe('facturar el 50 % del anticipo');
  });

  it('FormData: sin nota no viaja el campo y se respeta el tope de 6', () => {
    const many = Array.from({ length: 8 }, (_, i) => file(`doc-${i}.pdf`));
    const data = buildInvoiceDraftScanFormData(many, '   ');
    expect(data.getAll('files').length).toBe(6);
    expect(data.has('note')).toBeFalse();
  });

  it('scanDraft: encola en /store/invoicing/scan-draft/async con el FormData', async () => {
    const result = { documents_scanned: 2 } as InvoiceDraftScanResult;
    const enqueueAndWait = jasmine
      .createSpy('enqueueAndWait')
      .and.returnValue(of(result));
    TestBed.configureTestingModule({
      providers: [{ provide: AiScanJobService, useValue: { enqueueAndWait } }],
    });
    const service = TestBed.inject(InvoiceDraftScannerService);
    const onStall = (): void => undefined;

    const out = await firstValueFrom(
      service.scanDraft([file('a.pdf'), file('b.jpg', 'image/jpeg')], 'pago a 30 días', {
        onStall,
      }),
    );

    expect(out).toBe(result);
    expect(enqueueAndWait).toHaveBeenCalledTimes(1);
    const [url, body, opts] = enqueueAndWait.calls.mostRecent().args as [
      string,
      FormData,
      { onStall: () => void },
    ];
    expect(url).toBe(`${environment.apiUrl}/store/invoicing/scan-draft/async`);
    expect(body.getAll('files').length).toBe(2);
    expect(body.get('note')).toBe('pago a 30 días');
    expect(opts.onStall).toBe(onStall);
  });

  it('scanDraft: con la ruta de plataforma encola en superadmin/.../scan-draft/async', async () => {
    const result = { documents_scanned: 1 } as InvoiceDraftScanResult;
    const enqueueAndWait = jasmine
      .createSpy('enqueueAndWait')
      .and.returnValue(of(result));
    TestBed.configureTestingModule({
      providers: [{ provide: AiScanJobService, useValue: { enqueueAndWait } }],
    });
    const service = TestBed.inject(InvoiceDraftScannerService);

    await firstValueFrom(
      service.scanDraft([file('a.pdf')], null, undefined, INVOICE_DRAFT_SCAN_PLATFORM_PATH),
    );

    const [url] = enqueueAndWait.calls.mostRecent().args as [string];
    expect(url).toBe(
      `${environment.apiUrl}/superadmin/subscriptions/fiscal/sales-invoices/scan-draft/async`,
    );
  });
});
