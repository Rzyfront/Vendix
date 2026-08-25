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
    store_users: {
      upsert: jest.fn(),
    },
    // `$transaction([...ops])` runs the ops in order; each is awaited.
    // For tests we want the underlying `users.update` and `store_users.upsert`
    // mocks to capture the calls, so we evaluate them eagerly.
    $transaction: jest.fn(async (ops: unknown[]) => {
      const results: unknown[] = [];
      for (const op of ops) {
        results.push(await (op as Promise<unknown>));
      }
      return results;
    }),
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

  /**
   * QUI-723 — POS finalize-sale find-or-create flow.
   *
   * The contract under test:
   *   - Match priority: email first, then exact (document_type, document_number).
   *   - Update strategy: CONSERVATIVE — only null/empty fields on the existing
   *     row get filled; never overwrite already-confirmed data.
   *   - No match: delegate to `create()` so we inherit username uniqueness,
   *     NIT/DV split, password hashing, and `customer.created` event.
   *   - `linkCustomerToStore` is called idempotently on every match.
   */
  describe('findOrCreateByEmailOrDocument — QUI-723', () => {
    const existingByEmail = {
      id: 7,
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: null,
      document_type: 'CC',
      document_number: '12345678',
      email: 'juan@x.com',
      state: 'active',
      user_roles: [],
      store_users: [{ store_id: 1 }],
      addresses: [],
    };

    const existingByDocument = {
      id: 11,
      first_name: 'María',
      last_name: 'Gómez',
      phone: '+573101234567',
      document_type: 'CC',
      document_number: '99999999',
      email: 'maria@x.com',
      state: 'active',
      user_roles: [],
      store_users: [{ store_id: 1 }],
      addresses: [],
    };

    beforeEach(() => {
      // Common happy path: store exists; no email/document match unless a test
      // overrides with `mockResolvedValueOnce`.
      mockPrismaService.stores.findUnique.mockResolvedValue(mockStore);
      mockPrismaService.users.findFirst.mockResolvedValue(null);
    });

    it('matches by email and returns was_updated=false when nothing new arrives', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce(existingByEmail);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
      } as any);

      expect(result.was_created).toBe(false);
      expect(result.was_updated).toBe(false);
      expect(result.matched_by).toBe('email');
      expect(result.customer.id).toBe(7);
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      expect(mockPrismaService.users.create).not.toHaveBeenCalled();
    });

    it('matches by email and fills a null phone (conservative update)', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce(existingByEmail);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
        phone: '+573001234567',
      } as any);

      expect(result.was_created).toBe(false);
      expect(result.was_updated).toBe(true);
      expect(result.matched_by).toBe('email');
      expect(mockPrismaService.users.update).toHaveBeenCalledTimes(1);
      const updateData = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(updateData).toEqual({ phone: '+573001234567' });
    });

    it('OVERWRITES a confirmed first_name when the request carries a different one', async () => {
      // Per dev lead's clarified spec: matching unique identifier → edit
      // (overwrite) with the typed values. The cashier's typed name
      // becomes the new truth on the existing row.
      mockPrismaService.users.findFirst.mockResolvedValueOnce(existingByEmail);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
        first_name: 'OTRO NOMBRE',
      } as any);

      expect(result.was_created).toBe(false);
      expect(result.was_updated).toBe(true);
      expect(result.matched_by).toBe('email');
      expect(mockPrismaService.users.update).toHaveBeenCalledTimes(1);
      const updateData = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(updateData).toEqual({ first_name: 'OTRO NOMBRE' });
    });

    it('matches by exact (document_type, document_number) when no email matches', async () => {
      // DTO has no email → email-lookup branch is skipped. The only
      // `findFirst` call comes from `findByDocumentInOrganization`.
      mockPrismaService.users.findFirst.mockResolvedValueOnce(existingByDocument);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        document_type: 'CC',
        document_number: '99999999',
        phone: '+573109999999',
      } as any);

      expect(result.was_created).toBe(false);
      expect(result.matched_by).toBe('document');
      expect(result.customer.id).toBe(11);
      // Overwrite semantics: every non-empty DTO field lands in the
      // Per lead's clarified spec: the document pair is one of the
      // unique IDs that drove the match — it is NOT overwritten. Only
      // the "other fields" (first_name, last_name, phone) get
      // written back. The cashier typed phone, so phone lands in the
      // payload; the typed document pair is ignored on purpose.
      expect(result.was_updated).toBe(true);
      const updateData = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(updateData).toEqual({ phone: '+573109999999' });
    });

    it('does NOT match by document when document_type differs (CC 123 ≠ NIT 123)', async () => {
      // Both lookups return null → falls through to `create()`.
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        document_type: 'NIT',
        document_number: '123',
        first_name: 'Acme',
        last_name: 'SAS',
        person_type: 'JURIDICA',
      } as any);

      expect(result.was_created).toBe(true);
      expect(result.was_updated).toBe(false);
      expect(result.matched_by).toBe(null);
      // create() is invoked with the original storeId.
      expect(mockPrismaService.users.create).toHaveBeenCalledTimes(1);
    });

    it('delegates to create() when nothing matches and returns was_created=true', async () => {
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'nuevo@x.com',
        first_name: 'Nuevo',
        last_name: 'Cliente',
        document_type: 'CC',
        document_number: '88888888',
        person_type: 'NATURAL',
      } as any);

      expect(result.was_created).toBe(true);
      expect(result.was_updated).toBe(false);
      expect(result.matched_by).toBe(null);
      expect(result.customer.id).toBe(42); // from the create() mock
      expect(mockPrismaService.users.create).toHaveBeenCalledTimes(1);
    });

    it('accepts non-canonical document_number on the resolve path (no DocumentNumberMatchesType)', async () => {
      // Regression — the cashier typed `33001521212` (11 digits) for CC,
      // which the strict `@DocumentNumberMatchesType()` on CreateCustomerDto
      // rejected (CC regex is `^\d{6,10}$`). ResolveCustomerDto intentionally
      // skips that decorator so the lookup can still proceed.
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      // 11-digit number that fails CC strict validation but is a valid lookup key.
      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'largo@x.com',
        first_name: 'C',
        last_name: 'L',
        document_type: 'CC',
        document_number: '33001521212',
      } as any);

      expect(result.was_created).toBe(true);
      expect(result.matched_by).toBe(null);
    });
  });
});
