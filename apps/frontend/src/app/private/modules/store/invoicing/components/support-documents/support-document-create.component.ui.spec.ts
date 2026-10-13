import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(__dirname, 'support-document-create.component.ts'), 'utf8');

describe('support document create modal UI source guards (static, not E2E)', () => {
  it('uses the shared accessible modal contract and blocks closure during submission', () => {
    expect(component).toContain('[(isOpen)]="isOpenModel"');
    expect(component).toContain('[dialog]="true"');
    expect(component).toContain('[canClose]="canCloseModal"');
    expect(component).toContain('readonly canCloseModal = (): boolean => !this.submitting()');
    expect(component).toContain('onClose(): void {\n    if (this.submitting()) return;');
    expect(component).not.toContain('isOpenChange =');
  });

  it('guards submit and item mutations while disabling their controls during submission', () => {
    expect(component).toContain('onSubmit(): void {\n    if (this.submitting()) return;');
    expect(component).toContain('addItem(): void {\n    if (this.submitting()) return;');
    expect(component).toContain('removeItem(index: number): void {\n    if (this.submitting()) return;');
    expect(component).toContain('(clicked)="addItem()"');
    expect(component).toContain('[disabled]="submitting()"');
    expect(component).toContain('(click)="removeItem(i)"');
    expect(component).toContain('aria-label="Eliminar ítem"');
  });

  it('keeps item removal separate from the form field to avoid overlap', () => {
    expect(component).toContain('<div class="flex items-start gap-2">');
    expect(component).toContain('<div class="min-w-0 flex-1">');
    expect(component).not.toContain('absolute top-2 right-2');
  });

  it('uses large controls for input/select fields and does not duplicate modal footer chrome', () => {
    const fields = component.match(/<(?:app-input|app-selector)\b[^>]*>/g) ?? [];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field).toContain('size="lg"');

    const footerStart = component.indexOf('<div slot="footer">');
    const footerEnd = component.indexOf('</app-modal>', footerStart);
    const footer = component.slice(footerStart, footerEnd);
    expect(footer).toContain('flex flex-col-reverse gap-2 sm:flex-row');
    expect(footer).not.toMatch(/\bbg-[^\s"]+|\bborder-t\b|\brounded-b-\S+|\bp-3\b/);
  });

  it('uses one responsive footer slot and explicit alert text', () => {
    expect((component.match(/slot="footer"/g) ?? [])?.length).toBe(1);
    expect(component).toContain('flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end');
    expect(component).toContain('role="alert"');
    expect(component).toContain('{{ errorMsg }}');
  });

  it('distinguishes supplier loading, retryable errors, and an empty list', () => {
    expect(component).toContain('readonly suppliersLoading = signal(false)');
    expect(component).toContain('readonly suppliersError = signal<string | null>(null)');
    expect(component).toContain('Consultando proveedores…');
    expect(component).toContain('No se pudieron consultar los proveedores.');
    expect(component).toContain('No hay proveedores disponibles.');
    expect(component).toContain('(clicked)="retrySuppliers()">Reintentar');
    expect(component).toContain('this.suppliersLoading.set(false)');
    expect(component).toContain('this.suppliersError.set(');
  });

  it('cancels stale supplier requests on close and resets form state only at open transitions', () => {
    expect(component).toContain('let wasOpen = false;');
    expect(component).toContain('if (open === wasOpen) return;');
    expect(component).toContain('if (open) {\n          this.reset();\n          this.loadSuppliers();\n        } else {\n          this.cancelSupplierLoad();\n          this.reset();');
    expect(component).toContain('private cancelSupplierLoad(): void');
    expect(component).toContain('this.supplierRequest?.unsubscribe()');
    expect(component).toContain('generation !== this.supplierRequestGeneration || !this.isOpen()');
    expect(component).toContain('this.supplierTouchedByUser.set(false)');
    expect(component).toContain('this.submitError.set(null)');
  });
});
