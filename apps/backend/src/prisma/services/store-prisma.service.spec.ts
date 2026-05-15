import { Test, TestingModule } from '@nestjs/testing';
import { StorePrismaService } from '../services/store-prisma.service';

describe('StorePrismaService', () => {
  let service: StorePrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePrismaService],
    }).compile();

    service = module.get<StorePrismaService>(StorePrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have scoped models available', () => {
    expect(service.products).toBeDefined();
    expect(service.categories).toBeDefined();
    expect(service.orders).toBeDefined();
    expect(service.payments).toBeDefined();
    expect(service.stock_levels).toBeDefined();
  });

  it('should have withoutScope method', () => {
    expect(service.withoutScope).toBeDefined();
  });

  it('should have transaction method', () => {
    expect(service.$transaction).toBeDefined();
  });

  describe('mergeScopedWhere', () => {
    it('keeps a unique store_id at the top level when applying the same scope', () => {
      const result = (service as any).mergeScopedWhere(
        { store_id: 11 },
        { store_id: 11 },
      );

      expect(result).toEqual({ store_id: 11 });
    });

    it('keeps unique fields at the top level and adds non-conflicting scope filters', () => {
      const result = (service as any).mergeScopedWhere(
        { id: 123 },
        { store_id: 11 },
      );

      expect(result).toEqual({ id: 123, store_id: 11 });
    });

    it('preserves impossible conflicting scope checks without losing the unique key', () => {
      const result = (service as any).mergeScopedWhere(
        { store_id: 99 },
        { store_id: 11 },
      );

      expect(result).toEqual({ store_id: 99, AND: [{ store_id: 11 }] });
    });
  });
});
