import { PartialType } from '@nestjs/swagger';
import { CreateReturnOrderDto } from './create-return-order.dto';

export class UpdateReturnOrderDto extends PartialType(CreateReturnOrderDto) {}
