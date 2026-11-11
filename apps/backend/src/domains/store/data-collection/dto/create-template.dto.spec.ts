import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTemplateDto } from './create-template.dto';

async function stationTypeErrors(station_type: string) {
  const dto = plainToInstance(CreateTemplateDto, { name: 'Ingreso', station_type });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'station_type');
}

describe('CreateTemplateDto.station_type', () => {
  it('accepts a court template ("cancha"), the same type a station already accepts', async () => {
    expect(await stationTypeErrors('cancha')).toHaveLength(0);
  });

  it('keeps accepting the previous station types', async () => {
    for (const type of ['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular']) {
      expect(await stationTypeErrors(type)).toHaveLength(0);
    }
  });

  it('keeps rejecting unknown station types', async () => {
    expect(await stationTypeErrors('nave_espacial')).toHaveLength(1);
  });
});
