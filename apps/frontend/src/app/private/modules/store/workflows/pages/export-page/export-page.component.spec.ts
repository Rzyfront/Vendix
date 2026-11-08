import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import {
  WorkflowExport,
  WorkflowExportApiService,
  WorkflowExportDownload,
} from '../../services/workflow-export-api.service';
import { EXPORT_POLL_MS, ExportPageComponent, formatBytes } from './export-page.component';

function item(overrides: Partial<WorkflowExport>): WorkflowExport {
  return {
    id: 1,
    status: 'ready',
    size_bytes: 1_572_864,
    file_count: 3,
    counts: {},
    error: null,
    created_at: '2026-11-08T15:00:00.000Z',
    started_at: '2026-11-08T15:01:00.000Z',
    completed_at: '2026-11-08T15:02:00.000Z',
    expires_at: '2026-11-15T15:02:00.000Z',
    ...overrides,
  };
}

describe('ExportPageComponent', () => {
  let fixture: ComponentFixture<ExportPageComponent>;
  let listResult: () => Observable<WorkflowExport[]>;
  let requestResult: () => Observable<WorkflowExport>;
  let downloadResult: (id: number) => Observable<WorkflowExportDownload>;
  let listCalls: number;
  let requestCalls: number;
  let downloadCalls: number[];
  let opened: Array<{ url: string; target: string | undefined }>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => root().textContent ?? '';
  const button = (label: string): HTMLButtonElement | null =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes(label),
    ) ?? null;

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(ExportPageComponent);
    spyOn(window, 'open').and.callFake(
      (url?: string | URL, target?: string) => {
        opened.push({ url: String(url), target });
        return null;
      },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    listCalls = 0;
    requestCalls = 0;
    downloadCalls = [];
    opened = [];
    listResult = () => of([]);
    requestResult = () => of(item({ status: 'pending', size_bytes: null, file_count: 0, expires_at: null }));
    downloadResult = () => of({ url: 'https://s3.test/x.zip', file_name: 'x.zip', expires_in: 300 });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: WorkflowExportApiService,
          useValue: {
            list: () => {
              listCalls++;
              return listResult();
            },
            request: () => {
              requestCalls++;
              return requestResult();
            },
            download: (id: number) => {
              downloadCalls.push(id);
              return downloadResult(id);
            },
          },
        },
      ],
    });
  });

  afterEach(() => jasmine.clock().uninstall());

  it('explica qué contiene el ZIP y muestra el botón Generar exportación', async () => {
    await render();
    expect(text()).toContain('Qué incluye el ZIP');
    expect(text()).toContain('La auditoría completa');
    expect(text()).toContain('Nunca incluye los valores de tus secretos');
    expect(button('Generar exportación')).not.toBeNull();
    expect(root().querySelector('[data-testid="export-empty"]')?.textContent).toContain(
      'Aún no has generado ninguna exportación.',
    );
  });

  it('lista cada exportación con su estado, tamaño, archivos y vencimiento', async () => {
    listResult = () =>
      of([
        item({ id: 5 }),
        item({ id: 4, status: 'pending', size_bytes: null, expires_at: null }),
        item({ id: 3, status: 'running', size_bytes: null, expires_at: null }),
        item({ id: 2, status: 'failed', size_bytes: null, error: 'No se pudo generar la exportación. Intenta de nuevo.' }),
        item({ id: 1, status: 'expired' }),
      ]);
    await render();
    const rows = Array.from(root().querySelectorAll('[data-testid="export-row"]')).map((r) => r.textContent ?? '');
    expect(rows.length).toBe(5);
    expect(rows[0]).toContain('Lista');
    expect(rows[0]).toContain('1,5 MB');
    expect(rows[0]).toContain('3');
    expect(rows[1]).toContain('Pendiente');
    expect(rows[2]).toContain('Generando');
    expect(rows[3]).toContain('Falló');
    expect(rows[3]).toContain('No se pudo generar la exportación. Intenta de nuevo.');
    expect(rows[4]).toContain('Vencida');
    // Only a ready export can be downloaded.
    expect(Array.from(root().querySelectorAll('button')).filter((b) => b.textContent?.includes('Descargar')).length).toBe(1);
  });

  it('Generar exportación pide la exportación y recarga la lista', async () => {
    await render();
    button('Generar exportación')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(requestCalls).toBe(1);
    expect(listCalls).toBe(2);
  });

  it('muestra "Ya hay una exportación en curso" cuando la API responde 409', async () => {
    requestResult = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error_code: 'WORKFLOW_EXPORT_IN_PROGRESS', message: 'Ya hay una exportación en curso.' },
          }),
      );
    await render();
    button('Generar exportación')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root().querySelector('[data-testid="export-message"]')?.textContent).toContain(
      'Ya hay una exportación en curso',
    );
  });

  it('Descargar pide la URL firmada y la abre en otra pestaña', async () => {
    listResult = () => of([item({ id: 9 })]);
    await render();
    button('Descargar')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(downloadCalls).toEqual([9]);
    expect(opened).toEqual([{ url: 'https://s3.test/x.zip', target: '_blank' }]);
  });

  it('si la descarga falla (vencida) muestra el mensaje y no abre nada', async () => {
    listResult = () => of([item({ id: 9 })]);
    downloadResult = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 410,
            error: { error_code: 'WORKFLOW_EXPORT_EXPIRED', message: 'La exportación venció. Solicita una nueva.' },
          }),
      );
    await render();
    button('Descargar')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(opened).toEqual([]);
    expect(text()).toContain('La exportación venció. Solicita una nueva.');
  });

  it('muestra el error de carga de la lista', async () => {
    listResult = () => throwError(() => new HttpErrorResponse({ status: 500 }));
    await render();
    expect(root().querySelector('[role="alert"]')).not.toBeNull();
  });

  it('refresca cada pocos segundos solo mientras hay una pendiente o en curso, y se detiene al destruir', () => {
    jasmine.clock().install();
    let current: WorkflowExport[] = [item({ id: 2, status: 'running', size_bytes: null, expires_at: null })];
    listResult = () => of(current);
    fixture = TestBed.createComponent(ExportPageComponent);
    fixture.detectChanges();
    expect(listCalls).toBe(1);

    jasmine.clock().tick(EXPORT_POLL_MS);
    expect(listCalls).toBe(2);

    current = [item({ id: 2 })];
    jasmine.clock().tick(EXPORT_POLL_MS);
    expect(listCalls).toBe(3);
    jasmine.clock().tick(EXPORT_POLL_MS * 3);
    expect(listCalls).toBe(3);

    current = [item({ id: 3, status: 'pending', size_bytes: null, expires_at: null })];
    fixture.componentInstance.requestExport();
    expect(listCalls).toBe(4);
    fixture.destroy();
    jasmine.clock().tick(EXPORT_POLL_MS * 3);
    expect(listCalls).toBe(4);
  });

  it('formatea el tamaño con unidades y decimales es-CO', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_572_864)).toBe('1,5 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3 GB');
  });
});
