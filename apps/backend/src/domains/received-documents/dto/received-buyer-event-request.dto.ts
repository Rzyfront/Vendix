import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const RECEIVED_BUYER_EVENT_CODES = ['030', '031', '032', '033'] as const;

function transformStrictInteger({ obj, key }: { obj: Record<string, unknown>; key: string }): number | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : Number.NaN;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return Number.NaN;
}

export class ReceivedBuyerEventReadinessParamsDto {
  @IsIn(RECEIVED_BUYER_EVENT_CODES)
  eventCode!: (typeof RECEIVED_BUYER_EVENT_CODES)[number];
}

export class ReceivedBuyerEventRequestDto {
  @Transform(transformStrictInteger)
  @IsInt()
  @Min(0)
  expected_version!: number;

  @Transform(transformStrictInteger)
  @IsInt()
  @Min(1)
  dian_configuration_id!: number;

  @Transform(transformStrictInteger)
  @IsInt()
  @Min(1)
  evidence_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(RECEIVED_BUYER_EVENT_CODES, { each: true })
  event_codes!: Array<(typeof RECEIVED_BUYER_EVENT_CODES)[number]>;
}

export class ReceivedBuyerEventOptionsQueryDto {
  @Transform(transformStrictInteger)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(transformStrictInteger)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Transform(transformStrictInteger)
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number;
}
