import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUpdateProfileDto } from './update-profile.dto';

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(AuthUpdateProfileDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe('AuthUpdateProfileDto document_type', () => {
  it.each(['cc', 'CC', 'Cc', ' cc '])('accepts %p as CC', async (value) => {
    const { dto, errors } = await check({ document_type: value });
    expect(errors).toHaveLength(0);
    expect(dto.document_type).toBe('CC');
  });

  it.each(['X', 'C.C.'])('rejects %p with a Spanish message', async (value) => {
    const { errors } = await check({ document_type: value });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('document_type');
    expect(Object.values(errors[0].constraints ?? {})).toEqual([
      'Tipo de documento no válido. Usa CC, CE, NIT, TI, RC, PA, PEP, PPT, DIE o NUIP.',
    ]);
  });

  it.each([null, '', '  '])('maps %p to null so the field can be cleared', async (value) => {
    const { dto, errors } = await check({
      document_type: value,
      document_number: null,
    });
    expect(errors).toHaveLength(0);
    expect(dto.document_type).toBeNull();
    expect(dto.document_number).toBeNull();
  });

  it('keeps the rest of the profile fields valid', async () => {
    const { errors } = await check({
      first_name: 'Rafael',
      last_name: 'M',
      phone: '3001234567',
      document_type: 'nit',
      document_number: '900123456',
      avatar_url: 'organizations/o/users/1/avatars/a.webp',
      address: {
        address_line_1: 'Calle 1',
        city: 'Bogotá',
        state: 'Cundinamarca',
        postal_code: '110111',
        country: 'CO',
      },
    });
    expect(errors).toHaveLength(0);
  });
});
