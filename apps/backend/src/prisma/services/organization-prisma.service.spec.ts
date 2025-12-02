import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationPrismaService } from '../services/organization-prisma.service';

describe('OrganizationPrismaService', () => {
  let service: OrganizationPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrganizationPrismaService],
    }).compile();

    service = module.get<OrganizationPrismaService>(OrganizationPrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have scoped models available', () => {
    expect(service.users).toBeDefined();
    expect(service.organizations).toBeDefined();
    expect(service.stores).toBeDefined();
    expect(service.suppliers).toBeDefined();
    expect(service.addresses).toBeDefined();
    expect(service.audit_logs).toBeDefined();
  });

  it('should have withoutScope method', () => {
    expect(service.withoutScope).toBeDefined();
  });

  it('should have transaction method', () => {
    expect(service.$transaction).toBeDefined();
  });

  // Note: Context validation tests would require mocking RequestContextService
  // and are tested in integration tests with actual HTTP requests
});
