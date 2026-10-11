import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentDir = __dirname;
const source = readFileSync(
  join(componentDir, 'support-document-list.component.ts'),
  'utf8',
);
const template = readFileSync(
  join(componentDir, 'support-document-list.component.html'),
  'utf8',
);

describe('support document list UI source guards', () => {
  it('uses the responsive card, dropdown filters/actions, and a real shared search binding', () => {
    expect(template).toContain('<div class="w-full">');
    expect(template).toContain('<app-card [responsive]="true" [padding]="false" overflow="visible">');
    expect(template).toContain('sticky top-0');
    expect(template).toContain('md:static');
    expect(template).toContain('[(ngModel)]="searchTerm"');
    expect(template).toContain('(searchChange)="onSearch($event)"');
    expect(template).toContain('ariaLabel="Buscar documentos soporte"');
    expect(template).toContain('[filterValues]="filterValues()"');
    expect(source).toContain("key: 'status'");
    expect(source).toContain("key: 'invoice_type'");
    expect(source).toContain("key: 'date_from', label: 'Desde', type: 'date'");
    expect(source).toContain("key: 'date_to', label: 'Hasta', type: 'date'");
    expect(source).toContain("action: 'create'");
    expect(source).toContain("action: 'refresh'");
  });

  it('keeps filters, reset, and server pagination in signal state', () => {
    expect(source).toContain('readonly filters = signal<SupportDocumentFilters>');
    expect(source).toContain('readonly filterValues = computed<FilterValues>');
    expect(source).toContain('page: 1');
    expect(source).toContain('readonly totalItems = signal(0)');
    expect(source).toContain('readonly totalPages = computed');
    expect(source).toContain('onPageChange(page: number)');
    expect(source).toContain('this.filters.update((current) => ({ ...current, page: nextPage }));');
    expect(source).toContain('effect(() => {');
    expect(source).toContain('const supplierId = this.initialSupplierId()');
    expect(source).toContain('untracked(() => {');
    expect(source).toContain('this.initialSupplierId()');
    expect(source).toContain("invoice_type: 'support_document'");
    expect(template).toContain('<app-pagination');
    expect(template).toContain('[currentPage]="filters().page"');
    expect(template).toContain('{{ totalItems() }}');
    expect(template).toContain('[total]="totalItems()"');
    expect(template).not.toMatch(/@if\s*\([^)]*totalPages/);
  });

  it('uses shared CVA controls for CUDS and accessible error/empty actions', () => {
    expect(template).toContain('<app-input');
    expect(template).toContain('label="Buscar por CUDS"');
    expect(template).toContain('tooltipText=');
    expect(template).not.toMatch(/<input\b/i);
    expect(template).toContain('role="alert"');
    expect(template).toContain('rowLabelKey="invoice_number"');
    expect(template).toContain('md:p-4');
    expect(template).toContain('(emptyRefreshClick)="load()"');
    expect(template).toContain('(emptyClearFiltersClick)="clearFilters()"');
    expect(template).toContain('min-h-11');
  });

  it('keeps display formatters and cancels superseded server requests', () => {
    expect(source).toContain('CurrencyFormatService');
    expect(source).toContain('this.currencyService.format');
    expect(source).toContain('formatDateOnlyUTC');
    expect(source).toContain('switchMap((query) =>');
    expect(source).toContain('this.service.list(query)');
    expect(source).toContain('response.meta?.total');
    expect(source).toContain('badge: true');
    expect(source).toContain('badgeTransform: (value: unknown) => this.getStatusLabel(String(value))');
    expect(source).toContain("colorMap: {");
    expect(source).toContain("type: 'custom'");
    expect(source).toContain("'var(--color-success)'");
    expect(source).toContain("'var(--color-error)'");
  });

  it('does not use unsafe casts, fake client sorting, or guessed local styling', () => {
    expect(source).not.toMatch(/\$any\s*\(/);
    expect(source).not.toMatch(/\bany\b/);
    expect(template).not.toContain('[sortable]="true"');
    expect(template).not.toMatch(/rgba\s*\(/i);
    expect(template).not.toContain('text-red-');
    expect(template).not.toContain('bg-red-');
  });
});
