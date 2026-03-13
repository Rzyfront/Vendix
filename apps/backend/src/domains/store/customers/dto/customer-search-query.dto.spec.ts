import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CustomerSearchQueryDto } from './customer-search-query.dto';

describe('CustomerSearchQueryDto', () => {
  it('should validate default values', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should accept valid page, limit, and search', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { 
      page: '3', 
      limit: '50', 
      search: 'John' 
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
    expect(dto.search).toBe('John');
  });

  it('should reject negative page', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { page: '-1' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should reject zero page', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { page: '0' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-numeric page', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { page: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject limit over 100', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { limit: '101' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should reject negative limit', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { limit: '-5' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-numeric limit', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { limit: 'xyz' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept optional search parameter', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { search: 'test@example.com' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.search).toBe('test@example.com');
  });

  it('should accept empty search', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { search: '' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject non-string search', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { search: 123 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept maximum limit of 100', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { limit: '100' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.limit).toBe(100);
  });

  it('should accept minimum page of 1', async () => {
    const dto = plainToInstance(CustomerSearchQueryDto, { page: '1' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
  });
});
