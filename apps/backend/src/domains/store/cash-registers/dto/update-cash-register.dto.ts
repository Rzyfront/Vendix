import { PartialType } from '@nestjs/mapped-types';
import { CreateCashRegisterDto } from './create-cash-register.dto';

export class UpdateCashRegisterDto extends PartialType(CreateCashRegisterDto) {}
