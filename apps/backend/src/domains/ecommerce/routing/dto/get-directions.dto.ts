import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Query DTO for `GET /ecommerce/routing/directions`.
 *
 * `coords` carries the route waypoints in OSRM-native format:
 * `<lng>,<lat>;<lng>,<lat>;...` — longitude FIRST, then latitude (comma
 * separated), each point separated by a semicolon. Minimum 2 points
 * (origin → stops); the order is significant.
 *
 * The `@Matches` regex enforces the shape AND the ≥2-point minimum: the base
 * `<lng>,<lat>` group must be followed by at least one more `;<lng>,<lat>`
 * group. Coordinate RANGES are re-validated in the service as defense-in-depth
 * (a single regex cannot cheaply bound each number to [-180,180]/[-90,90]).
 * `@MaxLength` keeps abusive/huge waypoint lists off the public OSRM demo.
 */
export class GetDirectionsDto {
  @IsString({ message: 'coords must be a string' })
  @MaxLength(2000, { message: 'coords must be at most 2000 characters' })
  @Matches(
    /^-?\d+(\.\d+)?,-?\d+(\.\d+)?(;-?\d+(\.\d+)?,-?\d+(\.\d+)?)+$/,
    {
      message:
        'coords must be "<lng>,<lat>;<lng>,<lat>;..." with at least 2 points',
    },
  )
  coords!: string;
}
