import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ListPlatformResolutionsQueryDto } from './subscription-fiscal.dto';

const parse = (query: object) =>
  plainToInstance(ListPlatformResolutionsQueryDto, query, {
    enableImplicitConversion: true,
  });

describe('ListPlatformResolutionsQueryDto · is_active', () => {
  it.each([
    ['false', false],
    ['true', true],
  ])("is_active=%s -> %s", (raw, expected) => {
    const dto = parse({ is_active: raw });
    expect(dto.is_active).toBe(expected);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ausente queda undefined y valida', () => {
    const dto = parse({});
    expect(dto.is_active).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('un valor que no es booleano se rechaza', () => {
    expect(validateSync(parse({ is_active: 'maybe' }))).not.toHaveLength(0);
  });
});
