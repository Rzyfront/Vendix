import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { location_type_enum } from '@prisma/client';
import { CreateAddressDto } from '../../../addresses/dto/index';

/**
 * Org-level inventory location create payload (Plan P2.1).
 *
 * Mirrors the store-side {@link CreateLocationDto} but exposes the central
 * warehouse flag and explicit `store_id` so ORG_ADMIN can manage both
 * organization-shared (`store_id = null`) and per-store locations from the
 * organization scope.
 *
 * Business rules enforced in {@link OrgLocationsService.create}:
 *   - `is_central_warehouse` must NOT be combined with a `store_id`
 *     (DB CHECK `inventory_locations_central_no_store_chk`).
 *   - At most one central warehouse per organization
 *     (DB partial unique `inventory_locations_one_central_per_org`).
 *   - When `store_id` is provided it must belong to the current organization.
 */
export class CreateOrgLocationDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsEnum(location_type_enum)
  type?: location_type_enum;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_central_warehouse?: boolean;

  /**
   * When omitted (or explicitly `null`), the location is organization-shared
   * (no specific store). Required to be `null` when `is_central_warehouse` is
   * `true`.
   */
  @IsOptional()
  @IsInt()
  store_id?: number | null;

  @IsOptional()
  @IsInt()
  address_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address?: CreateAddressDto;
}
