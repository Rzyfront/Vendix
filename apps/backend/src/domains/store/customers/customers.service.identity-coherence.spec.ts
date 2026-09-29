import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ErrorCodes } from '../../../common/errors';
import * as bcrypt from 'bcrypt';

/**
 * Agente D — Task 1 (coherencia persona/documento) + Task 2 (completar la
 * ficha fiscal en el resolve de POS/orden).
 *
 * Incidente que origina la regla: un cliente NIT (persona jurídica) fue
 * facturado como persona natural con cédula. `assertPersonaDocumentCoherence`
 * (customers.service.ts) rechaza esa mezcla con `CUST_VALIDATE_001` en
 * `create()`/`update()`, e infiere `person_type='JURIDICA'` cuando llega un
 * NIT sin nombre de persona natural — nunca al revés (el `person_type`
 * explícito del payload siempre gana).
 */
describe('CustomersService — Task 1 identidad persona/documento + Task 2 completar ficha', () => {
  let service: CustomersService;

  const mockPrismaService = {
    stores: { findUnique: jest.fn() },
    users: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    store_users: { upsert: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => {
      const results: unknown[] = [];
      for (const op of ops) results.push(await (op as Promise<unknown>));
      return results;
    }),
    roles: { findFirst: jest.fn() },
    orders: { groupBy: jest.fn() },
  };

  const mockEventEmitter = { emit: jest.fn() };
  const mockStore = { id: 1, organization_id: 100, name: 'Test store' };
  const mockCustomerRole = { id: 5, name: 'customer' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);

    jest.clearAllMocks();

    mockPrismaService.stores.findUnique.mockResolvedValue(mockStore);
    mockPrismaService.users.findFirst.mockResolvedValue(null);
    mockPrismaService.roles.findFirst.mockResolvedValue(mockCustomerRole);
    mockPrismaService.orders.groupBy.mockResolvedValue([]);
    mockPrismaService.users.create.mockImplementation(async ({ data }) => ({
      id: 42,
      ...data,
      user_roles: [],
      store_users: [],
    }));
    mockPrismaService.users.update.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      ...data,
    }));

    jest
      .spyOn(bcrypt, 'hash')
      .mockResolvedValue('$2b$12$deterministicMockedHashForCustomerTests' as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------------
  // Task 1 — create()
  // ---------------------------------------------------------------------
  describe('create() — coherencia persona/documento', () => {
    it('rechaza JURIDICA + documento de persona natural con CUST_VALIDATE_001', async () => {
      await expect(
        service.create(1, {
          first_name: 'Ana',
          last_name: 'Pérez',
          document_type: 'CC',
          document_number: '12345678',
          person_type: 'JURIDICA',
        } as any),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.CUST_VALIDATE_001.code });

      expect(mockPrismaService.users.create).not.toHaveBeenCalled();
    });

    it('infiere JURIDICA cuando llega NIT sin person_type y sin nombre de persona natural', async () => {
      await service.create(1, {
        first_name: '',
        last_name: '',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        // person_type NO viene en el payload.
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.person_type).toBe('JURIDICA');
      expect(data.first_name).toBe('');
      expect(data.last_name).toBe('');
    });

    it('NO infiere JURIDICA cuando el NIT llega acompañado de un nombre de persona natural', async () => {
      // Caso ambiguo (dato sucio real): NIT con nombre propio y sin
      // person_type explícito. La regla sólo infiere cuando NO hay nombre;
      // aquí debe dejar person_type sin escribir en vez de adivinar.
      await service.create(1, {
        first_name: 'Juan',
        last_name: 'Pérez',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.person_type).toBeUndefined();
    });

    it('el person_type explícito del payload siempre gana sobre la inferencia', async () => {
      await service.create(1, {
        first_name: '',
        last_name: '',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        person_type: 'JURIDICA',
      } as any);

      const data = mockPrismaService.users.create.mock.calls[0][0].data;
      expect(data.person_type).toBe('JURIDICA');
    });
  });

  // ---------------------------------------------------------------------
  // Task 1 — update()
  // ---------------------------------------------------------------------
  describe('update() — coherencia persona/documento (gateada por lo que la petición realmente toca)', () => {
    const CUSTOMER_ID = 55;

    const makeExistingUser = (overrides: any = {}) => ({
      id: CUSTOMER_ID,
      organization_id: 100,
      first_name: 'Juan',
      last_name: 'Pérez',
      person_type: 'NATURAL',
      document_type: 'CC',
      document_number: '111',
      verification_digit: null,
      tax_regime: null,
      legal_name: null,
      fiscal_responsibilities: [],
      state: 'active',
      addresses: [],
      ...overrides,
    });

    it('rechaza person_type=JURIDICA explícito contra un documento CC sin cambiar (CUST_VALIDATE_001)', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce(
        makeExistingUser(),
      );

      await expect(
        service.update(1, CUSTOMER_ID, {
          person_type: 'JURIDICA',
        } as any),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.CUST_VALIDATE_001.code });

      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('infiere JURIDICA cuando ESTA petición cambia el documento a NIT y no queda nombre de persona natural', async () => {
      mockPrismaService.users.findFirst
        .mockResolvedValueOnce(makeExistingUser())
        .mockResolvedValueOnce(null); // findByDocumentInOrganization: sin conflicto

      await service.update(1, CUSTOMER_ID, {
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        first_name: '',
        last_name: '',
        legal_name: 'Acme S.A.S',
      } as any);

      const data = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(data.person_type).toBe('JURIDICA');
      expect(data.first_name).toBe('');
      expect(data.last_name).toBe('');
    });

    it('NO infiere JURIDICA cuando cambia a NIT pero el nombre de persona natural existente se mantiene', async () => {
      mockPrismaService.users.findFirst
        .mockResolvedValueOnce(makeExistingUser()) // first_name/last_name = Juan Pérez
        .mockResolvedValueOnce(null);

      await service.update(1, CUSTOMER_ID, {
        document_type: 'NIT',
        document_number: '900000008',
        verification_digit: '3',
        // sin first_name/last_name en el payload: el nombre existente
        // ('Juan Pérez') sigue vigente ⇒ no se infiere jurídica.
      } as any);

      const data = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(data.person_type).toBeUndefined();
    });

    it('un PATCH ajeno (teléfono) NO se bloquea por una incoherencia YA existente que nadie está tocando', async () => {
      // Dato heredado sucio: person_type='JURIDICA' con document_type='CC'.
      // La petición actual sólo toca `phone`; no debe fallar retroactivamente.
      mockPrismaService.users.findFirst.mockResolvedValueOnce(
        makeExistingUser({ person_type: 'JURIDICA', document_type: 'CC' }),
      );

      await service.update(1, CUSTOMER_ID, {
        phone: '3001234567',
      } as any);

      expect(mockPrismaService.users.update).toHaveBeenCalledTimes(1);
      const data = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(data.phone).toBe('3001234567');
    });
  });

  // ---------------------------------------------------------------------
  // Task 2 — buildUpdatePayload / findOrCreateByEmailOrDocument: completar
  // ficha (fill-if-blank), nunca sobreescribir, y el candado de seguridad
  // que evita recrear la incoherencia del Task 1 desde una completación.
  // ---------------------------------------------------------------------
  describe('findOrCreateByEmailOrDocument — Task 2 completar ficha fiscal', () => {
    const existingBlankFicha = {
      id: 7,
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: null,
      document_type: 'NIT',
      document_number: '900000008',
      person_type: null,
      legal_name: null,
      verification_digit: null,
      tax_regime: null,
      fiscal_responsibilities: [],
      email: 'juan@x.com',
      state: 'active',
      user_roles: [],
      store_users: [{ store_id: 1 }],
      addresses: [],
    };

    beforeEach(() => {
      mockPrismaService.users.findFirst.mockResolvedValue(null);
    });

    it('rellena person_type/legal_name/verification_digit/tax_regime/fiscal_responsibilities cuando están en blanco', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce(
        existingBlankFicha,
      );

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
        person_type: 'JURIDICA',
        legal_name: 'Acme S.A.S',
        verification_digit: '3',
        tax_regime: 'COMUN',
        fiscal_responsibilities: ['O-13'],
      } as any);

      expect(result.was_updated).toBe(true);
      const updateData = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(updateData).toEqual({
        person_type: 'JURIDICA',
        legal_name: 'Acme S.A.S',
        verification_digit: '3',
        tax_regime: 'COMUN',
        fiscal_responsibilities: ['O-13'],
      });
    });

    it('NUNCA sobreescribe un valor ya guardado y distinto (fill-if-blank, no fill-if-different)', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce({
        ...existingBlankFicha,
        person_type: 'JURIDICA',
        legal_name: 'Acme S.A.S',
        tax_regime: 'COMUN',
      });

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
        person_type: 'NATURAL',
        legal_name: 'Otra Razón Social',
        tax_regime: 'SIMPLIFICADO',
      } as any);

      expect(result.was_updated).toBe(false);
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('candado de seguridad: no completa person_type=JURIDICA sobre un documento efectivo que no es NIT', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce({
        ...existingBlankFicha,
        document_type: 'CC', // documento efectivo no-NIT
        document_number: '12345678',
      });

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
        person_type: 'JURIDICA', // se descarta en silencio, no bloquea
        verification_digit: '3', // idem: DV sólo aplica a NIT
        tax_regime: 'COMUN', // esta sí se completa (no depende del tipo doc)
      } as any);

      expect(result.was_updated).toBe(true);
      const updateData = mockPrismaService.users.update.mock.calls[0][0].data;
      expect(updateData).toEqual({ tax_regime: 'COMUN' });
      expect(updateData.person_type).toBeUndefined();
      expect(updateData.verification_digit).toBeUndefined();
    });

    it('sin nada útil que completar (payload vacío de ficha) no dispara ninguna escritura', async () => {
      mockPrismaService.users.findFirst.mockResolvedValueOnce(
        existingBlankFicha,
      );

      const result = await service.findOrCreateByEmailOrDocument(1, {
        email: 'juan@x.com',
      } as any);

      expect(result.was_updated).toBe(false);
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });
  });
});
