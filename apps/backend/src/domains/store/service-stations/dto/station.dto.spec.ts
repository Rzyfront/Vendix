import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateServiceStationDto, RENTAL_BLOCK_PRICE_MAX, UpdateServiceStationDto } from './station.dto';

const errorsOf = (cls: typeof CreateServiceStationDto | typeof UpdateServiceStationDto, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body)).filter((error) => error.property.startsWith('rental_block'));

describe('Station DTOs — alquiler por bloque', () => {
  describe.each([
    ['CreateServiceStationDto', CreateServiceStationDto, { name: 'Cancha 1' }],
    ['UpdateServiceStationDto', UpdateServiceStationDto, {}],
  ] as const)('%s', (_label, cls, base) => {
    it.each([
      ['sin alquiler', {}],
      ['minutos y precio juntos', { rental_block_minutes: 30, rental_block_price: 5000 }],
      ['quitar el alquiler (ambos null)', { rental_block_minutes: null, rental_block_price: null }],
      ['precio en el tope', { rental_block_minutes: 30, rental_block_price: RENTAL_BLOCK_PRICE_MAX }],
    ])('acepta %s', (_case, body) => {
      expect(errorsOf(cls, { ...base, ...body })).toEqual([]);
    });

    it.each([
      ['solo minutos', { rental_block_minutes: 30 }],
      ['solo precio', { rental_block_price: 5000 }],
      ['minutos con precio null', { rental_block_minutes: 30, rental_block_price: null }],
      ['precio con minutos null', { rental_block_minutes: null, rental_block_price: 5000 }],
    ])('rechaza %s', (_case, body) => {
      const errors = errorsOf(cls, { ...base, ...body });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.flatMap((error) => Object.keys(error.constraints ?? {}))).toContain('IsRentalBlockPair');
    });

    it('rechaza un precio por encima del tope de la columna', () => {
      const errors = errorsOf(cls, { ...base, rental_block_minutes: 30, rental_block_price: RENTAL_BLOCK_PRICE_MAX + 1 });
      expect(errors.flatMap((error) => Object.keys(error.constraints ?? {}))).toContain('max');
    });
  });
});
