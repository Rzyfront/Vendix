import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** `month` is validated by the service so a bad value maps to its own error code. */
export class WorkflowAiUsageQueryDto {
  @IsOptional() @IsString() @MaxLength(7) month?: string;
}

export class WorkflowInsightsListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(52) limit?: number = 12;
}
