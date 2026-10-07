import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DianMunicipalityQueryDto } from './dto/dian-municipality.dto';
import { DianMunicipalitiesService } from './dian-municipalities.service';

describe('DianMunicipalitiesService', () => {
  let service: DianMunicipalitiesService;

  beforeEach(() => {
    service = new DianMunicipalitiesService();
  });

  it('returns all La Guajira municipalities sorted by name, ignoring the legacy page limit', () => {
    const result = service.search(undefined, 1, '44');

    expect(result.items).toHaveLength(15);
    expect(result.total).toBe(15);
    expect(result.hasMore).toBe(false);
    expect(result.items.every((item) => item.department_code === '44')).toBe(true);
    expect(result.items.map((item) => item.name)).toEqual(
      [...result.items.map((item) => item.name)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('returns all 125 Antioquia municipalities', () => {
    const result = service.search(undefined, 20, '05');

    expect(result.items).toHaveLength(125);
    expect(result.total).toBe(125);
    expect(result.hasMore).toBe(false);
    expect(result.items.every((item) => item.department_code === '05')).toBe(true);
  });

  it('returns all four Vichada municipalities for department 99', () => {
    const result = service.search(undefined, 1, '99');

    expect(result.items).toHaveLength(4);
    expect(result.items.every((item) => item.department_code === '99')).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it('returns no municipalities for a syntactically valid but unknown department', () => {
    expect(service.search(undefined, undefined, '00')).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
  });

  it('retains textual filtering within the selected department', () => {
    const result = service.search('riohacha', 1, '44');

    expect(result.items.map((item) => item.code)).toEqual(['44001']);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('preserves legacy pagination and text-search behavior without a department', () => {
    const firstPage = service.search('05', 1);

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].code).toBe('05001');
    expect(firstPage.total).toBeGreaterThan(1);
    expect(firstPage.hasMore).toBe(true);

    const textSearch = service.search('medell');
    expect(textSearch.items[0].name).toBe('Medellín');
    expect(textSearch.total).toBe(1);
    expect(textSearch.hasMore).toBe(false);
  });

  it('rejects department codes that are not exactly two digits', async () => {
    const dto = plainToInstance(DianMunicipalityQueryDto, {
      department_code: '4X',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'department_code')).toBe(true);
  });
});
