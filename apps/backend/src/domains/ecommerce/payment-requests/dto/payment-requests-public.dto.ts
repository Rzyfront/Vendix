import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

/** Multipart text fields of `POST :token/transfer` (the file travels as `file`). */
export class SubmitTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  method_id?: number;
}

export class StartWompiDto {
  /** Where Wompi sends the customer after paying (the payment page itself). */
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(500)
  return_url?: string;
}
