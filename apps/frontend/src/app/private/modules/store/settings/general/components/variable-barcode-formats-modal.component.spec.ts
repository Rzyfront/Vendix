import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { VariableBarcodeFormatsModalComponent } from './variable-barcode-formats-modal.component';
import { PosProductService } from '../../../pos/services/pos-product.service';
import { VariableBarcodeFormat } from '../../../../../../core/models/store-settings.interface';
import { createFormatFromPreset } from '../../../../../../shared/utils/variable-barcode.util';

/**
 * Lógica del modal de formatos de etiqueta (sin pintar la plantilla): copia al
 * abrir, posiciones en base 1 → base 0, bloqueo del guardado y limpieza.
 */
describe('VariableBarcodeFormatsModalComponent', () => {
  let saved: VariableBarcodeFormat[][];

  function open(formats: VariableBarcodeFormat[]): VariableBarcodeFormatsModalComponent {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PosProductService,
          useValue: { lookupWeightProductByScaleCode: () => of({ status: 'not_found' }) },
        },
      ],
    });
    const c = TestBed.runInInjectionContext(() => new VariableBarcodeFormatsModalComponent());
    // `formats` es un input de señal: fuera de una plantilla se sustituye por
    // una señal antes de que corra el efecto de apertura, que lo lee al correr.
    Object.assign(c, { formats: signal(formats) });
    saved = [];
    c.save.subscribe((list) => saved.push(list));
    c.isOpen.set(true);
    TestBed.tick();
    return c;
  }

  function rongta7(changes: Partial<VariableBarcodeFormat> = {}): VariableBarcodeFormat {
    return { ...createFormatFromPreset('rongta_07'), ...changes };
  }

  it('al abrir trabaja sobre una copia de los formatos guardados', () => {
    const original = rongta7({ id: 'a', max_weight_kg: 15 });
    const c = open([original]);

    expect(c.draft().length).toBe(1);
    expect(c.draft()[0]).not.toBe(original);
    expect(c.draft()[0]).toEqual(original);
    expect(c.prefixText()['a']).toBe('21');
    expect(c.maxWeightText()['a']).toBe('15');

    c.setPrefixes('a', '21, 22');
    c.patch('a', { name: 'Otro nombre' });
    expect(original.prefixes).toEqual(['21']);
    expect(original.name).toBe('Rongta tipo 7 (DD IIIII WW.WWW C)');
  });

  it('setLayout convierte las posiciones de base 1 a base 0 y deja los largos igual', () => {
    const c = open([rongta7({ id: 'a' })]);

    c.setLayout('a', 'product_code_start', 4);
    c.setLayout('a', 'value_start', 9);
    c.setLayout('a', 'product_code_length', 4);

    const f = c.draft()[0];
    expect(f.product_code_start).toBe(3);
    expect(f.value_start).toBe(8);
    expect(f.product_code_length).toBe(4);
    expect(f.preset).toBe('custom');
  });

  it('onSave con nombre vacío guarda el nombre genérico y cierra', () => {
    const c = open([rongta7({ id: 'a' })]);
    c.patch('a', { name: '   ' });

    c.onSave();

    expect(saved.length).toBe(1);
    expect(saved[0][0].name).toBe('Formato de balanza');
    expect(saved[0][0].prefixes).toEqual(['21']);
    expect(c.isOpen()).toBe(false);
  });

  it('un prefijo inválido bloquea el guardado', () => {
    const c = open([rongta7({ id: 'a' })]);
    c.setPrefixes('a', '2a, 123');

    expect(c.formatViews()[0].prefixError).toContain('«2a», «123» no son válidos');
    expect(c.errorCount()).toBe(1);
    c.onSave();
    expect(saved.length).toBe(0);
    expect(c.isOpen()).toBe(true);
  });

  it('dos formatos que chocan bloquean el guardado y explican cómo resolverlo', () => {
    const c = open([
      rongta7({ id: 'a' }),
      { ...createFormatFromPreset('rongta_27'), id: 'b' },
    ]);

    const notice = c.formatViews()[0].notices.find((n) => n.tone === 'error');
    expect(notice?.text).toContain('se rechazan por ambiguas');
    expect(notice?.text).toContain('cambia el prefijo de uno o desactiva uno de los dos');
    // El aviso sale en los dos formatos, pero cuenta como un solo error.
    expect(c.errorCount()).toBe(1);
    c.onSave();
    expect(saved.length).toBe(0);

    c.patch('b', { enabled: false });
    expect(c.errorCount()).toBe(0);
    c.onSave();
    expect(saved.length).toBe(1);
  });

  it('equivalentes con peso máximo distinto: aviso ámbar que lo dice y deja guardar', () => {
    const c = open([
      rongta7({ id: 'a', max_weight_kg: 15 }),
      { ...createFormatFromPreset('rongta_09'), id: 'b' },
    ]);

    const notice = c.formatViews()[0].notices[0];
    expect(notice.tone).toBe('warning');
    expect(notice.text).toContain('distinto peso máximo (este: 15 kg;');
    expect(notice.text).toContain('Hasta 15 kg dan el mismo resultado');
    expect(c.errorCount()).toBe(0);
  });

  it('un prefijo de 0 dígitos es un solo error con mensaje claro', () => {
    const c = open([rongta7({ id: 'a' })]);
    c.setLayout('a', 'prefix_length', 0);

    const v = c.formatViews()[0];
    expect(v.layoutError).toBe('El prefijo necesita al menos 1 dígito');
    expect(v.prefixError).toBeNull();
    expect(c.errorCount()).toBe(1);
  });

  it('remove() borra también el texto de prefijos, el peso y el ajuste abierto', () => {
    const c = open([rongta7({ id: 'a' }), rongta7({ id: 'b', prefixes: ['22'] })]);
    c.toggleAdvanced('a');

    c.remove('a');

    expect(c.draft().map((f) => f.id)).toEqual(['b']);
    expect('a' in c.prefixText()).toBe(false);
    expect('a' in c.maxWeightText()).toBe(false);
    expect(c.isAdvancedOpen('a')).toBe(false);
  });
});
