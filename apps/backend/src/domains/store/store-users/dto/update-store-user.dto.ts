import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateStoreUserDto } from './create-store-user.dto';

export class UpdateStoreUserDto extends PartialType(
  OmitType(CreateStoreUserDto, ['password'] as const),
) {}
