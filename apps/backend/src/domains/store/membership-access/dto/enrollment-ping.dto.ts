import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for `POST /store/memberships/access/enrollment-ping`.
 *
 * The biometric device (or a stub integration) calls this endpoint when it
 * reads a raw fingerprint template. The backend just fans out an `enrollment`
 * SSE event to current subscribers so a credential-creation modal can capture
 * the `external_ref` in real time.
 *
 * NO validation against existing credentials — this is enrollment, not
 * verification. The caller (modal) decides which member/credential receives
 * the captured fingerprint later.
 */
export class EnrollmentPingDto {
  @IsString()
  @MaxLength(255)
  external_ref!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_id?: string;
}
