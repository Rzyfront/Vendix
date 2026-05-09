import { PartialType } from '@nestjs/mapped-types';
import { CreateOrgLocationDto } from './create-org-location.dto';

/**
 * Partial of {@link CreateOrgLocationDto}. Service layer applies the same
 * business rules as create (central warehouse vs store_id, single central per
 * organization) using the merged shape (existing row + dto).
 */
export class UpdateOrgLocationDto extends PartialType(CreateOrgLocationDto) {}
