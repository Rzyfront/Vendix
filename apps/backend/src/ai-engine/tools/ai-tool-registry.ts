import { Injectable, Logger } from '@nestjs/common';
import { AIToolDefinition } from '../interfaces/ai-provider.interface';
import {
  RegisteredTool,
  ToolExecutionContext,
} from './interfaces/tool.interface';
import { VendixHttpException, ErrorCodes } from '../../common/errors';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class AIToolRegistry {
  private readonly logger = new Logger(AIToolRegistry.name);
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" is being overwritten`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name} (${tool.domain})`);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getToolsForDomain(domain: string): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.domain === domain)
      .map((t) => this.toDefinition(t));
  }

  getAllDefinitions(): AIToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => this.toDefinition(t));
  }

  getAvailableDefinitions(userPermissions?: string[]): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => this.isPermitted(t, userPermissions))
      .map((t) => this.toDefinition(t));
  }

  /**
   * Permission-filtered catalog restricted to side-effect-free tools.
   * Used by surfaces that execute without a confirmation step (realtime
   * voice). Fail-closed: a tool that does not declare `readOnly: true` is
   * excluded even if the user holds every permission it requires.
   */
  getReadOnlyDefinitions(userPermissions?: string[]): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.readOnly === true && this.isPermitted(t, userPermissions))
      .map((t) => this.toDefinition(t));
  }

  isReadOnly(name: string): boolean {
    return this.tools.get(name)?.readOnly === true;
  }

  private isPermitted(
    tool: RegisteredTool,
    userPermissions?: string[],
  ): boolean {
    if (!tool.requiredPermissions?.length) return true;
    if (!userPermissions) return false;
    return tool.requiredPermissions.every((p) => userPermissions.includes(p));
  }

  async executeTool(name: string, args: Record<string, any>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `Tool "${name}" not found`,
      );
    }

    const requestContext = RequestContextService.getContext();
    const context: ToolExecutionContext = {
      organization_id: requestContext?.organization_id,
      store_id: requestContext?.store_id,
      user_id: requestContext?.user_id,
      roles: requestContext?.roles,
    };

    // Check permissions — use granular permissions if available, fall back to roles
    if (tool.requiredPermissions?.length) {
      // `[]` is truthy, so `permissions || roles` never reaches the fallback
      // for a user whose permission list resolved empty. Check length.
      const granted = requestContext?.permissions;
      const userPermissions = granted?.length ? granted : (context.roles ?? []);
      const hasPermission = tool.requiredPermissions.every((p) =>
        userPermissions.includes(p),
      );
      if (!hasPermission) {
        throw new VendixHttpException(
          ErrorCodes.AI_AGENT_004,
          `Insufficient permissions for tool "${name}"`,
        );
      }
    }

    try {
      this.logger.log(
        `Executing tool: ${name} with args: ${JSON.stringify(args).substring(0, 200)}`,
      );
      const result = await tool.handler(args, context);
      return result;
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;
      this.logger.error(`Tool "${name}" execution failed: ${error.message}`);
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `Tool "${name}" failed: ${error.message}`,
      );
    }
  }

  private toDefinition(tool: RegisteredTool): AIToolDefinition {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}
