import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BarcodeScannerSettingsDto } from './settings-schemas.dto';

const validFormat = {
  id: 'f1',
  name: 'Balanza carnicería',
  enabled: true,
  preset: 'rongta_07',
  length: 13,
  prefixes: ['21'],
  prefix_length: 2,
  product_code_start: 2,
  product_code_length: 5,
  value_start: 7,
  value_length: 5,
  value_decimals: 3,
  value_unit: 'kg',
  max_weight_kg: 30,
};

const check = async (payload: unknown) =>
  validate(plainToInstance(BarcodeScannerSettingsDto, payload));

describe('BarcodeScannerSettingsDto.variable_barcodes', () => {
  it('acepta el objeto ausente (se trata como deshabilitado)', async () => {
    expect(await check({ enabled: true })).toHaveLength(0);
  });

  it('acepta variable_barcodes deshabilitado y vacío', async () => {
    expect(
      await check({ enabled: true, variable_barcodes: { enabled: false, formats: [] } }),
    ).toHaveLength(0);
  });

  it('acepta un formato válido', async () => {
    expect(
      await check({
        enabled: true,
        variable_barcodes: { enabled: true, formats: [validFormat] },
      }),
    ).toHaveLength(0);
  });

  it('rechaza más de 10 formatos', async () => {
    const formats = Array.from({ length: 11 }, (_, i) => ({ ...validFormat, id: `f${i}` }));
    const errors = await check({ variable_barcodes: { enabled: true, formats } });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza más de 20 prefijos', async () => {
    const prefixes = Array.from({ length: 21 }, (_, i) => String(10 + i));
    const errors = await check({
      variable_barcodes: { enabled: true, formats: [{ ...validFormat, prefixes }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza prefijos no numéricos', async () => {
    const errors = await check({
      variable_barcodes: { enabled: true, formats: [{ ...validFormat, prefixes: ['2a'] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza prefijos de largo distinto a prefix_length', async () => {
    const errors = await check({
      variable_barcodes: { enabled: true, formats: [{ ...validFormat, prefixes: ['210'] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza posiciones fuera de 0..13', async () => {
    const errors = await check({
      variable_barcodes: { enabled: true, formats: [{ ...validFormat, value_start: 14 }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza length distinto de 13 y preset desconocido', async () => {
    expect(
      (await check({ variable_barcodes: { formats: [{ ...validFormat, length: 12 }] } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check({ variable_barcodes: { formats: [{ ...validFormat, preset: 'x' }] } })).length,
    ).toBeGreaterThan(0);
  });
});
