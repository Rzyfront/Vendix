import { IsString, IsEnum, IsOptional, IsDateString, IsUrl, MaxLength } from 'class-validator';

export enum LegalDocumentTypeEnum {
  TERMS_OF_SERVICE = 'TERMS_OF_SERVICE',
  PRIVACY_POLICY = 'PRIVACY_POLICY',
  REFUND_POLICY = 'REFUND_POLICY',
  SHIPPING_POLICY = 'SHIPPING_POLICY',
  RETURN_POLICY = 'RETURN_POLICY',
  COOKIES_POLICY = 'COOKIES_POLICY',
  MERCHANT_AGREEMENT = 'MERCHANT_AGREEMENT',
}

export class CreateSystemDocumentDto {
  @IsEnum(LegalDocumentTypeEnum)
  document_type: LegalDocumentTypeEnum;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @MaxLength(20)
  version: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  effective_date: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

  @IsOptional()
  @IsUrl()
  document_url?: string;
}
