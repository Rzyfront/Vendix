import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';

import { InvoiceDraftScanModalComponent } from './invoice-draft-scan-modal.component';
import { InvoiceDraftScannerService } from '../../services/invoice-draft-scanner.service';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import type { InvoiceDraftScanResult } from '../../interfaces/invoice-draft-scan.interface';

/**
 * FacturIA: textos del modal (sin «borrador»), CTA con estilo IA y barra de
 * progreso compartida (QUI-1020) que se detiene al terminar o cancelar.
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
          useValue: {
            scanDraft: () => job.asObservable(),
            resume: () => null,
            forget: () => undefined,
          },
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

  it('al lanzar el análisis muestra la barra compartida con el archivo conservado', () => {
    component.files.set([pdf()]);
    component.startScan();
    fixture.detectChanges();

    const stage = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="facturia-progress"]',
    );
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('app-ai-job-progress')).not.toBeNull();
    expect(component.scanning()).toBeTrue();
    expect(text().toLowerCase()).not.toContain('borrador');
  });

  it('al fallar conserva los archivos y deja la barra con su error para reintentar', () => {
    component.files.set([pdf()]);
    component.startScan();
    job.error(new Error('fallo'));
    fixture.detectChanges();

    expect(component.scanning()).toBeFalse();
    expect(component.failed()).toBeTrue();
    expect(component.files().length).toBe(1);

    component.backToFiles();
    expect(component.failed()).toBeFalse();
    expect(component.files().length).toBe(1);
  });

  it('al terminar el análisis sale el resultado', () => {
    const results: InvoiceDraftScanResult[] = [];
    component.scanned.subscribe((result) => results.push(result));
    component.files.set([pdf()]);
    component.startScan();

    job.next({} as InvoiceDraftScanResult);
    job.complete();
    expect(results.length).toBe(1);
    expect(component.scanning()).toBeFalse();
  });

  it('cancelar el análisis vuelve al formulario y descarta el trabajo recordado', () => {
    component.files.set([pdf()]);
    component.startScan();
    expect(component.scanning()).toBeTrue();

    component.cancelScan();
    expect(component.scanning()).toBeFalse();
    expect(component.failed()).toBeFalse();
  });
});
