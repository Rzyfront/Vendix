import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PqrService } from './pqr.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { ticket_priority_enum, ticket_status_enum } from '@prisma/client';

describe('PqrService — QUI-791 multi-tenant PQR flow', () => {
  let service: PqrService;
  let prisma: GlobalPrismaService;
  let eventEmitter: EventEmitter2;

  const mockGlobalPrisma = {
    stores: {
      findUnique: jest.fn(),
    },
    organizations: {
      findFirst: jest.fn(),
    },
    users: {
      findFirst: jest.fn(),
    },
    support_tickets: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockAnonUser = {
    id: 99,
    email: 'anon-pqr@vendix.online',
  };

  const mockPlatformOrg = {
    id: 1,
    name: 'Vendix HQ',
    is_platform: true,
  };

  const mockStore = {
    id: 10,
    name: 'Nike Store',
    organization_id: 6,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PqrService,
        {
          provide: GlobalPrismaService,
          useValue: mockGlobalPrisma,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<PqrService>(PqrService);
    prisma = module.get<GlobalPrismaService>(GlobalPrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();

    mockGlobalPrisma.users.findFirst.mockResolvedValue(mockAnonUser);
    // Ticket number generator relies on count or queryRaw fallback
    mockGlobalPrisma.support_tickets.count.mockResolvedValue(1);
    mockGlobalPrisma.support_tickets.create.mockImplementation(async ({ data }) => ({
      id: 101,
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      closed_at: null,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createPublic()', () => {
    it('resolves owningOrgId from store when store_id is provided', async () => {
      mockGlobalPrisma.stores.findUnique.mockResolvedValue(mockStore);

      const dto = {
        name: 'Juan Pérez',
        email: 'juan@gmail.com',
        phone: '3001234567',
        subject: 'Demora en entrega',
        description: 'Mi pedido no ha llegado',
        pqr_type: 'CLAIM' as const,
        store_id: 10,
      };

      const result = await service.createPublic(dto as any, '127.0.0.1');

      expect(mockGlobalPrisma.stores.findUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: { organization_id: true },
      });

      expect(mockGlobalPrisma.support_tickets.create).toHaveBeenCalledTimes(1);
      const createData = mockGlobalPrisma.support_tickets.create.mock.calls[0][0].data;
      expect(createData.organization_id).toBe(6);
      expect(createData.store_id).toBe(10);
      expect(createData.title).toBe('Demora en entrega');
      expect(createData.requester_email).toBe('juan@gmail.com');
      expect(createData.tags).toEqual(['pqr', 'claim', 'ip:127.0.0.1']);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'pqr.created',
        expect.objectContaining({
          ticket: expect.objectContaining({
            organization_id: 6,
            store_id: 10,
            title: 'Demora en entrega',
          }),
          contact: expect.objectContaining({
            name: 'Juan Pérez',
            email: 'juan@gmail.com',
            pqr_type: 'CLAIM',
          }),
        }),
      );

      expect(result.id).toBe(101);
    });

    it('uses platform org when neither store_id nor organization_id is provided', async () => {
      mockGlobalPrisma.organizations.findFirst.mockResolvedValue(mockPlatformOrg);

      const dto = {
        name: 'Carlos Gomez',
        email: 'carlos@gmail.com',
        subject: 'Duda sobre la plataforma',
        description: 'Cómo registro una tienda?',
        pqr_type: 'PETITION' as const,
      };

      const result = await service.createPublic(dto as any, '127.0.0.1');

      expect(mockGlobalPrisma.organizations.findFirst).toHaveBeenCalledWith({
        where: { is_platform: true },
      });

      const createData = mockGlobalPrisma.support_tickets.create.mock.calls[0][0].data;
      expect(createData.organization_id).toBe(1);
      expect(createData.store_id).toBeNull();
      expect(result.id).toBe(101);
    });

    it('throws SUP_PQR_001 when store_id is provided but store is not found', async () => {
      mockGlobalPrisma.stores.findUnique.mockResolvedValue(null);

      const dto = {
        name: 'Juan',
        email: 'juan@test.com',
        subject: 'Test',
        description: 'Test',
        pqr_type: 'PETITION' as const,
        store_id: 9999,
      };

      await expect(service.createPublic(dto as any, '127.0.0.1')).rejects.toMatchObject({
        errorCode: ErrorCodes.SUP_PQR_001.code,
      });
    });

    it('throws SUP_PQR_002 when anon-pqr user is not found in the database', async () => {
      mockGlobalPrisma.stores.findUnique.mockResolvedValue(mockStore);
      mockGlobalPrisma.users.findFirst.mockResolvedValue(null);

      const dto = {
        name: 'Juan',
        email: 'juan@test.com',
        subject: 'Test',
        description: 'Test',
        pqr_type: 'PETITION' as const,
        store_id: 10,
      };

      await expect(service.createPublic(dto as any, '127.0.0.1')).rejects.toMatchObject({
        errorCode: ErrorCodes.SUP_PQR_002.code,
      });
    });
  });

  describe('findByTicketNumberPublic()', () => {
    it('returns sanitized public PQR view for a platform ticket', async () => {
      mockGlobalPrisma.organizations.findFirst.mockResolvedValue(mockPlatformOrg);
      mockGlobalPrisma.support_tickets.findFirst.mockResolvedValue({
        id: 50,
        ticket_number: 'PQRS-1-00001',
        title: 'Garantía de producto',
        status: ticket_status_enum.IN_PROGRESS,
        category: 'CLAIM',
        priority: ticket_priority_enum.P2,
        organization_id: 1,
        created_at: new Date('2026-09-01'),
        updated_at: new Date('2026-09-02'),
        resolved_at: null,
        closed_at: null,
        comments: [
          {
            id: 1,
            content: 'Estamos revisando su caso con el almacén.',
            author_name: 'Soporte Vendix',
            author_type: 'admin',
            created_at: new Date('2026-09-02'),
          },
        ],
      });

      const result = await service.findByTicketNumberPublic('PQRS-1-00001');

      expect(mockGlobalPrisma.organizations.findFirst).toHaveBeenCalledWith({
        where: { is_platform: true },
        select: { id: true },
      });
      expect(mockGlobalPrisma.support_tickets.findFirst).toHaveBeenCalledWith({
        where: {
          ticket_number: 'PQRS-1-00001',
          tags: { has: 'pqr' },
        },
        select: expect.any(Object),
      });

      expect(result).toEqual({
        ticket_number: 'PQRS-1-00001',
        title: 'Garantía de producto',
        status: ticket_status_enum.IN_PROGRESS,
        pqr_type: 'CLAIM',
        priority: ticket_priority_enum.P2,
        created_at: new Date('2026-09-01'),
        updated_at: new Date('2026-09-02'),
        resolved_at: null,
        closed_at: null,
        public_responses: [
          {
            id: 1,
            content: 'Estamos revisando su caso con el almacén.',
            author_name: 'Soporte Vendix',
            author_type: 'admin',
            created_at: new Date('2026-09-02'),
          },
        ],
      });
    });

    it('throws SUP_PQR_003 when ticket does not exist or lacks pqr tag', async () => {
      mockGlobalPrisma.organizations.findFirst.mockResolvedValue(mockPlatformOrg);
      mockGlobalPrisma.support_tickets.findFirst.mockResolvedValue(null);

      await expect(service.findByTicketNumberPublic('NON-EXISTENT')).rejects.toMatchObject({
        errorCode: ErrorCodes.SUP_PQR_003.code,
      });
    });

    it('throws SUP_PQR_003 for a store ticket even when it exists (ADR-05)', async () => {
      mockGlobalPrisma.organizations.findFirst.mockResolvedValue(mockPlatformOrg);
      mockGlobalPrisma.support_tickets.findFirst.mockResolvedValue({
        id: 51,
        ticket_number: 'PQRS-6-00001',
        title: 'Pedido incompleto',
        status: ticket_status_enum.NEW,
        category: 'CLAIM',
        priority: ticket_priority_enum.P3,
        organization_id: 6,
        created_at: new Date('2026-09-03'),
        updated_at: new Date('2026-09-03'),
        resolved_at: null,
        closed_at: null,
        comments: [],
      });

      await expect(service.findByTicketNumberPublic('PQRS-6-00001')).rejects.toMatchObject({
        errorCode: ErrorCodes.SUP_PQR_003.code,
      });
    });
  });

  describe('adminFindAll() — multi-tenant scoping', () => {
    it('scopes queries by both organization_id and store_id when store context is present', async () => {
      jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(6);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(10);

      mockGlobalPrisma.support_tickets.count.mockResolvedValue(1);
      mockGlobalPrisma.support_tickets.findMany.mockResolvedValue([
        {
          id: 101,
          ticket_number: 'PQRS-6-00002',
          title: 'Pedido incompleto',
          description: 'Falta un producto',
          status: ticket_status_enum.NEW,
          category: 'CLAIM',
          priority: ticket_priority_enum.P3,
          store_id: 10,
          organization_id: 6,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
        },
      ]);

      const result = await service.adminFindAll({ page: 1, limit: 20 });

      expect(mockGlobalPrisma.support_tickets.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { has: 'pqr' },
            organization_id: 6,
            store_id: 10,
          }),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.meta.total).toBe(1);
    });

    it('scopes queries by organization_id only when store context is absent (org-admin)', async () => {
      jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(6);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);

      mockGlobalPrisma.support_tickets.count.mockResolvedValue(2);
      mockGlobalPrisma.support_tickets.findMany.mockResolvedValue([]);

      await service.adminFindAll({ page: 1, limit: 20 });

      expect(mockGlobalPrisma.support_tickets.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tags: { has: 'pqr' },
            organization_id: 6,
          },
        }),
      );
    });
  });
});
