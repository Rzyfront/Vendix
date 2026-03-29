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
      .filter((t) => {
        if (!t.requiredPermissions?.length) return true;
        if (!userPermissions) return false;
        return t.requiredPermissions.every((p) => userPermissions.includes(p));
      })
      .map((t) => this.toDefinition(t));
  }

  async executeTool(
    name: string,
    args: Record<string, any>,
  ): Promise<string> {
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

    // Check permissions
    if (tool.requiredPermissions?.length) {
      const userRoles = context.roles || [];
      const hasPermission = tool.requiredPermissions.every((p) =>
        userRoles.includes(p),
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
