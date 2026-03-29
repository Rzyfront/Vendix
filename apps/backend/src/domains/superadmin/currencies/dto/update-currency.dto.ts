import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateCurrencyDto } from './create-currency.dto';

export class UpdateCurrencyDto extends PartialType(
  OmitType(CreateCurrencyDto, ['code', 'name', 'symbol'] as const),
) {}  // decimal_places, position, format_style y state son editables
