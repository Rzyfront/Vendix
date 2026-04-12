import { Injectable } from '@nestjs/common';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { RequestContextService } from '@common/context/request-context.service';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

@Injectable()
export class McpToolProvider {
  constructor(private readonly toolRegistry: AIToolRegistry) {}

  listTools(): McpToolDefinition[] {
    const context = RequestContextService.getContext();
    const definitions = this.toolRegistry.getAvailableDefinitions(
      context?.permissions || context?.roles,
    );

    return definitions.map((d) => ({
      name: d.function.name,
      description: d.function.description,
      inputSchema: d.function.parameters,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, any>,
  ): Promise<McpToolResult> {
    try {
      const result = await this.toolRegistry.executeTool(name, args);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
}
