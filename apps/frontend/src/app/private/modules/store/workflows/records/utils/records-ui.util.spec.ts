import { RecordFieldDef } from '../interfaces/records.interfaces';
import {
  formFromValues,
  formatDateOnly,
  formatRecordValue,
  keyFromLabel,
  prefixFromName,
  valuesFromForm,
} from './records-ui.util';

const FIELDS: RecordFieldDef[] = [
  { key: 'cliente', label: 'Cliente', type: 'text', required: true },
  { key: 'valor', label: 'Valor', type: 'money' },
  { key: 'activo', label: 'Activo', type: 'boolean' },
  { key: 'estado', label: 'Estado', type: 'select', options: [{ value: 'a', label: 'Activo' }] },
];

describe('records-ui.util', () => {
  it('keyFromLabel makes a valid field key', () => {
    expect(keyFromLabel('Fecha de vencimiento')).toBe('fecha_de_vencimiento');
    expect(keyFromLabel('Número')).toBe('numero');
    expect(keyFromLabel('2da fecha')).toBe('c_2da_fecha');
    expect(keyFromLabel('***')).toBe('');
  });

  it('prefixFromName takes the first letters of the name', () => {
    expect(prefixFromName('Contratos')).toBe('CON');
    expect(prefixFromName('Pólizas')).toBe('POL');
    expect(prefixFromName('1')).toBe('');
  });

  it('formats a date without moving it across time zones', () => {
    expect(formatDateOnly('2026-12-07')).toBe('7/12/2026');
  });

  it('formatRecordValue shows booleans, option labels and money through the given formatter', () => {
    const money = (n: number) => `$${n}`;
    expect(formatRecordValue(FIELDS[2], true, money)).toBe('Sí');
    expect(formatRecordValue(FIELDS[2], false, money)).toBe('No');
    expect(formatRecordValue(FIELDS[3], 'a', money)).toBe('Activo');
    expect(formatRecordValue(FIELDS[1], 1500, money)).toBe('$1500');
    expect(formatRecordValue(FIELDS[0], undefined, money)).toBe('—');
  });

  it('valuesFromForm converts numbers and clears empty values only when asked', () => {
    const form = { cliente: ' Acme ', valor: '1500', activo: false, estado: '' };
    expect(valuesFromForm(FIELDS, form, false)).toEqual({ cliente: 'Acme', valor: 1500, activo: false });
    expect(valuesFromForm(FIELDS, form, true)).toEqual({
      cliente: 'Acme',
      valor: 1500,
      activo: false,
      estado: null,
    });
  });

  it('formFromValues turns stored values into form state', () => {
    expect(formFromValues(FIELDS, { cliente: 'Acme', valor: 10, activo: true })).toEqual({
      cliente: 'Acme',
      valor: '10',
      activo: true,
      estado: '',
    });
  });
});
