import { PartialType } from '@nestjs/swagger';
import { CreateInventorySupplierDto } from './create-supplier.dto';

export class UpdateSupplierDto extends PartialType(
  CreateInventorySupplierDto,
) {}
