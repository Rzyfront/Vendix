import { WorkflowFieldDef } from '@common/workflows/contract';
import {
  isTaxIdField,
  normalizeDate,
  normalizeFieldValue,
  normalizeNumber,
  normalizeTaxId,
} from './document-check-normalizers';

const def = (over: Partial<WorkflowFieldDef>): WorkflowFieldDef =>
  ({ key: 'f', type: 'text', label: 'Campo', ...over }) as WorkflowFieldDef;

describe('normalizadores de lectura con IA', () => {
  it('fechas: ISO, DD/MM/AAAA y rechaza las imposibles', () => {
    expect(normalizeDate('2026-03-15')).toBe('2026-03-15');
    expect(normalizeDate('15/03/2026')).toBe('2026-03-15');
    expect(normalizeDate('5-3-2026')).toBe('2026-03-05');
    expect(normalizeDate('31/02/2026')).toBeNull();
    expect(normalizeDate('marzo')).toBeNull();
  });

  it('números al estilo colombiano y anglo', () => {
    expect(normalizeNumber('1.234.567,89')).toBe(1234567.89);
    expect(normalizeNumber('1,234,567.89')).toBe(1234567.89);
    expect(normalizeNumber('24.990')).toBe(24990);
    expect(normalizeNumber('$ 1.500.000')).toBe(1500000);
    expect(normalizeNumber('12,5')).toBe(12.5);
    expect(normalizeNumber('1234.5')).toBe(1234.5);
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber('abc')).toBeNull();
  });

  it('NIT: solo dígitos y dígito de verificación', () => {
    expect(normalizeTaxId('900.123.456-7')).toBe('900123456-7');
    expect(normalizeTaxId('NIT 900123456')).toBe('900123456');
    expect(normalizeTaxId('12')).toBeNull();
    expect(isTaxIdField(def({ key: 'nit', label: 'NIT del proveedor' }))).toBe(true);
    expect(isTaxIdField(def({ key: 'proveedor', label: 'Proveedor' }))).toBe(false);
    expect(isTaxIdField(def({ key: 'numero_documento', label: 'Número de documento' }))).toBe(true);
    expect(isTaxIdField(def({ key: 'tipo_documento', label: 'Tipo de documento' }))).toBe(false);
    expect(isTaxIdField(def({ key: 'doc', label: 'Documento adjunto' }))).toBe(false);
  });

  it('por tipo de campo', () => {
    expect(normalizeFieldValue(def({ type: 'money' }), '1.234,567')).toBe(1234.57);
    expect(normalizeFieldValue(def({ type: 'date' }), '01/12/2026')).toBe('2026-12-01');
    expect(normalizeFieldValue(def({ key: 'nit', label: 'NIT' }), '900.123.456-7')).toBe('900123456-7');
    expect(normalizeFieldValue(def({ type: 'email' }), ' Ana@Correo.CO ')).toBe('ana@correo.co');
    expect(normalizeFieldValue(def({ type: 'email' }), 'sin arroba')).toBeNull();
    expect(normalizeFieldValue(def({ type: 'phone' }), '+57 300 123 4567')).toBe('+573001234567');
    expect(normalizeFieldValue(def({ type: 'boolean' }), 'Sí')).toBe(true);
    expect(
      normalizeFieldValue(
        def({ type: 'select', options: [{ value: 'cop', label: 'Pesos' }] }),
        'pesos',
      ),
    ).toBe('cop');
    expect(
      normalizeFieldValue(def({ type: 'select', options: [{ value: 'cop', label: 'Pesos' }] }), 'euros'),
    ).toBeNull();
    expect(normalizeFieldValue(def({ type: 'text' }), '  Papelería   Andina ')).toBe('Papelería Andina');
    expect(normalizeFieldValue(def({ type: 'text' }), null)).toBeNull();
  });
});
