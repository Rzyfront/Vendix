import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { LocationTenantValidator } from './location-tenant-validator.helper';

type LocationRow = {
  id: number;
  organization_id: number;
  store_id: number | null;
  is_active: boolean;
};

describe('LocationTenantValidator', () => {
  let validator: LocationTenantValidator;
  let findUnique: jest.Mock;

  const makeLocation = (overrides: Partial<LocationRow> = {}): LocationRow => ({
    id: 10,
    organization_id: 1,
    store_id: 5,
    is_active: true,
    ...overrides,
  });

  beforeEach(async () => {
    findUnique = jest.fn();
    const mockPrisma = {
      _baseClient: {
        inventory_locations: { findUnique },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationTenantValidator,
        { provide: OrganizationPrismaService, useValue: mockPrisma },
      ],
    }).compile();

    validator = module.get(LocationTenantValidator);
  });

  describe('input guards', () => {
    it('rejects locationId = 0 with INV_LOC_001', async () => {
      await expect(
        validator.validate(0, { organization_id: 1, store_id: 5 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_LOC_001.code,
      });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('rejects negative locationId with INV_LOC_001', async () => {
      await expect(
        validator.validate(-1, { organization_id: 1, store_id: 5 }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('rejects missing organization_id with INV_CONTEXT_001', async () => {
      await expect(
        validator.validate(10, { organization_id: 0 as any, store_id: 5 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_CONTEXT_001.code,
      });
    });
  });

  describe('lookup', () => {
    it('throws INV_LOC_001 when location does not exist', async () => {
      findUnique.mockResolvedValue(null);
      await expect(
        validator.validate(99, { organization_id: 1, store_id: 5 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_LOC_001.code,
      });
    });
  });

  describe('organization containment', () => {
    it('throws INV_LOCATION_NOT_IN_ORG when org mismatches', async () => {
      findUnique.mockResolvedValue(makeLocation({ organization_id: 999 }));
      await expect(
        validator.validate(10, { organization_id: 1, store_id: 5 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_LOCATION_NOT_IN_ORG.code,
      });
    });
  });

  describe('store containment (independent mode)', () => {
    it('throws INV_LOCATION_NOT_IN_STORE when location belongs to another store', async () => {
      findUnique.mockResolvedValue(makeLocation({ store_id: 99 }));
      await expect(
        validator.validate(10, {
          organization_id: 1,
          store_id: 5,
          inventory_mode: 'independent',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_LOCATION_NOT_IN_STORE.code,
      });
    });

    it('accepts same-store location', async () => {
      findUnique.mockResolvedValue(makeLocation({ store_id: 5 }));
      const result = await validator.validate(10, {
        organization_id: 1,
        store_id: 5,
        inventory_mode: 'independent',
      });
      expect(result.id).toBe(10);
    });
  });

  describe('store containment (organizational mode)', () => {
    it('allows cross-store location by default when mode is organizational', async () => {
      findUnique.mockResolvedValue(makeLocation({ store_id: 99 }));
      const result = await validator.validate(10, {
        organization_id: 1,
        store_id: 5,
        inventory_mode: 'organizational',
      });
      expect(result.store_id).toBe(99);
    });

    it('blocks cross-store when enforceInventoryMode=false + allowCrossStore=false', async () => {
      findUnique.mockResolvedValue(makeLocation({ store_id: 99 }));
      await expect(
        validator.validate(
          10,
          { organization_id: 1, store_id: 5, inventory_mode: 'organizational' },
          { enforceInventoryMode: false },
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_LOCATION_NOT_IN_STORE.code,
      });
    });

    it('allows cross-store via explicit allowCrossStore=true', async () => {
      findUnique.mockResolvedValue(makeLocation({ store_id: 99 }));
      const result = await validator.validate(
        10,
        { organization_id: 1, store_id: 5, inventory_mode: 'independent' },
        { allowCrossStore: true },
      );
      expect(result.store_id).toBe(99);
    });
  });

  describe('active flag', () => {
    it('throws INV_VALIDATE_001 on inactive location by default', async () => {
      findUnique.mockResolvedValue(makeLocation({ is_active: false }));
      await expect(
        validator.validate(10, { organization_id: 1, store_id: 5 }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_VALIDATE_001.code,
      });
    });

    it('accepts inactive location when requireActive=false', async () => {
      findUnique.mockResolvedValue(makeLocation({ is_active: false }));
      const result = await validator.validate(
        10,
        { organization_id: 1, store_id: 5 },
        { requireActive: false },
      );
      expect(result.is_active).toBe(false);
    });
  });

  describe('tx override', () => {
    it('uses tx._baseClient when provided', async () => {
      const txFindUnique = jest.fn().mockResolvedValue(makeLocation());
      const tx: any = {
        _baseClient: { inventory_locations: { findUnique: txFindUnique } },
      };
      await validator.validate(10, { organization_id: 1, store_id: 5 }, {}, tx);
      expect(txFindUnique).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('falls back to tx directly when no _baseClient', async () => {
      const txFindUnique = jest.fn().mockResolvedValue(makeLocation());
      const tx: any = {
        inventory_locations: { findUnique: txFindUnique },
      };
      await validator.validate(10, { organization_id: 1, store_id: 5 }, {}, tx);
      expect(txFindUnique).toHaveBeenCalled();
    });
  });
});
