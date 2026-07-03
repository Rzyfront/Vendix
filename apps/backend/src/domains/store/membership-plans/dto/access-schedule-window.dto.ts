import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

/**
 * A single access-schedule window for a membership plan. Mirrors the shape of
 * `menu_availability_windows` so the access-control path can reuse the exact
 * same timezone math (`MenuAvailabilityCheckerService`):
 *
 *   { day_of_week: 0..6 (0=Sunday), start_time: "HH:mm", end_time: "HH:mm" }
 *
 * Windows live INSIDE the plan's `features` Json blob under `access_schedule`
 * (an array). There is NO dedicated column and NO migration — any industry can
 * carry its own opening hours. An empty/absent array means "no restriction".
 */
export class AccessScheduleWindowDto {
  /** 0=Sunday … 6=Saturday (matches menu_availability_windows.day_of_week). */
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  /** Inclusive start, 24h "HH:mm". */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener el formato HH:mm (24h)',
  })
  start_time!: string;

  /** Inclusive end, 24h "HH:mm". */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener el formato HH:mm (24h)',
  })
  end_time!: string;
}
