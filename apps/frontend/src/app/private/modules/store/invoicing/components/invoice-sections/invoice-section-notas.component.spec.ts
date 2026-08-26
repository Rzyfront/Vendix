import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  InvoiceSectionNotasComponent,
  NotasSectionPaths,
} from './invoice-section-notas.component';

/**
 * B.7 — la sección compartida «Notas internas» probada en el DOM.
 *
 * La propiedad que esta sección existe para no romper: `internal_note` y
 * `notes` NO se cruzan nunca. En contexto factura el componente no inventa un
 * control que `CreateInvoiceDto` no declara.
 */
describe('InvoiceSectionNotasComponent', () => {
  let fixture: ComponentFixture<InvoiceSectionNotasComponent>;
  let component: InvoiceSectionNotasComponent;
  let form: FormGroup;

  const profilePaths: NotasSectionPaths = {
    description: 'general.description',
    internal_note: 'general.internal_note',
  };

  /** La factura no declara ninguno de los dos: rutas nulas a propósito. */
  const invoicePaths: NotasSectionPaths = {
    description: null,
    internal_note: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, InvoiceSectionNotasComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceSectionNotasComponent);
    component = fixture.componentInstance;
  });

  it('contexto perfil: resuelve los dos controles del grupo «general»', () => {
    const fb = TestBed.inject(FormBuilder);
    form = fb.group({
      general: fb.group({ description: [''], internal_note: [''] }),
    });
    fixture.componentRef.setInput('context', 'profile');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', profilePaths);

    expect(component.descriptionControl()).toBe(form.get('general.description'));
    expect(component.internalNoteControl()).toBe(
      form.get('general.internal_note'),
    );
  });

  it('contexto factura: sin rutas no hay controles y el DOM explica dónde van las notas que viajan', () => {
    const fb = TestBed.inject(FormBuilder);
    form = fb.group({});
    fixture.componentRef.setInput('context', 'invoice');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', invoicePaths);
    fixture.detectChanges();

    expect(component.descriptionControl()).toBeNull();
    expect(component.internalNoteControl()).toBeNull();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Documento');
    expect(text).toContain('cbc:Note');
  });
});
