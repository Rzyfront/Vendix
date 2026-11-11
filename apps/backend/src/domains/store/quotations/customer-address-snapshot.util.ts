import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const CUSTOMER_ADDRESS_FOREIGN_MESSAGE =
  'La ubicación no pertenece a este cliente';

/** Shape persisted in `*_address_snapshot` JSON columns (addresses column names). */
export interface CustomerAddressSnapshot {
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  country_code: string | null;
  postal_code: string | null;
  municipality_code: string | null;
  phone_number: string | null;
}

/** Minimal store-scoped client surface needed to validate a customer location. */
export interface CustomerAddressReader {
  addresses: {
    findFirst: (args: any) => Promise<any>;
  };
}

/**
 * Validates that `addressId` is a location of `customerId` in the current
 * store (the reader MUST be the store-scoped Prisma client) and returns its
 * snapshot. Throws 400 otherwise; never trusts a raw id.
 */
export async function resolveCustomerAddressSnapshot(
  prisma: CustomerAddressReader,
  customerId: number | null | undefined,
  addressId: number,
): Promise<CustomerAddressSnapshot> {
  if (customerId == null) {
    throw new BadRequestException(CUSTOMER_ADDRESS_FOREIGN_MESSAGE);
  }
  const address = await prisma.addresses.findFirst({
    where: { id: addressId, user_id: customerId },
    select: {
      label: true,
      address_line1: true,
      address_line2: true,
      city: true,
      state_province: true,
      country_code: true,
      postal_code: true,
      municipality_code: true,
      phone_number: true,
    },
  });
  if (!address) {
    throw new BadRequestException(CUSTOMER_ADDRESS_FOREIGN_MESSAGE);
  }
  return {
    label: address.label ?? null,
    address_line1: address.address_line1 ?? null,
    address_line2: address.address_line2 ?? null,
    city: address.city ?? null,
    state_province: address.state_province ?? null,
    country_code: address.country_code ?? null,
    postal_code: address.postal_code ?? null,
    municipality_code: address.municipality_code ?? null,
    phone_number: address.phone_number ?? null,
  };
}

export function toAddressSnapshotJson(
  snapshot: CustomerAddressSnapshot,
): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue;
}
