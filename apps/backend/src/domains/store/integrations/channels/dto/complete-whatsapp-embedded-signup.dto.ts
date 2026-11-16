import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const WHATSAPP_SIGNUP_FINISH_EVENTS = [
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_GRANT_ONLY_API_ACCESS',
] as const;

export type WhatsappSignupFinishEvent =
  (typeof WHATSAPP_SIGNUP_FINISH_EVENTS)[number];

export class CompleteWhatsappEmbeddedSignupDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** May be missing when the popup closes before the session event arrives. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  waba_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  phone_number_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  display_phone_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  business_account_id?: string;

  /** Raw FINISH* session event received by the popup, when one arrived. */
  @IsOptional()
  @IsIn(WHATSAPP_SIGNUP_FINISH_EVENTS)
  finish_event?: WhatsappSignupFinishEvent;
}
