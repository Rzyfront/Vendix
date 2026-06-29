import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for editing an existing PQR comment.
 *
 * Mirrors the validation rules of AddPqrCommentDto so the
 * ValidationPipe runs the same checks on edit as on create:
 * - required string body
 * - 2-5000 chars (matches the editor limits in the admin UI)
 *
 * NOTE: An inline `@Body() dto: { content: string }` would NOT be
 * validated by NestJS's global ValidationPipe because inline object
 * types aren't class-validator aware — that's why this DTO exists.
 */
export class EditPqrCommentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(5000)
  content!: string;
}