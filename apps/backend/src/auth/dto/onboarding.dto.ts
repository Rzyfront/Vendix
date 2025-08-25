import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsUrl,
  IsEnum,
  MinLength,
} from 'class-validator';

export enum OnboardingStep {
  VERIFY_EMAIL = 'verify_email',
  CREATE_ORGANIZATION = 'create_organization',
  SETUP_ORGANIZATION = 'setup_organization',
  CREATE_STORE = 'create_store',
  SETUP_STORE = 'setup_store',
  COMPLETE = 'complete',
}

export class OnboardingStatusDto {
  emailVerified: boolean;
  canCreateOrganization: boolean;
  hasOrganization: boolean;
  organizationId?: number;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  nextStepUrl?: string;
}

export class CreateOrganizationOnboardingDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la organización es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  name: string;

  @IsString()
  @IsOptional()
  legal_name?: string;

  @IsEmail({}, { message: 'Email de organización inválido' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  industry?: string;

  @IsString()
  @IsOptional()
  tax_id?: string;

  @IsString()
  @IsOptional()
  slug?: string;
}

export class SetupOrganizationDto {
  @IsString()
  @IsOptional()
  logo_url?: string;

  @IsString()
  @IsOptional()
  banner_url?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  date_format?: string;

  // Información de dirección
  @IsString()
  @IsOptional()
  address_line1?: string;

  @IsString()
  @IsOptional()
  address_line2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state_province?: string;

  @IsString()
  @IsOptional()
  postal_code?: string;

  @IsString()
  @IsOptional()
  country_code?: string;
}

export class CreateStoreOnboardingDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la tienda es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(['physical', 'online', 'hybrid'], {
    message: 'Tipo de tienda debe ser: physical, online o hybrid',
  })
  @IsOptional()
  store_type?: 'physical' | 'online' | 'hybrid';

  @IsString()
  @IsOptional()
  store_code?: string;

  @IsUrl({}, { message: 'Dominio debe ser una URL válida' })
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  slug?: string;
}

export class SetupStoreDto {
  // Configuraciones de la tienda
  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  language?: string;

  // Configuraciones de inventario
  @IsOptional()
  track_inventory?: boolean;

  @IsOptional()
  allow_backorders?: boolean;

  @IsOptional()
  low_stock_threshold?: number;

  // Configuraciones de envío
  @IsOptional()
  enable_shipping?: boolean;

  @IsOptional()
  free_shipping_threshold?: number;

  // Configuraciones de pagos
  @IsOptional()
  enable_cod?: boolean; // Cash on delivery

  @IsOptional()
  enable_online_payments?: boolean;

  // Información de dirección de la tienda
  @IsString()
  @IsOptional()
  address_line1?: string;

  @IsString()
  @IsOptional()
  address_line2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state_province?: string;

  @IsString()
  @IsOptional()
  postal_code?: string;

  @IsString()
  @IsOptional()
  country_code?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail({}, { message: 'Email de contacto inválido' })
  @IsOptional()
  email?: string;
}
