import { IsString, IsOptional, IsEmail, IsNotEmpty } from 'class-validator';

export class SubmitInvoiceDataDto {
  @IsNotEmpty()
  @IsString()
  first_name: string;

  @IsNotEmpty()
  @IsString()
  last_name: string;

  @IsNotEmpty()
  @IsString()
  document_type: string;

  @IsNotEmpty()
  @IsString()
  document_number: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
