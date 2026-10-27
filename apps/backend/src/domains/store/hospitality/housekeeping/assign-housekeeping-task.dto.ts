import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

/** H5.2 — `assigned_user_id: null` leaves the task unassigned. */
export class AssignHousekeepingTaskDto {
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @IsPositive()
  assigned_user_id: number | null;
}
