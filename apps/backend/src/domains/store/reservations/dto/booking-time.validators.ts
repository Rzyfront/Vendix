import { ValidationOptions, ValidateBy, buildMessage } from 'class-validator';
import { isValidCivilDate, isValidTimeRange } from '../booking-time.util';

/**
 * QUI-966 (S4) — DTO decorators backed by the shared booking-time helper so
 * the HTTP layer and the service enforce the exact same rules.
 */

/** Postgres INT4 max: larger ids can never exist and would 500 on query. */
export const MAX_INT4 = 2147483647;

/** Plain `YYYY-MM-DD` that names a real calendar day (no time/offset). */
export function IsCivilDate(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isCivilDate',
      validator: {
        validate: (value: unknown) => isValidCivilDate(value),
        defaultMessage: buildMessage(
          (each) => `${each}$property debe ser una fecha válida AAAA-MM-DD`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

/**
 * Applied on `end_time`: must be strictly after the sibling `start_time`
 * (same day): rejects inverted, zero-length and midnight-crossing ranges.
 */
export function IsAfterStartTime(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isAfterStartTime',
      validator: {
        validate: (value: unknown, args) => {
          const start = (args?.object as { start_time?: unknown })?.start_time;
          return isValidTimeRange(start, value);
        },
        defaultMessage: buildMessage(
          () => 'end_time debe ser posterior a start_time el mismo día',
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
