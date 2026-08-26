import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  FormatoSectionPaths,
  InvoiceSectionFormatoComponent,
} from './invoice-section-formato.component';

/**
 * B.7 — la sección compartida «Formato de impresión» probada en el DOM.
 *
 * Lo que se custodia acá es el CONTRATO DEL COMPONENTE con sus dos pantallas:
 * en contexto `profile` resuelve los cuatro controles que el perfil congela; en
 * contexto `invoice` no inventa controles que el DTO de creación no declara, y
 * sí muestra con qué se imprimirá este documento. Corre zoneless (ver
 * `src/test-init.ts`), igual que producción.
 */
describe('InvoiceSectionFormatoComponent', () => {
  let fixture: ComponentFixture<InvoiceSectionFormatoComponent>;
  let component: InvoiceSectionFormatoComponent;
  let form: FormGroup;

  const profilePaths: FormatoSectionPaths = {
    template_id: 'format.template_id',
    template_key: 'format.template_key',
    show_aiu_breakdown: 'format.show_aiu_breakdown',
    display_decimals: 'format.display_decimals',
  };

  /** La factura NO tiene ninguno de los cuatro salvo el selector local de tienda. */
  const invoicePaths: FormatoSectionPaths = {
    template_id: 'template_id',
    template_key: null,
    show_aiu_breakdown: null,
    display_decimals: null,
  };

  const buildProfileForm = (): FormGroup => {
    const fb = TestBed.inject(FormBuilder);
    return fb.group({
      format: fb.group({
        template_id: [''],
        template_key: [''],
        show_aiu_breakdown: [false],
        display_decimals: [1],
      }),
    });
  };

  const buildInvoiceForm = (): FormGroup => {
    const fb = TestBed.inject(FormBuilder);
    return fb.group({ template_id: [''] });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, InvoiceSectionFormatoComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceSectionFormatoComponent);
    component = fixture.componentInstance;
  });

  it('contexto perfil: resuelve los cuatro controles del grupo «format»', () => {
    form = buildProfileForm();
    fixture.componentRef.setInput('context', 'profile');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', profilePaths);

    expect(component.templateIdControl()).toBe(form.get('format.template_id'));
    expect(component.legacyKeyControl()).toBe(form.get('format.template_key'));
    expect(component.aiuBreakdownControl()).toBe(
      form.get('format.show_aiu_breakdown'),
    );
    expect(component.displayDecimalsControl()).toBe(
      form.get('format.display_decimals'),
    );
  });

  it('contexto factura: las rutas ausentes no resuelven controles de perfil', () => {
    form = buildInvoiceForm();
    fixture.componentRef.setInput('context', 'invoice');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', invoicePaths);

    expect(component.templateIdControl()).toBe(form.get('template_id'));
    expect(component.legacyKeyControl()).toBeNull();
    expect(component.aiuBreakdownControl()).toBeNull();
    expect(component.displayDecimalsControl()).toBeNull();
  });

  it('contexto factura: el DOM avisa que la biblioteca es de organización y no ofrece controles de perfil', () => {
    form = buildInvoiceForm();
    fixture.componentRef.setInput('context', 'invoice');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', invoicePaths);
    fixture.componentRef.setInput('effectivePrintLabel', 'Plantilla «Aseo tenue»');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('ORGANIZACIÓN');
    expect(text).toContain('Plantilla «Aseo tenue»');
    expect(text).not.toContain('Mostrar el desglose AIU');
    expect(text).not.toContain('Decimales a mostrar');
  });
});
