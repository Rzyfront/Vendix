import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/** Body of `POST /store/workflows/connectors/whatsapp/test`. */
/** Fields are required only for WhatsApp; the service enforces it (email and DIAN send no body). */
export class TestWhatsappConnectorDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  template?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/, { message: 'language must be like es or es_CO' })
  language?: string;

  /** Positional variables separated by `|`, as in the action. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  params?: string;
}
