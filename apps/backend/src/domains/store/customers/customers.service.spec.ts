import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import * as bcrypt from 'bcrypt';

/**
 * QUI-728 — DIAN Anexo Técnico 19 customer fiscal data.
 *
 * Verifies that `CustomersService.create()` correctly translates the validated
 * DTO payload into the canonical shape the UBL builder expects:
 *
 *   1. persona natural  → first_name + last_name, legal_name = null
 *   2. persona jurídica → legal_name populated, first/last names emptied
 *   3. NIT + DV match   → verification_digit stored, number bare
 *   4. NIT + DV mismatch → throws 400 CUSTOMER_NIT_DV_MISMATCH
 *   5. CC sin DV        → verification_digit = null
 *   6. responsabilidades fiscales + CIIU persisten verbatim
 *   7. responsabilidad inválida → rechazada al borde (clase-validator)
 *
 * The JURIDICA-without-legal_name case is covered by the DTO-level
 * `JuridicaNameRule`; we exercise that constraint directly with
 * `validateOrReject` instead of running the full service to keep the test
 * surface small.
 */
describe('CustomersService — QUI-728 customer fiscal data', () => {
  let service: CustomersService;
  let prismaService: StorePrismaService;
  let eventEmitter: EventEmitter2;

  const mockPrismaService = {
    stores: {
      findUnique: jest.fn(),
    },
    users: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockStore = {
    id: 1,
    organization_id: 100,
    name: 'Test store',
  };

  const mockCustomerRole = { id: 5, name: 'customer' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();

    // Common happy-path stubs for `create()`.
    mockPrismaService.stores.findUnique.mockResolvedValue(mockStore);
    mockPrismaService.users.findFirst.mockResolvedValue(null);
    mockPrismaService.roles.findFirst.mockResolvedValue(mockCustomerRole);
    mockPrismaService.users.create.mockImplementation(async ({ data }) => ({
      id: 42,
      ...data,
      email: data.email,
      user_roles: [],
      store_users: [],
    }));
    mockPrismaService.users.update.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      ...data,
    }));

    // Avoid bcrypt round-trips; return a deterministic hash.
    jest
      .spyOn(bcrypt, 'hash')
      .mockResolvedValue('$2b$12$deterministicMockedHashForCustomerTests' as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create() — persona natural', () => {
    it('persists first_name + last_name and leaves legal_name null', async () => {
      const result = await service.create(1, {
        first_name: 'Ana',
        last_name: 'Pérez',
        document_type: 'CC',
        document_number: '12345678',
        person_type: 'NATURAL',
      } as any);

      expect(mockPrismaService.users.create).toHaveBeenCalledTimes(1);
      const data = mockPrismaService.users.create.mock.calls[0][0].data;

      expect(data.first_name).toBe('Ana');
      expect(data.last_name).toBe('Pérez');
      expect(data.legal_name).toBeNull();
      expect(data.fiscal_responsibilities).toEqual([]);
      expect(data.ciiu_code).toBeNull();
      expect(data.verification_digit).toBeNull();
      expect(result.id).toBe(42);
    });
  });

  describe('create() — persona jurídica', () => {
    it('persists legal_name and clears first/last names', async () => {
      const result = await service.create(1, {
        first_name: '',
        last_name: '',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        person_type: 'JURIDICA',
        tax_regime: 'COMUN',
        fiscal_responsibilities: ['O-13', 'O-15'],
        ciiu_code: '4711',
      } as any);

      expect(mockPrismaService.users.create).toHaveBeenCalledTimes(1);
      const data = mockPrismaService.users.create.mock.calls[0][0].data;

      expect(data.legal_name).toBe('Acme S.A.S');
      expect(data.first_name).toBe('');
      expect(data.last_name).toBe('');
      expect(data.document_number).toBe('900000008');
      expect(data.verification_digit).toBe('3');
      expect(data.tax_regime).toBe('COMUN');
      expect(data.person_type).toBe('JURIDICA');
      expect(data.fiscal_responsibilities).toEqual(['O-13', 'O-15']);
      expect(data.ciiu_code).toBe('4711');
      expect(result.id).toBe(42);
    });
  });

  describe('create() — NIT verification digit', () => {
    it('stores the bare NIT and derived DV when DV matches', async () => {
      // computeNitDv('900000008') = '3' (DIAN módulo 11). Verified by hand.
      await service.create(1, {
        first_name: 'Acme',
        last_name: 'SAS',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        person_type: 'JURIDICA',
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.document_number).toBe('900000008');
      expect(data.verification_digit).toBe('3');
    });

    it('throws 400 CUSTOMER_NIT_DV_MISMATCH when DV disagrees', async () => {
      // computeNitDv('900000008') = '3', so passing '9' is intentionally wrong.
      await expect(
        service.create(1, {
          first_name: 'Acme',
          last_name: 'SAS',
          legal_name: 'Acme S.A.S',
          document_type: 'NIT',
          document_number: '900000008',
          verification_digit: '9',
          person_type: 'JURIDICA',
        } as any),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.CUSTOMER_NIT_DV_MISMATCH.code,
      });
    });
  });

  describe('create() — CC sin DV', () => {
    it('leaves verification_digit as null when document_type is not NIT', async () => {
      await service.create(1, {
        first_name: 'Juan',
        last_name: 'Pérez',
        document_type: 'CC',
        document_number: '12345678',
        person_type: 'NATURAL',
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.document_type).toBe('CC');
      expect(data.document_number).toBe('12345678');
      expect(data.verification_digit).toBeNull();
    });
  });

  describe('create() — responsabilidades fiscales + CIIU', () => {
    it('persists fiscal_responsibilities and ciiu_code verbatim', async () => {
      await service.create(1, {
        first_name: 'Acme',
        last_name: 'SAS',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        person_type: 'JURIDICA',
        fiscal_responsibilities: ['O-13', 'O-15', 'O-47'],
        ciiu_code: '4711',
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.fiscal_responsibilities).toEqual(['O-13', 'O-15', 'O-47']);
      expect(data.ciiu_code).toBe('4711');
    });
  });

  describe('DTO — JURIDICA without legal_name + invalid responsabilidad', () => {
    // The service trusts the DTO layer to reject invalid payloads. Rather than
    // wiring a Nest ValidationPipe (heavy), we instantiate the DTO and run
    // class-validator's `validate()` directly so we can inspect the surfaced
    // errors. This is enough to prove the cross-field rules fire before the
    // service ever sees the data.
    it('JURIDICA without legal_name triggers JuridicaNameRule', async () => {
      const { validate } = await import('class-validator');
      const { CreateCustomerDto } = require('./dto/create-customer.dto');
      const dto = Object.assign(new CreateCustomerDto(), {
        first_name: 'Acme',
        last_name: 'SAS',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        person_type: 'JURIDICA',
        fiscal_responsibilities: ['O-13'],
      });

      const errors = await validate(dto as any);
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages.some((m) => /razón social/i.test(m))).toBe(true);
    });

    it('fiscal_responsibilities with unknown codes triggers FiscalResponsibilityInCatalogRule', async () => {
      const { validate } = await import('class-validator');
      const { CreateCustomerDto } = require('./dto/create-customer.dto');
      const dto = Object.assign(new CreateCustomerDto(), {
        first_name: 'Ana',
        last_name: 'Pérez',
        document_type: 'CC',
        document_number: '12345678',
        person_type: 'NATURAL',
        fiscal_responsibilities: ['O-13', 'INVALID-CODE'],
      });

      const errors = await validate(dto as any);
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages.some((m) => /catálogo RUT/.test(m))).toBe(true);
    });
  });
});
