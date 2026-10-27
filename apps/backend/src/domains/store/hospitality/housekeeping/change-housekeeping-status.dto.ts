import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { HOUSEKEEPING_TRANSITIONS, HousekeepingStatus } from './housekeeping-status';

const STATUSES = Object.keys(HOUSEKEEPING_TRANSITIONS) as HousekeepingStatus[];

/** H5.1 — `from` is the status the user saw on the board (stale-write guard). */
export class ChangeHousekeepingStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  from: HousekeepingStatus;

  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status: HousekeepingStatus;
}
