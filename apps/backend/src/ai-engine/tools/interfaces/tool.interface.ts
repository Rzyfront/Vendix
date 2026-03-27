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
  handler: (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ) => Promise<string>;
}

export interface ToolRegistrationFn {
  (registry: any, prisma: any): void;
}
