import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CatalogQueryDto, MAX_CATALOG_QUERY_IDS } from './catalog-query.dto';

/**
 * Contrato de `CatalogQueryDto.ids` (P1 de la review del release del 25-nov).
 *
 * La página pública de servicios pide hasta 60 ids en una sola llamada al
 * catálogo. Con el tope viejo de 50 el endpoint respondía 400 y la página caía
 * en «no disponible», así que el tope queda alineado con el `@Max(100)` de
 * `limit`.
 */
describe('CatalogQueryDto ids', () => {
  const build = (input: Record<string, unknown>) =>
    plainToInstance(CatalogQueryDto, input, { enableImplicitConversion: true });

  const csv = (count: number) =>
    Array.from({ length: count }, (_, index) => String(index + 1)).join(',');

  it('acepta 60 ids (tope de la página pública de servicios)', async () => {
    const dto = build({ ids: csv(60), limit: 60 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('acepta exactamente el máximo permitido', async () => {
    const dto = build({ ids: csv(MAX_CATALOG_QUERY_IDS) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza más ids que el máximo y lo dice en el mensaje', async () => {
    const dto = build({ ids: csv(MAX_CATALOG_QUERY_IDS + 1) });
    const errors = await validate(dto);
    const idsError = errors.find((error) => error.property === 'ids');
    expect(idsError).toBeDefined();
    expect(idsError?.constraints?.maxCatalogIds).toContain(
      String(MAX_CATALOG_QUERY_IDS),
    );
  });

  it('el tope no baja del tope de la página de servicios (60)', () => {
    expect(MAX_CATALOG_QUERY_IDS).toBeGreaterThanOrEqual(60);
  });
});
