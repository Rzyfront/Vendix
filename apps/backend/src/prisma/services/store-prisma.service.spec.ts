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
});
