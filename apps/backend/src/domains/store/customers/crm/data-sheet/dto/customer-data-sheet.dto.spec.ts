import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveCustomerDataSheetValuesDto } from './customer-data-sheet.dto';

/** QUI-1043: a bad answer is a 400, never a Prisma error. */
async function errorsFor(value: Record<string, unknown>) {
  const dto = plainToInstance(SaveCustomerDataSheetValuesDto, {
    values: [{ field_id: 1, ...value }],
  });
  const [error] = await validate(dto);
  return (error?.children?.[0]?.children ?? []).map((child) => child.property);
}

describe('SaveCustomerDataSheetValuesDto', () => {
  it('accepts every kind of answer and all-null entries', async () => {
    expect(
      await errorsFor({
        value_text: 'Hola',
        value_number: -12.5,
        value_date: '2028-02-29',
        value_bool: true,
        value_json: ['a', 'b'],
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        value_text: null,
        value_number: null,
        value_date: null,
        value_bool: null,
        value_json: null,
      }),
    ).toEqual([]);
  });

  it('value_json also accepts a documents answer { files }, and nothing else object-shaped', async () => {
    const file = { key: 'a/b.pdf', name: 'b.pdf', size: 3, mime_type: 'application/pdf' };
    expect(await errorsFor({ value_json: { files: [file] } })).toEqual([]);
    expect(await errorsFor({ value_json: { files: [] } })).toEqual([]);
    expect(await errorsFor({ value_json: { files: [{ name: 'x' }] } })).toEqual(['value_json']);
    expect(await errorsFor({ value_json: { files: [file], other: 1 } })).toEqual(['value_json']);
    expect(await errorsFor({ value_json: { files: Array(11).fill(file) } })).toEqual(['value_json']);
  });

  it('rejects numbers outside Decimal(12, 4)', async () => {
    expect(await errorsFor({ value_number: 100_000_000 })).toEqual(['value_number']);
    expect(await errorsFor({ value_number: -100_000_000 })).toEqual(['value_number']);
  });

  it('rejects dates that do not exist or are not YYYY-MM-DD', async () => {
    expect(await errorsFor({ value_date: '2026-13-45' })).toEqual(['value_date']);
    expect(await errorsFor({ value_date: '2026-02-30' })).toEqual(['value_date']);
    expect(await errorsFor({ value_date: '2026-02-03T10:00:00Z' })).toEqual(['value_date']);
  });

  it('value_json is only a short list of strings', async () => {
    expect(await errorsFor({ value_json: { nested: true } })).toEqual(['value_json']);
    expect(await errorsFor({ value_json: [1, 2] })).toEqual(['value_json']);
    expect(
      await errorsFor({ value_json: Array.from({ length: 101 }, (_, i) => `${i}`) }),
    ).toEqual(['value_json']);
  });
});
