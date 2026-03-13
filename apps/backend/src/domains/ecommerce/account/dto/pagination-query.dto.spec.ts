import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationQueryDto } from './pagination-query.dto';

describe('PaginationQueryDto', () => {
  it('should validate default values', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it('should accept valid page and limit', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '5', limit: '25' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(5);
    expect(dto.limit).toBe(25);
  });

  it('should reject negative page', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '-1' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should reject zero page', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '0' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-numeric page', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject limit over 100', async () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: '101' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should reject negative limit', async () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: '-5' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-numeric limit', async () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: 'xyz' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept maximum limit of 100', async () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: '100' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.limit).toBe(100);
  });

  it('should accept minimum page of 1', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '1' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
  });
});
