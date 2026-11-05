import { ValidationPipe } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto, UpdateProductDto, UpdateProductVariantDto } from './index';

/**
 * S2 (T15): the rental fields travel through the REAL global pipe options
 * (whitelist + forbidNonWhitelisted), so a field the DTO does not declare is a 400.
 */
describe('DTOs de producto de alquiler (ValidationPipe real)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (metatype: new () => object, payload: Record<string, unknown>) =>
    pipe.transform(payload, { type: 'body', metatype });

  const baseProduct = { name: 'Alquiler cava', base_price: 100000 };

  it('el producto acepta unidad de duración y modo de precio del alquiler', async () => {
    const dto: any = await run(CreateProductDto, {
      ...baseProduct,
      service_duration_minutes: 240,
      service_duration_unit: 'hour',
      rental_pricing_mode: 'station_rate',
    });
    expect(dto.service_duration_unit).toBe('hour');
    expect(dto.rental_pricing_mode).toBe('station_rate');
  });

  it('el producto acepta null para limpiar la unidad y el modo al editar', async () => {
    const dto: any = await run(UpdateProductDto, { service_duration_unit: null, rental_pricing_mode: null });
    expect(dto.service_duration_unit).toBeNull();
    expect(dto.rental_pricing_mode).toBeNull();
  });

  it('rechaza una unidad o un modo que no existen', async () => {
    await expect(run(CreateProductDto, { ...baseProduct, service_duration_unit: 'week' })).rejects.toBeDefined();
    await expect(run(UpdateProductDto, { rental_pricing_mode: 'por_hora' })).rejects.toBeDefined();
  });

  it('la variante acepta unidad de duración pero no modo de precio', async () => {
    const created: any = await run(CreateProductVariantDto, { sku: 'ALQ-4H', service_duration_minutes: 240, service_duration_unit: 'hour' });
    expect(created.service_duration_unit).toBe('hour');
    const updated: any = await run(UpdateProductVariantDto, { service_duration_unit: 'day' });
    expect(updated.service_duration_unit).toBe('day');
    await expect(run(CreateProductVariantDto, { sku: 'ALQ-4H', rental_pricing_mode: 'station_rate' })).rejects.toBeDefined();
  });

  it('un producto sin los campos nuevos sigue validando igual', async () => {
    const dto: any = await run(CreateProductDto, { ...baseProduct, service_duration_minutes: 60 });
    expect(dto.service_duration_unit).toBeUndefined();
    expect(dto.rental_pricing_mode).toBeUndefined();
  });
});
