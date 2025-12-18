import { IsOptional, IsEnum, IsDateString } from 'class-validator';

export enum DashboardPeriod {
  SIX_MONTHS = '6m',
  ONE_YEAR = '1y',
  ALL = 'all',
}

export class OrganizationDashboardDto {
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod;
}
