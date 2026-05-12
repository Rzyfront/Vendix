import { PartialType } from '@nestjs/swagger';

import { CreateOrgSupplierDto } from './create-org-supplier.dto';

/**
 * All fields of `CreateOrgSupplierDto` are optional on update.
 *
 * `store_id` transitions are validated in the service (the new store, when
 * provided, must belong to the caller's organization). Setting `store_id` to
 * `null` re-classifies the supplier as org-shared.
 */
export class UpdateOrgSupplierDto extends PartialType(CreateOrgSupplierDto) {}
