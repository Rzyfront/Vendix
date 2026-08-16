import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  IsDateString,
  IsInt,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * Hydration filter for server-search selectors.
   *
   * A selector that only loads the first N accounts still has to render the
   * account already stored in the form (edit mode). Resolving it through
   * `GET /chart-of-accounts/:id` is not viable during the fiscal wizard —
   * that route is behind `ModuleFlowGuard` while the accounting module is
   * still WIP, whereas `GET /chart-of-accounts` is `@SkipModuleFlowGuard()`.
   * So the list endpoint accepts `?ids=1,2,3` and resolves the whole batch of
   * preselected accounts in a single request instead of N per-id calls.
   */
  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isInteger(v) && v > 0),
  )
  @IsInt({ each: true })
  @ArrayMaxSize(500)
  ids?: number[];

  /**
   * Narrows an organization-level read to one store.
   *
   * Only `OrgChartOfAccountsController` acts on it (via its own
   * `@Query('store_id')` param) — the store controller ignores it, because
   * `StorePrismaService` already scopes to the active store. It is declared
   * here because the global `ValidationPipe` runs with
   * `forbidNonWhitelisted: true`: without the property, every
   * `GET /organization/accounting/chart-of-accounts?store_id=N` the fiscal
   * wizard issues is rejected with 400 before reaching the handler.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  parent_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  level?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  accepts_entries?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  tree?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;
}
