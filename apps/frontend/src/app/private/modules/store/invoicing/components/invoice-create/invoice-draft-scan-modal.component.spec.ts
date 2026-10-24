import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';

import {
  FACTURIA_PROGRESS_INTERVAL_MS,
  FACTURIA_PROGRESS_MESSAGES,
  InvoiceDraftScanModalComponent,
} from './invoice-draft-scan-modal.component';
import { InvoiceDraftScannerService } from '../../services/invoice-draft-scanner.service';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import type { InvoiceDraftScanResult } from '../../interfaces/invoice-draft-scan.interface';

/**
 * FacturIA: textos del modal (sin «borrador»), CTA con estilo IA y progreso
 * rotativo con setInterval que se limpia al terminar, cancelar o destruir.
 *
 * El escáner se dobla con un Subject: el job queda «en curso» hasta que el
 * spec decide su desenlace.
 */
describe('InvoiceDraftScanModalComponent · FacturIA', () => {
  let fixture: ComponentFixture<InvoiceDraftScanModalComponent>;
  let component: InvoiceDraftScanModalComponent;
  let job: Subject<InvoiceDraftScanResult>;

  const text = (): string =>
    (((fixture.nativeElement as HTMLElement).textContent ?? '') +
      (document.body.textContent ?? '')).replace(/\s+/g, ' ');

  const pdf = (): File => new File(['%PDF-1.4'], 'cotizacion.pdf', { type: 'application/pdf' });

  beforeEach(async () => {
    jasmine.clock().install();
    job = new Subject<InvoiceDraftScanResult>();
    await TestBed.configureTestingModule({
      imports: [InvoiceDraftScanModalComponent],
      providers: [
        {
          provide: InvoiceDraftScannerService,
          useValue: { scanDraft: () => job.asObservable() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvoiceDraftScanModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('título, descripción y CTA de FacturIA, sin «borrador»', () => {
    expect(text()).toContain('FacturIA · Análisis inteligente de documentos');
    expect(text()).toContain(
      'Sube RUT, cotizaciones, contratos u órdenes de compra. FacturIA los analiza y completa automáticamente esta factura para que solo revises y emitas.',
    );
    const description = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="facturia-description"]',
    );
    expect(description?.querySelector('.vx-ai-text')?.textContent?.trim()).toBe('IA');

    const cta = fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .find((de) =>
        ((de.nativeElement as HTMLElement).textContent ?? '').includes('Analizar y autocompletar'),
      );
    expect(cta).toBeDefined();
    expect(cta!.componentInstance.variant()).toBe('ai');

    expect(text().toLowerCase()).not.toContain('borrador');
    expect(text()).not.toContain('Leer con IA');
    expect(text()).not.toContain('Cargar documentos');
  });

  it('el progreso rota cada ~2.2 s con los cuatro mensajes y vuelve a empezar', () => {
    component.files.set([pdf()]);
    component.startScan();
    fixture.detectChanges();

    const message = () =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="facturia-progress-message"]')
        ?.textContent?.trim();
    const stage = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="facturia-progress"]',
    );
    expect(stage?.classList).toContain('vx-ai-stage');
    expect(stage?.classList).toContain('is-analyzing');
    expect(message()).toBe('Leyendo documentos…');

    const seen: (string | undefined)[] = [];
    for (let i = 0; i < FACTURIA_PROGRESS_MESSAGES.length; i++) {
      jasmine.clock().tick(FACTURIA_PROGRESS_INTERVAL_MS);
      fixture.detectChanges();
      seen.push(message());
    }
    expect(seen).toEqual([
      'Identificando al adquiriente…',
      'Extrayendo líneas de cobro…',
      'Completando la factura…',
      'Leyendo documentos…',
    ]);
    expect(text().toLowerCase()).not.toContain('borrador');
  });

  it('al terminar el análisis el intervalo se detiene y sale el resultado', () => {
    const results: InvoiceDraftScanResult[] = [];
    component.scanned.subscribe((result) => results.push(result));
    component.files.set([pdf()]);
    component.startScan();

    job.next({} as InvoiceDraftScanResult);
    job.complete();
    expect(results.length).toBe(1);

    const before = component.progressIndex();
    jasmine.clock().tick(FACTURIA_PROGRESS_INTERVAL_MS * 3);
    expect(component.progressIndex()).toBe(before);
  });

  it('cancelar el análisis detiene la rotación', () => {
    component.files.set([pdf()]);
    component.startScan();
    jasmine.clock().tick(FACTURIA_PROGRESS_INTERVAL_MS);
    expect(component.progressIndex()).toBe(1);

    component.cancelScan();
    jasmine.clock().tick(FACTURIA_PROGRESS_INTERVAL_MS * 3);
    expect(component.progressIndex()).toBe(1);
    expect(component.scanning()).toBeFalse();
  });
});
