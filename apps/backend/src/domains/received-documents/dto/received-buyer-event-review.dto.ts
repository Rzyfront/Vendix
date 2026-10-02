import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

const versionValue = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
};
const trimString = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return typeof raw === 'string' ? raw.trim() : raw;
};

export class ReceivedBuyerEventReviewDto {
  @Transform(versionValue)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @IsIn(['test_set', 'convalidated', 'dian_portal'])
  verification_source!: 'test_set' | 'convalidated' | 'dian_portal';

  @Transform(trimString)
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  review_note!: string;
}

export class ReceivedBuyerEventSuspensionDto {
  @Transform(versionValue)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @Transform(trimString)
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  reason!: string;
}
