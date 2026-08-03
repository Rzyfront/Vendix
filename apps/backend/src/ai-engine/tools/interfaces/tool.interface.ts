import { AIToolDefinition } from '../../interfaces/ai-provider.interface';

export interface ToolExecutionContext {
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  roles?: string[];
}

export interface RegisteredTool {
  name: string;
  domain: string;
  description: string;
  parameters: Record<string, any>;
  requiredPermissions?: string[];
  requiresConfirmation?: boolean;
  /**
   * Marks the tool as free of side effects. Surfaces that cannot show a
   * confirmation step before executing — realtime voice, where the model acts
   * on a transcription the user never reviews — expose ONLY tools with this
   * set to `true`. The flag is opt-in and fail-closed on purpose: a new tool
   * that forgets it is excluded from those surfaces rather than silently
   * reachable.
   */
  readOnly?: boolean;
  handler: (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ) => Promise<string>;
}

export interface ToolRegistrationFn {
  (registry: any, prisma: any): void;
}
