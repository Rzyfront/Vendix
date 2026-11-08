import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { ReportExportService } from '../../../reports/services/report-export.service';
import {
  WorkflowAuditApiService,
  WorkflowAuditEntry,
  WorkflowAuditFilters,
  WorkflowAuditPage,
  WorkflowAuditVerification,
} from '../../services/workflow-audit-api.service';
import { AuditPageComponent, verificationMessage } from './audit-page.component';

function entry(overrides: Partial<WorkflowAuditEntry> = {}): WorkflowAuditEntry {
  return {
    id: '10',
    seq: '3',
    created_at: '2026-11-08T15:00:00.000Z',
    category: 'secret',
    category_label: 'Secretos',
    action: 'secret.created',
    action_label: 'Secreto creado',
    actor: { type: 'user', id: 4, name: 'Laura Pérez' },
    target: { type: 'secret', type_label: 'Secreto', id: '9' },
    definition_id: null,
    instance_id: null,
    summary: 'Creó el secreto API_KEY',
    details: {},
    ip_address: null,
    user_agent: null,
    prev_hash: null,
    entry_hash: 'h',
    ...overrides,
  };
}

const page = (items: WorkflowAuditEntry[], extra: Partial<WorkflowAuditPage> = {}): WorkflowAuditPage => ({
  items,
  total: items.length,
  page: 1,
  limit: 25,
  totalPages: 1,
  ...extra,
});

describe('AuditPageComponent', () => {
  let fixture: ComponentFixture<AuditPageComponent>;
  let listResult: () => Observable<WorkflowAuditPage>;
  let verifyResult: () => Observable<WorkflowAuditVerification>;
  let exportResult: () => Observable<Blob>;
  let listCalls: Array<{ filters: WorkflowAuditFilters; page: number }>;
  let exportFilters: WorkflowAuditFilters[];
  let downloads: Array<{ blob: Blob; name: string }>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => root().textContent ?? '';
  const button = (label: string): HTMLButtonElement | null =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(label)) ??
    null;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(AuditPageComponent);
    await settle();
  }

  beforeEach(() => {
    listCalls = [];
    exportFilters = [];
    downloads = [];
    listResult = () => of(page([entry()]));
    verifyResult = () => of({ valid: true, count: 42, broken_at_seq: null });
    exportResult = () => of(new Blob(['x']));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: WorkflowAuditApiService,
          useValue: {
            list: (filters: WorkflowAuditFilters, p: number) => {
              listCalls.push({ filters, page: p });
              return listResult();
            },
            verify: () => verifyResult(),
            export: (filters: WorkflowAuditFilters) => {
              exportFilters.push(filters);
              return exportResult();
            },
          },
        },
        {
          provide: ReportExportService,
          useValue: { downloadBlob: (blob: Blob, name: string) => downloads.push({ blob, name }) },
        },
      ],
    });
  });

  it('shows date, category, action in Spanish, actor, object and summary of each record', async () => {
    await render();
    const row = root().querySelector('[data-testid="audit-table"] tbody tr') as HTMLElement;
    expect(row.textContent).toContain('Secretos');
    expect(row.textContent).toContain('Secreto creado');
    expect(row.textContent).toContain('Laura Pérez');
    expect(row.textContent).toContain('Secreto #9');
    expect(row.textContent).toContain('Creó el secreto API_KEY');
    expect(listCalls[0]).toEqual({ filters: { from: undefined, to: undefined, category: undefined, search: undefined }, page: 1 });
  });

  it('says so when there are no records', async () => {
    listResult = () => of(page([]));
    await render();
    expect(root().querySelector('[data-testid="audit-empty"]')?.textContent).toContain('No hay registros');
  });

  it('shows the API error when the list fails', async () => {
    listResult = () => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } }));
    await render();
    expect(root().querySelector('[data-testid="audit-table"]')).toBeNull();
    expect(text()).not.toContain('Cargando registros');
  });

  it('applies the category filter and goes back to page 1', async () => {
    await render();
    fixture.componentInstance.onPage(3);
    fixture.componentInstance.onCategory('decision');
    expect(listCalls[listCalls.length - 1]).toEqual({
      filters: { from: undefined, to: undefined, category: 'decision', search: undefined },
      page: 1,
    });
  });

  it('applies the date range and the search text', async () => {
    await render();
    fixture.componentInstance.onRange({ from: '2026-11-01', to: '2026-11-08' });
    fixture.componentInstance.onSearch('  firma ');
    expect(listCalls[listCalls.length - 1].filters).toEqual({
      from: '2026-11-01',
      to: '2026-11-08',
      category: undefined,
      search: 'firma',
    });
  });

  it('ignores an unknown category value', async () => {
    await render();
    fixture.componentInstance.onCategory('hack');
    expect(fixture.componentInstance.category()).toBe('');
  });

  it('Verificar integridad shows "Cadena íntegra: N registros verificados"', async () => {
    await render();
    button('Verificar integridad')?.click();
    await settle();
    expect(root().querySelector('[data-testid="verification-message"]')?.textContent).toContain(
      'Cadena íntegra: 42 registros verificados',
    );
  });

  it('a broken chain shows the record where it breaks', async () => {
    verifyResult = () => of({ valid: false, count: 42, broken_at_seq: '17' });
    await render();
    button('Verificar integridad')?.click();
    await settle();
    expect(root().querySelector('[data-testid="verification-message"]')?.textContent).toContain(
      'La cadena se rompe en el registro #17',
    );
  });

  it('verificationMessage covers both outcomes', () => {
    expect(verificationMessage({ valid: true, count: 1, broken_at_seq: null })).toBe(
      'Cadena íntegra: 1 registros verificados',
    );
    expect(verificationMessage({ valid: false, count: 5, broken_at_seq: '2' })).toBe(
      'La cadena se rompe en el registro #2',
    );
  });

  it('Exportar downloads the workbook with the active filters', async () => {
    await render();
    fixture.componentInstance.onCategory('export');
    button('Exportar')?.click();
    await settle();
    expect(exportFilters[0].category).toBe('export');
    expect(downloads.length).toBe(1);
    expect(downloads[0].name).toMatch(/^auditoria-flujos-\d{4}-\d{2}-\d{2}$/);
  });

  it('a failed export downloads nothing and the button is usable again', async () => {
    exportResult = () => throwError(() => new HttpErrorResponse({ status: 503 }));
    await render();
    button('Exportar')?.click();
    await settle();
    expect(downloads.length).toBe(0);
    expect(fixture.componentInstance.exporting()).toBeFalse();
  });
});
