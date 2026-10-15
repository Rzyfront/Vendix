import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';

import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';

import {
  PLATFORM_EXTERNAL_EMAIL_VALIDATORS,
  PlatformInvoiceCreateComponent,
  calculateDianDv,
} from './platform-invoice-create.component';
import { platformAcquirerMissing } from '../../utils/platform-invoice-draft-mapping';

/**
 * Humo de compilación: importar la página obliga a Karma a compilarla en AOT
 * con chequeo de plantillas (chip de perfil con su ayuda en popover, resumen
 * lateral pegajoso, resumen del adquiriente, búsqueda por NIT, faltantes para
 * emitir y escáner IA).
 */
describe('PlatformInvoiceCreateComponent', () => {
  it('compila la página', () => {
    expect(PlatformInvoiceCreateComponent).toBeTruthy();
  });

  it('calcula el DV DIAN (módulo 11)', () => {
    expect(calculateDianDv('900123456')).toBe('8');
    expect(calculateDianDv('')).toBe('');
  });

  describe('correo del adquiriente (external_email)', () => {
    const control = (value: string) => new FormControl(value, PLATFORM_EXTERNAL_EMAIL_VALIDATORS);

    it('es obligatorio', () => {
      expect(control('').hasError('required')).toBeTrue();
    });

    it('exige formato', () => {
      expect(control('compras@').hasError('email')).toBeTrue();
      expect(control('compras@andina').hasError('email')).toBeTrue();
      expect(control('compras@andina.co').valid).toBeTrue();
      // El payload viaja recortado: los espacios alrededor no lo invalidan.
      expect(control('  compras@andina.co ').valid).toBeTrue();
    });

    it('no exime al consumidor final: la plataforma siempre factura a un adquiriente identificado', () => {
      // Con el genérico 222222222222 el correo sigue siendo obligatorio.
      expect(control('').invalid).toBeTrue();
      expect(
        platformAcquirerMissing({ external_tax_id: '222222222222', external_email: '' }).some(
          (m) => m.field === 'external_email',
        ),
      ).toBeTrue();
    });

    it('control inválido ⇔ faltante para emitir (Emitir nunca cae en el error genérico)', () => {
      for (const email of ['', 'compras@', 'a@b..co', 'compras@andina', 'compras@andina.co']) {
        const listed = platformAcquirerMissing({ external_email: email }).some(
          (m) => m.field === 'external_email',
        );
        expect(control(email).invalid).withContext(`«${email}»`).toBe(listed);
      }
    });
  });
});

/**
 * Render real de la página (dependencias de red con HttpTestingController sin
 * responder): sección de acciones sólida con sus variantes y la entrada de
 * FacturIA sin «borrador».
 */
describe('PlatformInvoiceCreateComponent · resumen y FacturIA (render)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformInvoiceCreateComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMockStore({}),
        PlatformInvoicingStore,
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            format: (value: number) => `$${value}`,
          },
        },
      ],
    }).compileComponents();
  });

  const render = () => {
    const fixture = TestBed.createComponent(PlatformInvoiceCreateComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('las acciones viven en una sección sólida con outline / outline-danger', () => {
    const fixture = render();
    const section = (fixture.nativeElement as HTMLElement).querySelector(
      'section[data-testid="platform-invoice-actions"]',
    );
    expect(section).not.toBeNull();
    expect(section!.className).toContain('rounded-2xl');
    expect(section!.className).toContain('bg-surface');

    const variantOf = (label: string) =>
      fixture.debugElement
        .queryAll(By.directive(ButtonComponent))
        .filter((de) => section!.contains(de.nativeElement))
        .find((de) => ((de.nativeElement as HTMLElement).textContent ?? '').includes(label))
        ?.componentInstance.variant();
    expect(variantOf('Emitir Factura Electrónica')).toBe('primary');
    expect(variantOf('Previsualizar totales')).toBe('outline');
    expect(variantOf('Cancelar')).toBe('outline-danger');
  });

  it('la entrada de FacturIA dice «FacturIA», resalta «IA» y no menciona «borrador»', () => {
    const fixture = render();
    const entry = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="facturia-entry"]',
    );
    expect(entry).not.toBeNull();
    const text = (entry!.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('FacturIA');
    expect(text).toContain('Autocompleta la factura desde tus documentos');
    expect(entry!.querySelector('.vx-ai-text')?.textContent?.trim()).toBe('IA');
    expect(entry!.getAttribute('title')).toBe('Autocompleta la factura desde tus documentos');
    expect(text.toLowerCase()).not.toContain('borrador');
    expect(text).not.toContain('Cargar documentos');
  });

  it('la página no pinta «borrador» ni «Emitir directamente» (plataforma crea y emite siempre)', () => {
    const fixture = render();
    const text = ((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase();
    expect(text).not.toContain('borrador');
    expect(text).not.toContain('emitir directamente');
  });

  it('el aviso de FacturIA usa el conteo de campos completados', () => {
    const fixture = render();
    const page = fixture.componentInstance;
    page.draftNotice.set({
      documents: 2,
      pending: [],
      noteApplied: null,
      extractionNotes: null,
      unresolved: [],
      totalsInconsistent: false,
      documentTotal: null,
      acquirer: null,
      filled: 7,
    });
    fixture.detectChanges();
    const headline = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="facturia-notice-headline"]',
    );
    expect(headline?.textContent?.trim()).toBe('FacturIA completó 7 campos · revisa los marcados');
    expect(
      ((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase(),
    ).not.toContain('borrador');
  });
});
