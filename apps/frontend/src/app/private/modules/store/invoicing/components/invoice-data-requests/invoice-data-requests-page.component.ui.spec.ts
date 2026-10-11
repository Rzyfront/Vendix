import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, 'invoice-data-requests-page.component.ts'),
  'utf8',
);

describe('invoice data requests UI source contract', () => {
  it('uses the standard dropdown with all six request statuses and refresh action', () => {
    expect(source).toContain('OptionsDropdownComponent');
    expect(source).toContain('[filters]="filterConfigs"');
    expect(source).toContain("action: 'reload'");
    for (const status of [
      'pending',
      'submitted',
      'processing',
      'completed',
      'expired',
      'failed',
    ]) {
      expect(source).toContain(`'${status}'`);
    }
    expect(source).not.toContain('pillClass');
    expect(source).not.toContain('rounded-full border transition-colors');
  });

  it('keeps server pagination and UI filter state in signals', () => {
    expect(source).toContain('readonly filters = signal({ page: 1, limit: 10 })');
    expect(source).toContain('readonly totalItems = signal(0)');
    expect(source).toContain('readonly totalPages = computed');
    expect(source).toContain('readonly filterValues = computed<FilterValues>');
    expect(source).toContain('[currentPage]="filters().page"');
    expect(source).toContain('(pageChange)="onPageChange($event)"');
    expect(source).toContain('[ngModel]="searchValue()"');
    expect(source).toContain('(search)="onSearch($event)"');
    expect(source).toContain('(clear)="onSearch(\'\')"');
    expect(source).toContain('this.searchValue.set(\'\')');
    expect(source).toContain('if (term !== this.searchValue()) return;');
    expect(source).toContain('<app-card [responsive]="true" [padding]="false" overflow="visible">');
    expect(source).toContain('sticky top-[99px]');
    expect(source).toContain('flex flex-wrap items-center gap-2 w-full min-w-0');
    expect(source).toContain('min-w-0 flex-1 basis-40');
    expect(source).not.toContain('rgba(');
    expect(source).not.toContain('app-sticky-header');
    expect(source.indexOf('</app-responsive-data-view>')).toBeLessThan(
      source.indexOf('<app-pagination'),
    );
  });

  it('renders four non-interactive stats cards with theme tokens', () => {
    expect((source.match(/<app-stats\b/g) ?? [])).toHaveLength(4);
    expect(source).not.toContain('[clickable]="true"');
    expect(source).not.toContain('role="button"');
    expect(source).toContain('iconBgColor="bg-primary/10"');
    expect(source).toContain('iconBgColor="bg-warning/10"');
    expect(source).toContain('iconBgColor="bg-error/10"');
    expect(source).toContain('iconBgColor="bg-success/10"');
    expect(source).toContain("'var(--color-warning)'");
    expect(source).toContain("'var(--color-success)'");
    expect(source).toContain("'var(--color-error)'");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('localizes desktop status cell text as well as status badges', () => {
    expect(source).toMatch(
      /key: 'status',[\s\S]*?transform: \(value\) =>\s*STATUS_LABELS\[value as InvoiceDataRequestStatus\]/,
    );
    expect(source).toContain('badgeTransform: (value) =>');
  });

  it('preserves process-only-for-submitted and treats null as a warning', () => {
    expect(source).toContain("show: (item) => item?.status === 'submitted'");
    expect(source).toContain('disabled: () => this.processingId() !== null');
    expect(source).toContain("if (row.status !== 'submitted' || this.processingId() !== null)");
    expect(source).toContain('if (response?.data)');
    expect(source).toContain('this.toast.warning(');
    expect(source).not.toMatch(/else\s*\{\s*this\.toast\.success/);
  });

  it('does not present failed summary requests as zero and offers refresh feedback', () => {
    expect(source).toContain('readonly summaryError = signal(false)');
    expect(source).toContain('this.summaryError.set(false)');
    expect(source).toContain('this.summaryError.set(true)');
    expect(source.match(/\[value\]="summaryError\(\) \? '—' : summary\(\)\./g)).toHaveLength(4);
    expect(source).toContain('role="status"');
    expect(source).toContain('Actualizar en el menú de opciones para reintentar');
  });

  it('distinguishes load errors from empty results and handles stale searches/pages', () => {
    expect(source).toContain("if (this.error()) return 'No se pudo cargar el listado'");
    expect(source).toContain('No se pudo comprobar si hay registros.');
    expect(source).toContain('[showEmptyClearFilters]="!error() && hasActiveFilters()"');
    expect(source).toContain('[showEmptyRefresh]="!!error() || !hasActiveFilters()"');
    expect(source).toContain('if (term !== this.searchValue()) return;');
    expect(source).toContain("key: 'created_at'");
    expect(source).toContain("label: 'Solicitada'");
    expect(source).toContain('if (this.filters().page > this.totalPages())');
  });

  it('keeps accessible error feedback and race-safe list/summary requests', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('[emptyTitle]="emptyTitle()"');
    expect(source).toContain('[emptyDescription]="emptyDescription()"');
    expect(source).toContain('this.listSubscription?.unsubscribe()');
    expect(source).toContain('this.summarySubscription?.unsubscribe()');
    expect(source).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(source).toContain('rowLabelKey="order_id"');
    expect(source).toContain('[sortable]="false"');
    expect(source).toContain(
      'if (!Number.isInteger(page) || page < 1 || page > this.totalPages()) return;',
    );
  });
});
