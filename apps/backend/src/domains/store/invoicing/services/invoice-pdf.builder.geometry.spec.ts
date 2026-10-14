import { GEOMETRY } from './invoice-pdf.builder';

const MM = 72 / 25.4;
const contentMm = (f: keyof typeof GEOMETRY) =>
  (GEOMETRY[f].width - GEOMETRY[f].margin * 2) / MM;

describe('InvoicePdfBuilder GEOMETRY — ancho imprimible', () => {
  it('thermal_80 imprime 72 mm de contenido', () => {
    expect(contentMm('thermal_80')).toBeCloseTo(72, 1);
    expect(contentMm('thermal_80')).toBeLessThanOrEqual(72.01);
  });

  it('thermal_58 imprime 48 mm de contenido', () => {
    expect(contentMm('thermal_58')).toBeCloseTo(48, 1);
    expect(contentMm('thermal_58')).toBeLessThanOrEqual(48.01);
  });

  it.each(['letter', 'a4', 'half_letter'] as const)(
    '%s tiene margen lateral >= 5 mm',
    (f) => {
      expect(GEOMETRY[f].margin / MM).toBeGreaterThanOrEqual(5 - 1e-6);
    },
  );

  it('el QR mínimo de 20 mm cabe en el contenido de 58 mm', () => {
    expect(contentMm('thermal_58')).toBeGreaterThanOrEqual(20);
  });
});
