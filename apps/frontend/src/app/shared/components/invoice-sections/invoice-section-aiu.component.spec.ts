import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../environments/environment';

import {
  AiuSectionPaths,
  InvoiceSectionAiuComponent,
} from './invoice-section-aiu.component';

/**
 * LA SUGERENCIA DE TRIBUTOS, PROBADA EN EL DOM.
 *
 * Las pruebas puras de `invoice-section-aiu.logic.spec.ts` custodian las reglas;
 * estas custodian lo que la persona ve y toca, que es donde viven las cinco
 * propiedades de C.4. La diferencia importa: una función pura que devuelve la
 * sugerencia correcta no prueba que el botón «Aplicar» exista, ni que la matriz
 * siga intacta hasta pulsarlo, ni que el bote de basura de la fila recuerde el
 * descarte. Todo eso es plantilla y estado del componente.
 *
 * Corre ZONELESS —el arnés provee `provideZonelessChangeDetection()` en la raíz
 * del TestBed, ver `src/test-init.ts`—, así que un `computed` mal escrito sobre
 * el valor de un `FormControl` no se refresca acá tampoco. Es a propósito: es el
 * motor de detección de cambios de producción.
 *
 * Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-tax-typing`.
 */
describe('InvoiceSectionAiuComponent · sugerencia de tributos (DOM)', () => {
  let fixture: ComponentFixture<InvoiceSectionAiuComponent>;
  let component: InvoiceSectionAiuComponent;
  let form: FormGroup;
  let taxRules: FormArray;

  /** Las rutas de la FACTURA, copiadas de `aiuSectionPaths` de esa página. */
  const paths: AiuSectionPaths = {
    taxable_basis: 'aiu.taxable_basis',
    contract_object: 'aiu_contract_object',
    enforce_minimum_base: 'aiu.enforce_minimum_base',
    minimum_base_percent: 'aiu.minimum_base_percent',
    components_basis: 'aiu.components_basis',
    components: {
      administracion: 'aiu.administracion',
      imprevistos: 'aiu.imprevistos',
      utilidad: 'aiu.utilidad',
    },
    revenue_account: {
      administracion: 'aiu.revenue_administracion',
      imprevistos: 'aiu.revenue_imprevistos',
      utilidad: 'aiu.revenue_utilidad',
      costo: 'default_account_code',
    },
    vat_payable_account: 'aiu.vat_payable_account',
    accounting_model: 'aiu.accounting_model',
  };

  function buildForm(fb: FormBuilder): FormGroup {
    return fb.group({
      aiu_contract_object: [''],
      default_account_code: [''],
      aiu: fb.group({
        taxable_basis: ['aiu'],
        enforce_minimum_base: [true],
        minimum_base_percent: ['10.00'],
        components_basis: ['contract'],
        administracion: ['5.00'],
        imprevistos: ['2.00'],
        utilidad: ['3.00'],
        revenue_administracion: [''],
        revenue_imprevistos: [''],
        revenue_utilidad: [''],
        vat_payable_account: [''],
        accounting_model: ['sumada'],
      }),
      aiu_taxes: fb.array([] as FormGroup[]),
    });
  }

  /** Texto visible de la sección, normalizado a un espacio entre palabras. */
  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent!
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
  }

  function buttonWithText(label: string): HTMLButtonElement | undefined {
    return buttons().find((button) =>
      (button.textContent ?? '').replace(/\s+/g, ' ').trim().includes(label),
    );
  }

  function buttonWithLabel(aria: string): HTMLButtonElement | undefined {
    return buttons().find(
      (button) => button.getAttribute('aria-label') === aria,
    );
  }

  /** La matriz, leída del MODELO: es lo que se emitiría. */
  function matrix(): Array<{
    bucket: string;
    taxable: boolean;
    tax_code: string;
    rate: string;
  }> {
    return taxRules.controls.map((control) => ({
      bucket: String(control.get('bucket')?.value ?? ''),
      taxable: Boolean(control.get('taxable')?.value),
      tax_code: String(control.get('tax_code')?.value ?? ''),
      rate: String(control.get('rate')?.value ?? ''),
    }));
  }

  function mount(
    context: 'invoice' | 'profile',
    responsibilities: readonly string[],
  ): void {
    fixture = TestBed.createComponent(InvoiceSectionAiuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('paths', paths);
    fixture.componentRef.setInput('taxRules', taxRules);
    fixture.componentRef.setInput(
      'customerFiscalResponsibilities',
      responsibilities,
    );
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InvoiceSectionAiuComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Sin este doble el spec no arranca: la sección pinta `<app-input>`,
        // que inyecta `CurrencyFormatService`, que inyecta `TenantFacade`, que
        // inyecta el `Store` de NgRx — y `TestBed.createComponent` muere con
        // `NG0201: No provider found for _Store` ANTES de correr cualquier
        // expectativa. Se doblan sus dos únicos miembros usados, igual que en
        // `currency.pipe.spec.ts`, y no el `Store` entero: doblar NgRx
        // declararía sobre este spec una dependencia que no tiene.
        {
          provide: TenantFacade,
          useValue: {
            getCurrentDomainConfig: () => null,
            getCurrentStoreId: () => null,
          },
        },
      ],
    });
    const fb = TestBed.inject(FormBuilder);
    form = buildForm(fb);
    taxRules = form.get('aiu_taxes') as FormArray;
  });

  describe('contexto «invoice» con «Responsable de IVA» (O-48)', () => {
    beforeEach(() => {
      mount('invoice', ['O-48']);
    });

    it('la pinta como SUGERENCIA, con la procedencia y sin aplicarla', () => {
      // Se dice que es sugerencia y de dónde sale.
      expect(text()).toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
      expect(text()).toContain('Nada de esto está aplicado');
      expect(text()).toContain(
        'Sugerido por «Responsable de IVA» (O-48) en las responsabilidades fiscales del cliente.',
      );
      expect(text()).toContain('IVA (01)');
      expect(text()).toContain('19.00 %');
      // Y NO está aplicada: la matriz sigue vacía y el formulario intacto.
      expect(matrix()).toEqual([]);
      expect(taxRules.dirty).toBe(false);
      expect(form.dirty).toBe(false);
    });

    it('dice qué escribiría antes de escribirlo', () => {
      expect(text()).toContain(
        'Al aplicar se escribe en: Administración, Imprevistos y Utilidad',
      );
    });

    it('aplicar es un acto explícito: sólo el botón escribe la matriz', () => {
      const apply = buttonWithText('Aplicar');
      expect(apply).toBeDefined();

      apply!.click();
      fixture.detectChanges();

      expect(matrix()).toEqual([
        {
          bucket: 'administracion',
          taxable: true,
          tax_code: '01',
          rate: '19.00',
        },
        { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
        // La fila DERIVADA del costo reembolsable: bajo la base «aiu» queda
        // exenta, y su ausencia sería un 422 bajo «subtotal».
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ]);
      // Aplicada, deja de sugerirse.
      expect(text()).not.toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
      // Y la matriz queda `dirty`, que es lo que hace que un cambio de perfil
      // posterior avise de que la reemplazaría.
      expect(taxRules.dirty).toBe(true);
    });

    it('QUITAR la fila aplicada no vuelve a proponer el tributo', () => {
      buttonWithText('Aplicar')!.click();
      fixture.detectChanges();

      // Se quitan las tres filas gravables por el bote de basura de cada una.
      // Sólo se pintan tres: la del costo existe y no se pinta.
      for (let i = 0; i < 3; i++) {
        const trash = buttonWithLabel('Quitar esta regla de impuesto');
        expect(trash).toBeDefined();
        trash!.click();
        fixture.detectChanges();
      }

      expect(
        matrix().filter((row) => row.bucket !== 'costo' && row.taxable),
      ).toEqual([]);
      // La matriz ya no declara IVA, así que la regla desnuda lo volvería a
      // sugerir. La memoria del descarte es lo que lo impide.
      expect(text()).not.toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
      expect(text()).not.toContain('Sugerido por «Responsable de IVA»');
    });

    it('descartar sin aplicar tampoco lo repone', () => {
      const dismiss = buttonWithLabel('Descartar este tributo sugerido');
      expect(dismiss).toBeDefined();

      dismiss!.click();
      fixture.detectChanges();

      expect(matrix()).toEqual([]);
      expect(text()).not.toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
    });

    it('cambiar de adquiriente borra los descartes del anterior', () => {
      buttonWithLabel('Descartar este tributo sugerido')!.click();
      fixture.detectChanges();
      expect(text()).not.toContain('Sugerido por «Responsable de IVA»');

      // Otro cliente, también responsable de IVA: la decisión del anterior no
      // puede esconderle la sugerencia.
      fixture.componentRef.setInput('customerFiscalResponsibilities', [
        'O-48',
        'O-13',
      ]);
      fixture.detectChanges();

      expect(text()).toContain('Sugerido por «Responsable de IVA» (O-48)');
    });
  });

  describe('sugerencia SIN tarifa que la ley fije', () => {
    beforeEach(() => {
      mount('invoice', ['O-13']);
    });

    it('se propone, se explica y NO trae botón de aplicar', () => {
      expect(text()).toContain('ReteFuente (06)');
      expect(text()).toContain(
        'Sugerido por «Gran contribuyente» (O-13) en las responsabilidades fiscales del cliente.',
      );
      expect(text()).toContain('Sin tarifa sugerida');
      expect(buttonWithText('Aplicar')).toBeUndefined();
      // El botón de descartar sí está: es una decisión que se puede tomar.
      expect(buttonWithLabel('Descartar este tributo sugerido')).toBeDefined();
      expect(matrix()).toEqual([]);
    });
  });

  describe('lo que la matriz ya declara', () => {
    it('no se sugiere de nuevo', () => {
      const fb = TestBed.inject(FormBuilder);
      taxRules.push(
        fb.group({
          bucket: ['administracion'],
          taxable: [true],
          tax_code: ['01'],
          rate: ['19.00'],
        }),
      );
      mount('invoice', ['O-48']);

      expect(text()).not.toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
    });

    it('una fila con el código pero NO gravable no cuenta como declarada', () => {
      const fb = TestBed.inject(FormBuilder);
      taxRules.push(
        fb.group({
          bucket: ['administracion'],
          taxable: [false],
          tax_code: ['01'],
          rate: ['0.00'],
        }),
      );
      mount('invoice', ['O-48']);

      expect(text()).toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
    });
  });

  describe('contexto «profile»', () => {
    beforeEach(() => {
      // Se le pasan responsabilidades A PROPÓSITO: la compuerta tiene que ser
      // el contexto y no la ausencia del dato. Un editor de perfiles que algún
      // día recibiera este `input` por error seguiría sin sugerir nada.
      mount('profile', ['O-48', 'O-13']);
    });

    it('no sugiere nada y explica por qué', () => {
      expect(text()).not.toContain(
        'Sugeridos por las responsabilidades fiscales del cliente',
      );
      expect(text()).toContain('Acá no hay adquiriente');
      expect(text()).toContain(
        'La sugerencia por responsabilidades fiscales del cliente sólo existe al emitir.',
      );
      expect(matrix()).toEqual([]);
    });

    it('ni siquiera por la vía imperativa: no hay nada que aplicar', () => {
      component.applyTaxSuggestion('01');
      fixture.detectChanges();

      expect(matrix()).toEqual([]);
    });
  });

  describe('ningún control de la sección nace `dirty`', () => {
    it('recién montada, los ocho controles precargables siguen `pristine`', () => {
      mount('invoice', ['O-48']);

      // Son las ocho rutas que `PROFILE_PREFILL_LABELS` añadió en C.5. Si
      // alguna naciera `dirty`, `seedAiuFromProfile` dejaría de precargarla
      // para siempre y en silencio.
      const prefillable = [
        'aiu.components_basis',
        'aiu.administracion',
        'aiu.imprevistos',
        'aiu.utilidad',
        'aiu.revenue_administracion',
        'aiu.revenue_imprevistos',
        'aiu.revenue_utilidad',
        'aiu.vat_payable_account',
      ];
      for (const path of prefillable) {
        expect(form.get(path)!.dirty)
          .withContext(path + ' nace dirty')
          .toBe(false);
      }
      expect(form.dirty).toBe(false);
    });
  });

  describe('precarga híbrida de cuentas (C.9)', () => {
    let httpMock: HttpTestingController;

    /** Las cinco rutas de cuenta de la FACTURA (la del costo es la raíz). */
    const accountPaths = [
      'aiu.revenue_administracion',
      'aiu.revenue_imprevistos',
      'aiu.revenue_utilidad',
      'default_account_code',
      'aiu.vat_payable_account',
    ];

    const mappingsUrl = `${environment.apiUrl}/store/accounting/account-mappings`;

    /**
     * Los chips «heredado» EXACTOS: un `<span>` cuyo único texto es la palabra.
     *
     * No puede ser un `toContain('heredado')` sobre `text()`: la ayuda del
     * bloque de cuentas cita la palabra («Lo marcado «heredado» es lo que
     * aplica hoy…») en cada render, así que una aserción de presencia sería
     * trivialmente cierta y una de ausencia falsamente negativa.
     */
    function inheritedChips(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('span'),
      ).filter((el) => (el.textContent ?? '').trim() === 'heredado');
    }

    function flushMappings(rows: unknown[]): void {
      const req = httpMock.expectOne(mappingsUrl);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: rows });
    }

    beforeEach(() => {
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpMock.verify();
    });

    it('pinta el heredado y la precarga NUNCA escribe un control', () => {
      mount('profile', []);
      flushMappings([
        {
          mapping_key: 'invoice.validated.revenue',
          account_code: '413510',
          description: 'Ingresos por Actividad Financiera',
          source: 'default',
        },
        {
          mapping_key: 'invoice.validated.iva_payable',
          account_code: '240802',
          description: 'IVA Generado por Ventas',
          source: 'default',
        },
      ]);
      fixture.detectChanges();

      // El valor efectivo se MUESTRA con su marca en los CINCO selectores: la
      // clave de ingreso cubre los cuatro buckets y la de IVA el quinto.
      expect(inheritedChips().length).withContext('5 chips heredados').toBe(5);
      expect(text()).toContain('413510');
      expect(text()).toContain('240802');

      // Y no se ESCRIBIÓ nada: valores vacíos y pristine. Es lo que hace que
      // `buildConfig` → `nullIfEmpty` produzca el MISMO config.accounting de
      // siempre al guardar sin tocar — null preservado byte a byte.
      for (const path of accountPaths) {
        const control = form.get(path)!;
        expect(control.value).withContext(path + ' fue escrito').toBeFalsy();
        expect(control.dirty).withContext(path + ' nació dirty').toBe(false);
      }
      expect(form.dirty).toBe(false);
    });

    it('un bucket sin clave en el mapeo queda honestamente vacío', () => {
      mount('profile', []);
      flushMappings([
        {
          mapping_key: 'payment.received.cash',
          account_code: '1105',
          description: 'Caja',
          source: 'default',
        },
      ]);
      fixture.detectChanges();

      // Sin clave para el ingreso ni para el IVA ⇒ placeholder de toda la
      // vida, sin «heredado» inventado.
      expect(text()).toContain('Mapeo contable de la tienda');
      expect(inheritedChips().length)
        .withContext('chips heredados inventados')
        .toBe(0);
      for (const path of accountPaths) {
        expect(form.get(path)!.value).toBeFalsy();
      }
    });

    it('el override es del usuario y «volver al valor del sistema» restaura el heredado', () => {
      mount('profile', []);
      flushMappings([
        {
          mapping_key: 'invoice.validated.revenue',
          account_code: '413510',
          description: 'Ingresos por Actividad Financiera',
          source: 'default',
        },
      ]);
      fixture.detectChanges();

      // La clave de ingreso cubre los CUATRO buckets (no hay clave de IVA).
      expect(inheritedChips().length).withContext('4 chips iniciales').toBe(4);

      // OVERRIDE: el usuario elige otra cuenta. Se simula por el control, que
      // es exactamente lo que dispara la elección real del selector.
      form.get('aiu.revenue_administracion')!.setValue('413595');
      const lookup = httpMock.expectOne(
        (req) =>
          req.url.includes('/chart-of-accounts') &&
          req.params.get('search') === '413595',
      );
      lookup.flush({
        data: [{ id: 7, code: '413595', name: 'Comercio al por mayor', accepts_entries: true }],
      });
      fixture.detectChanges();
      // Sólo el bucket editado deja de ser «heredado»; los otros tres siguen
      // mostrando el suyo — el override es de ESE bucket, no de la sección.
      expect(inheritedChips().length)
        .withContext('chips tras el override')
        .toBe(3);
      expect(text()).toContain('413595');

      // VOLVER AL SISTEMA: el control vuelve a null — el bucket deja de viajar
      // como override y el guardado vuelve a omitirlo.
      const restore = buttonWithLabel('Volver al valor del sistema');
      expect(restore).toBeDefined();
      restore!.click();
      fixture.detectChanges();

      expect(form.get('aiu.revenue_administracion')!.value).toBeNull();
      expect(inheritedChips().length)
        .withContext('chips tras volver al sistema')
        .toBe(4);
      expect(text()).toContain('413510');
    });
  });
});
