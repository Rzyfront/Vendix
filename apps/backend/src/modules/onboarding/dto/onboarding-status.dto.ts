import { IsBoolean, IsOptional, IsNumber } from 'class-validator';

export class OrganizationOnboardingStatusDto {
  @IsNumber()
  organization_id: number;

  @IsBoolean()
  onboarding_completed: boolean;

  @IsOptional()
  next_step?: string;

  @IsOptional()
  requirements_met?: string[];
}

export class StoreOnboardingStatusDto {
  @IsNumber()
  store_id: number;

  @IsNumber()
  organization_id: number;

  @IsBoolean()
  onboarding_completed: boolean;

  @IsOptional()
  next_step?: string;

  @IsOptional()
  requirements_met?: string[];
}

export class CompleteOrganizationOnboardingDto {
  @IsOptional()
  skip_store_validation?: boolean;
}

export class CompleteStoreOnboardingDto {
  @IsNumber()
  store_id: number;

  @IsOptional()
  force_complete?: boolean;
}
