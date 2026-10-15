import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import {
  InvoiceSummaryAsideComponent,
  type InvoiceSummaryTotals,
} from './invoice-summary-aside.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import type { SaveRequirement } from '../../../../../../shared/components/save-requirements-modal/save-requirements.interface';

/**
 * Humo del resumen lateral de «Nueva factura»: pinta cifras, el estado
 * («Para emitir falta» / «Lista para emitir» / «Revisando…») y las acciones,
 * y sus salidas siguen siendo las mismas que escucha la página.
 *
 * `CurrencyFormatService` se dobla con los dos miembros que usa el pipe: el
 * real arrastra `HttpClient` y `TenantFacade` (NgRx), dependencias que este
 * componente no tiene.
 */
describe('InvoiceSummaryAsideComponent · humo de render', () => {
  let fixture: ComponentFixture<InvoiceSummaryAsideComponent>;
  let component: InvoiceSummaryAsideComponent;

  const totals: InvoiceSummaryTotals = {
    subtotal: 100000,
    discount: 0,
    taxable_base: 100000,
    taxes: [{ label: 'IVA 19 %', amount: 19000 }],
    withholdings: [{ label: 'Retefuente 2,5 %', amount: 2500 }],
    total: 119000,
    net_receivable: 116500,
    amount_in_words: 'Ciento diecinueve mil pesos',
  };

  const requirement: SaveRequirement = {
    id: 'local:customer_email',
    label: 'Correo del adquiriente',
    reason: 'Requerido para emitir.',
    severity: 'blocker',
    action: { label: 'Ir al campo', kind: 'focus', target: 'customer_email' },
  };

  const text = (): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  const buttonByText = (label: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => (button.textContent ?? '').includes(label));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceSummaryAsideComponent],
      providers: [
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            format: (value: number) => `$${value}`,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvoiceSummaryAsideComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('totals', totals);
    fixture.detectChanges();
  });

  it('pinta el resumen con total, neto y «Son:»', () => {
    expect(text()).toContain('Resumen de la factura');
    expect(text()).toContain('Total');
    expect(text()).toContain('$119000');
    expect(text()).toContain('Neto a recibir');
    expect(text()).toContain('$116500');
    expect(text()).toContain('Son: Ciento diecinueve mil pesos');
  });

  it('sin requisitos ni revisión en curso dice «Lista para emitir»', () => {
    expect(text()).toContain('Lista para emitir');
    expect(text()).not.toContain('Para emitir falta');
  });

  it('con requisitos lista «Para emitir falta» y emite la acción al pulsar', () => {
    const actions: unknown[] = [];
    component.requirementAction.subscribe((action) => actions.push(action));
    fixture.componentRef.setInput('requirements', [requirement]);
    fixture.detectChanges();

    expect(text()).toContain('Para emitir falta');
    expect(text()).toContain('Correo del adquiriente');
    expect(text()).not.toContain('Lista para emitir');

    buttonByText('Correo del adquiriente')!.click();
    expect(actions).toEqual([requirement.action]);
  });

  it('revisando: muestra el indicador y no afirma que está lista', () => {
    fixture.componentRef.setInput('checking', true);
    fixture.detectChanges();
    expect(text()).toContain('Revisando…');
    expect(text()).not.toContain('Lista para emitir');
  });

  it('showTotals=false oculta el resumen de cifras', () => {
    fixture.componentRef.setInput('showTotals', false);
    fixture.detectChanges();
    expect(text()).not.toContain('Resumen de la factura');
  });

  it('las acciones conservan sus salidas', () => {
    const fired: string[] = [];
    component.submit.subscribe(() => fired.push('submit'));
    component.validate.subscribe(() => fired.push('validate'));
    component.preview.subscribe(() => fired.push('preview'));
    component.cancel.subscribe(() => fired.push('cancel'));

    buttonByText('Crear factura')!.click();
    buttonByText('Validar')!.click();
    buttonByText('Vista previa')!.click();
    buttonByText('Cancelar')!.click();

    expect(fired).toEqual(['submit', 'validate', 'preview', 'cancel']);
  });

  it('canSubmit=false deshabilita la acción primaria', () => {
    fixture.componentRef.setInput('canSubmit', false);
    fixture.detectChanges();
    expect(buttonByText('Crear factura')!.disabled).toBeTrue();
  });

  const buttonVariant = (label: string): string | undefined =>
    fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .find((de) => ((de.nativeElement as HTMLElement).textContent ?? '').includes(label))
      ?.componentInstance.variant();

  const toggleButton = (): HTMLButtonElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="emit-immediately-toggle"] button',
    );

  it('las acciones viven en su propia sección sólida', () => {
    const section = (fixture.nativeElement as HTMLElement).querySelector(
      'section[data-testid="invoice-summary-actions"]',
    );
    expect(section).not.toBeNull();
    expect(section!.className).toContain('rounded-2xl');
    expect(section!.className).toContain('border-border');
    expect(section!.className).toContain('bg-surface');
    expect(section!.textContent).toContain('Crear factura');
    expect(section!.textContent).toContain('Validar');
    expect(section!.textContent).toContain('Vista previa');
    expect(section!.textContent).toContain('Cancelar');
  });

  it('variantes: primaria, Validar/Vista previa outline y Cancelar outline-danger', () => {
    expect(buttonVariant('Crear factura')).toBe('primary');
    expect(buttonVariant('Validar')).toBe('outline');
    expect(buttonVariant('Vista previa')).toBe('outline');
    expect(buttonVariant('Cancelar')).toBe('outline-danger');
  });

  describe('«Emitir directamente»', () => {
    it('sin showEmitToggle no se pinta', () => {
      expect(text()).not.toContain('Emitir directamente');
      expect(toggleButton()).toBeNull();
    });

    it('con showEmitToggle arranca APAGADO y el botón dice «Crear factura»', () => {
      fixture.componentRef.setInput('showEmitToggle', true);
      fixture.detectChanges();
      expect(text()).toContain('Emitir directamente');
      expect(text()).toContain('se envía a la DIAN de inmediato');
      expect(component.emitImmediately()).toBeFalse();
      expect(toggleButton()!.getAttribute('aria-pressed')).toBe('false');
      expect(buttonByText('Crear factura')).toBeDefined();
      expect(text()).not.toContain('Crear y emitir');
    });

    it('al encenderlo emite el cambio y el botón dice «Crear y emitir»', () => {
      fixture.componentRef.setInput('showEmitToggle', true);
      fixture.detectChanges();
      const changes: boolean[] = [];
      component.emitImmediately.subscribe((value) => changes.push(value));

      toggleButton()!.click();
      fixture.detectChanges();

      expect(changes).toEqual([true]);
      expect(component.emitImmediately()).toBeTrue();
      expect(buttonByText('Crear y emitir')).toBeDefined();
      expect(text()).not.toContain('Crear factura');
    });

    it('la página lo reinicia: emitImmediately=false vuelve a apagarlo', () => {
      fixture.componentRef.setInput('showEmitToggle', true);
      fixture.componentRef.setInput('emitImmediately', true);
      fixture.detectChanges();
      expect(buttonByText('Crear y emitir')).toBeDefined();

      fixture.componentRef.setInput('emitImmediately', false);
      fixture.detectChanges();
      expect(toggleButton()!.getAttribute('aria-pressed')).toBe('false');
      expect(buttonByText('Crear factura')).toBeDefined();
    });

    it('respeta submitLabel apagado y emitSubmitLabel encendido', () => {
      fixture.componentRef.setInput('showEmitToggle', true);
      fixture.componentRef.setInput('submitLabel', 'Generar');
      fixture.detectChanges();
      expect(buttonByText('Generar')).toBeDefined();
      fixture.componentRef.setInput('emitImmediately', true);
      fixture.detectChanges();
      expect(buttonByText('Crear y emitir')).toBeDefined();
    });

    it('sin showEmitToggle, aunque llegue encendido, el botón no promete emitir', () => {
      fixture.componentRef.setInput('emitImmediately', true);
      fixture.detectChanges();
      expect(buttonByText('Crear factura')).toBeDefined();
      expect(fixture.debugElement.query(By.directive(ToggleComponent))).toBeNull();
    });
  });
});
