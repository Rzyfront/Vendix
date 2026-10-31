import { IsBoolean, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReissueServiceSessionLinkDto {
  @IsBoolean()
  identity_verified: boolean;

  @IsString()
  @IsIn(['in_person', 'phone_callback', 'known_customer'])
  verification_method: 'in_person' | 'phone_callback' | 'known_customer';

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  verification_note: string;

  @IsUUID()
  idempotency_key: string;
}