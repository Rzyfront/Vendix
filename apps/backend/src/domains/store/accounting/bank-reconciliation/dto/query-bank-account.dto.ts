import { IsOptional, IsString } from 'class-validator';

export class QueryBankAccountDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  // store_id deprecated (phase3-round2): scope is derived from RequestContextService
  // (StorePrismaService auto-scopes) for /store/* endpoints.
}
