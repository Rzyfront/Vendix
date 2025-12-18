import { Test, TestingModule } from '@nestjs/testing';
import { GlobalPrismaService } from '../services/global-prisma.service';

describe('GlobalPrismaService', () => {
  let service: GlobalPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalPrismaService],
    }).compile();

    service = module.get<GlobalPrismaService>(GlobalPrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have all models available', () => {
    expect(service.users).toBeDefined();
    expect(service.organizations).toBeDefined();
    expect(service.stores).toBeDefined();
    expect(service.products).toBeDefined();
    expect(service.brands).toBeDefined();
  });

  it('should have withoutScope method', () => {
    expect(service.withoutScope).toBeDefined();
  });

  it('should have transaction method', () => {
    expect(service.$transaction).toBeDefined();
  });
});
