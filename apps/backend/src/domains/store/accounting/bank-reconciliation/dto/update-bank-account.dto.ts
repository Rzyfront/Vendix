import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateBankAccountDto } from './create-bank-account.dto';
import { ColumnMappingConfig } from '../parsers/interfaces/parsed-transaction.interface';

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  column_mapping?: ColumnMappingConfig;
}
