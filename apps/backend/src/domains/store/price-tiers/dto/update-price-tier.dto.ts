import { PartialType } from '@nestjs/mapped-types';
import { CreatePriceTierDto } from './create-price-tier.dto';

export class UpdatePriceTierDto extends PartialType(CreatePriceTierDto) {}
