import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of `POST /store/workflows/instances/:id/files` (the file goes in `file`). */
export class UploadWorkflowFileDto {
  @IsOptional() @IsString() @MaxLength(80) requirement_key?: string;
  @IsOptional() @IsString() @MaxLength(80) field_key?: string;
}
