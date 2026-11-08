import { IsObject, IsOptional } from 'class-validator';

/** `PUT definitions/:id/access`. `access: null` (or `{}`) opens the flow again. */
export class UpdateWorkflowAccessDto {
  @IsOptional() @IsObject() access?: Record<string, unknown> | null;
}
