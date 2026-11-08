import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST store/workflows/definitions/:id/ai-step-test`. */
export class WorkflowAiStepTestDto {
  @IsString() @MinLength(1) @MaxLength(80)
  stage_key!: string;

  /** Sample values of the step's inputs. */
  @IsObject()
  data!: Record<string, unknown>;
}
