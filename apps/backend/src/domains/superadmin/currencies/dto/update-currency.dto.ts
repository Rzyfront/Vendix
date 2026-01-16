import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateCurrencyDto } from './create-currency.dto';

export class UpdateCurrencyDto extends PartialType(
  OmitType(CreateCurrencyDto, ['code'] as const),
) {}
