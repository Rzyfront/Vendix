import {
  PlatformInvoiceCreateComponent,
  calculateDianDv,
} from './platform-invoice-create.component';

/**
 * Humo de compilación: importar la página obliga a Karma a compilarla en AOT
 * con chequeo de plantillas (chip de perfil, resumen del adquiriente, búsqueda
 * por NIT, faltantes para emitir y escáner IA).
 */
describe('PlatformInvoiceCreateComponent', () => {
  it('compila la página', () => {
    expect(PlatformInvoiceCreateComponent).toBeTruthy();
  });

  it('calcula el DV DIAN (módulo 11)', () => {
    expect(calculateDianDv('900123456')).toBe('8');
    expect(calculateDianDv('')).toBe('');
  });
});
