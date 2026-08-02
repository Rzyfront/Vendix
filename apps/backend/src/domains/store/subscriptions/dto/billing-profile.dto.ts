import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TrimString,
  TrimTaxId,
} from '../../../../common/decorators/trim-string.decorator';

/**
 * DIAN document type codes a paying organization can present. Kept as a literal
 * list rather than a free string so a typo cannot reach `CompanyID/@schemeName`,
 * where DIAN rejects it only after the fiscal consecutive is already spent.
 */
export const BILLING_DOCUMENT_TYPES = ['31', '13', '22', '41', '42', '50', '91'];

/** '1' Persona Jurídica / '2' Persona Natural (cbc:AdditionalAccountID). */
export const BILLING_PERSON_TYPES = ['1', '2'];

/** '48' responsable de IVA / '49' no responsable de IVA. */
export const BILLING_TAX_REGIMES = ['48', '49'];

export class BillingAddressDto {
  @TrimString()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address_line1: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(255)
  address_line2?: string;

  @TrimString()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  state_province?: string;

  /**
   * DIAN municipality code (DANE, 5 digits). Without it the UBL builder omits
   * PhysicalLocation and RegistrationAddress entirely, which DIAN rejects for a
   * NIT acquirer — so it is required, not optional.
   */
  @TrimString()
  @IsString()
  @Matches(/^\d{5}$/, {
    message: 'municipality_code must be the 5-digit DANE code',
  })
  municipality_code: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(3)
  country_code?: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(20)
  postal_code?: string;
}

/**
 * Fiscal identity of the organization paying for the subscription. Vendix
 * invoices its own subscriptions electronically, so the paying organization is
 * the *adquiriente* of a DIAN invoice and these are the fields
 * `cac:AccountingCustomerParty` cannot be built without.
 *
 * The NIT's verification digit is deliberately NOT accepted here: it is a
 * checksum, and it is derived server-side from `tax_id`. Asking a human to type
 * it only creates a way to get it wrong.
 */
export class BillingProfileDto {
  /** Razón social exactly as registered with DIAN. */
  @TrimString()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  legal_name: string;

  /** Identification number, digits only (dots and spaces are stripped). */
  @TrimTaxId()
  @IsString()
  @Matches(/^\d{5,15}$/, {
    message: 'tax_id must contain only digits (5-15)',
  })
  tax_id: string;

  @IsIn(BILLING_DOCUMENT_TYPES)
  document_type: string;

  @IsOptional()
  @IsIn(BILLING_PERSON_TYPES)
  person_type?: string;

  @IsOptional()
  @IsIn(BILLING_TAX_REGIMES)
  tax_regime?: string;

  /**
   * DIAN fiscal responsibilities (cbc:TaxLevelCode): O-13, O-15, O-23, O-47,
   * R-99-PN... Free-form because the DIAN annex list changes independently of
   * our releases; the format is validated, the membership is not.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(/^(O-\d{1,3}|R-99-PN)$/, {
    each: true,
    message:
      'each fiscal responsibility must look like O-13, O-47 or R-99-PN',
  })
  fiscal_responsibilities?: string[];

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ValidateNested()
  @Type(() => BillingAddressDto)
  address: BillingAddressDto;
}
