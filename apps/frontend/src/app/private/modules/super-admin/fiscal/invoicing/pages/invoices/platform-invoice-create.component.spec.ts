import { FormControl } from '@angular/forms';

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
