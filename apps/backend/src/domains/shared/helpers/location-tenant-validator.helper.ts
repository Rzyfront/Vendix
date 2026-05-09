import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

export type LocationTenantContext = {
  organization_id: number;
  store_id: number | null;
  inventory_mode?: 'independent' | 'organizational';
};

export type LocationTenantOptions = {
  enforceInventoryMode?: boolean;
  allowCrossStore?: boolean;
  requireActive?: boolean;
};

export type ValidatedLocation = {
  id: number;
  organization_id: number;
  store_id: number | null;
  is_active: boolean;
};

type LocationFinder = {
  inventory_locations: {
    findUnique: (args: { where: { id: number } }) => Promise<ValidatedLocation | null>;
  };
};

type TxLike = LocationFinder | { _baseClient: LocationFinder };

@Injectable()
export class LocationTenantValidator {
  constructor(private readonly prisma: OrganizationPrismaService) {}

  async validate(
    locationId: number,
    context: LocationTenantContext,
    options: LocationTenantOptions = {},
    tx?: TxLike,
  ): Promise<ValidatedLocation> {
    if (!locationId || locationId <= 0) {
      throw new VendixHttpException(
        ErrorCodes.INV_LOC_001,
        `Invalid location id: ${locationId}`,
      );
    }
    if (!context.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.INV_CONTEXT_001,
        'Missing organization context',
      );
    }

    const client = this.resolveClient(tx);
    const location = await client.inventory_locations.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new VendixHttpException(
        ErrorCodes.INV_LOC_001,
        `Location ${locationId} not found`,
      );
    }

    if (location.organization_id !== context.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.INV_LOCATION_NOT_IN_ORG,
        `Location ${locationId} does not belong to organization ${context.organization_id}`,
      );
    }

    const respectMode = options.enforceInventoryMode ?? true;
    const explicitAllow = options.allowCrossStore ?? false;
    const shouldEnforceStoreMatch =
      !explicitAllow &&
      (respectMode ? context.inventory_mode === 'independent' : true);

    if (shouldEnforceStoreMatch && location.store_id !== context.store_id) {
      throw new VendixHttpException(
        ErrorCodes.INV_LOCATION_NOT_IN_STORE,
        `Location ${locationId} does not belong to store ${context.store_id ?? 'null'}`,
      );
    }

    const requireActive = options.requireActive ?? true;
    if (requireActive && !location.is_active) {
      throw new VendixHttpException(
        ErrorCodes.INV_VALIDATE_001,
        `Location ${locationId} is not active`,
      );
    }

    return location;
  }

  private resolveClient(tx?: TxLike): LocationFinder {
    if (tx) {
      const wrapped = (tx as { _baseClient?: LocationFinder })._baseClient;
      if (wrapped) return wrapped;
      return tx as LocationFinder;
    }
    const fromMock = (this.prisma as unknown as { _baseClient?: LocationFinder })._baseClient;
    if (fromMock) return fromMock;
    return (this.prisma as unknown as { baseClient: LocationFinder }).baseClient;
  }
}
