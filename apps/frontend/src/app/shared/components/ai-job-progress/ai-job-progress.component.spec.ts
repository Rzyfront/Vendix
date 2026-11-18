import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AiJobProgressComponent } from './ai-job-progress.component';
import { AiJobProgress } from '../../utils/ai-job-progress';
import { AiScanJobError } from '../../../core/utils/ai-job-error';

/** QUI-1020 — barra compartida de los procesos con IA. */
describe('AiJobProgressComponent (QUI-1020)', () => {
  let fixture: ComponentFixture<AiJobProgressComponent>;
  let progress: AiJobProgress;

  const el = () => fixture.nativeElement as HTMLElement;
  const bar = () => el().querySelector('[role="progressbar"]');

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    localStorage.removeItem('vendix:ai-job-durations:v1');
    TestBed.configureTestingModule({ imports: [AiJobProgressComponent] });
    progress = new AiJobProgress({ kind: 'rut' });
    fixture = TestBed.createComponent(AiJobProgressComponent);
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
  });

  afterEach(() => {
    progress.dispose();
    jasmine.clock().uninstall();
  });

  it('no pinta nada hasta que el proceso arranca', () => {
    expect(bar()).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  it('pinta la barra desde el primer segundo, con fase, porcentaje y tiempo', () => {
    progress.onUploadStart();
    jasmine.clock().tick(5_000);
    progress.onStatus({ status: 'active' });
    fixture.detectChanges();
    expect(bar()?.getAttribute('aria-valuenow')).toBe(String(progress.percent()));
    expect(progress.percent()).toBeGreaterThan(0);
    expect(el().textContent).toContain('Analizando con IA…');
    expect(el().textContent).toContain('5 s');
  });

  it('pasado el estimado muestra «Sigue procesando…»', () => {
    progress.onUploadStart();
    progress.onStatus({ status: 'active' });
    jasmine.clock().tick(40_000);
    fixture.detectChanges();
    expect(el().textContent).toContain('Sigue procesando…');
  });

  it('avisa que el equipo ya sabe cuando el servidor marca el trabajo colgado', () => {
    progress.onUploadStart();
    progress.onStatus({ status: 'active', stalled: true });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="ai-job-stalled"]')?.textContent).toContain(
      'Ya avisamos al equipo de Vendix',
    );
  });

  it('un fallo reemplaza la barra por el panel de su categoría y ofrece reintentar', () => {
    let retries = 0;
    fixture.componentRef.setInput('showRetry', true);
    fixture.componentInstance.retry.subscribe(() => retries++);
    progress.onUploadStart();
    progress.onFailed(
      new AiScanJobError('No pudimos leer el RUT.', 'document', 'RUT_SCAN_PARSE_FAIL'),
    );
    fixture.detectChanges();

    const panel = el().querySelector('[data-testid="ai-job-error"]');
    expect(bar()).toBeNull();
    expect(panel?.getAttribute('data-category')).toBe('document');
    expect(panel?.textContent).toContain('No pudimos leer tu documento');
    expect(panel?.textContent).toContain('No pudimos leer el RUT.');

    (el().querySelector('app-button button') as HTMLButtonElement).click();
    expect(retries).toBe(1);
  });
});
