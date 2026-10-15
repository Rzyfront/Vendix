import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitInvoiceDataDto } from './submit-invoice-data.dto';
const natural = {
  person_type: 'NATURAL',
  document_type: 'CC',
  document_number: '1023456789',
  first_name: 'Ana',
  last_name: 'Díaz',
  email: 'ana@example.test',
  address: {
    address_line1: 'Calle 10 # 1-2',
    city: 'Bogotá',
    state_province: 'Bogotá',
    country_code: 'CO',
    municipality_code: '11001',
  },
};
const errors = (data: unknown) =>
  validate(plainToInstance(SubmitInvoiceDataDto, data), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('SubmitInvoiceDataDto', () => {
  it('accepts natural and juridica without personal names', async () => {
    expect(await errors(natural)).toHaveLength(0);
    const { first_name, last_name, ...base } = natural;
    expect(
      await errors({
        ...base,
        person_type: 'JURIDICA',
        document_type: 'NIT',
        document_number: '900123456',
        legal_name: 'Empresa SAS',
        verification_digit: '8',
      }),
    ).toHaveLength(0);
  });
  it.each([
    { email: '' },
    { email: 'bad' },
    { document_type: 'PP' },
    { person_type: 'OTRA' },
    { address: undefined },
    { first_name: '' },
    { address: { ...natural.address, municipality_code: 'bogota' } },
    { admin: true },
  ])('rejects invalid capture %j', async (over) => {
    expect((await errors({ ...natural, ...over })).length).toBeGreaterThan(0);
  });
  it('accepts PA and catalog DIE without inventing PP or DE aliases', async () => {
    expect(
      await errors({
        ...natural,
        document_type: 'PA',
        document_number: 'AA12345',
      }),
    ).toHaveLength(0);
    expect(
      await errors({
        ...natural,
        document_type: 'DIE',
        document_number: 'AB12345',
      }),
    ).toHaveLength(0);
  });
});
