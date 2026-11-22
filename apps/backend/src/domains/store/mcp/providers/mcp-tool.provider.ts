import { Injectable } from '@nestjs/common';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { ToolDeprecation } from '../../../../ai-engine/tools/interfaces/tool.interface';
import { isVexOnlyTool } from '../../../../ai-engine/tools/surface-tools';
import { RequestContextService } from '@common/context/request-context.service';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  /** T2: versión del contrato del tool (`RegisteredTool.version`). */
  version: string;
  /** T5: marcador de deprecación, presente solo en tools deprecados. */
  deprecated?: ToolDeprecation;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

@Injectable()
export class McpToolProvider {
  constructor(private readonly toolRegistry: AIToolRegistry) {}

  /**
   * Vex-surface tools (`vex_*`, `suggest_followup`, `remember`, `forget`)
   * never travel through MCP: they assume a Vex turn (its conversation, its
   * panel) that an MCP client does not have. Second layer behind each tool's
   * own access rule, so a new Vex-only tool cannot leak here by omission.
   * Resolved through the registry so a namespaced name or alias is caught too.
   */
  private isHiddenFromMcp(name: string): boolean {
    return isVexOnlyTool(this.toolRegistry.canonicalName(name));
  }

  listTools(): McpToolDefinition[] {
    const context = RequestContextService.getContext();
    const definitions = this.toolRegistry
      .getAvailableDefinitions(context?.permissions || context?.roles)
      .filter((d) => !this.isHiddenFromMcp(d.function.name));

    return definitions.map((d) => {
      const deprecated = this.toolRegistry.getDeprecation(d.function.name);
      // T5: el sunset viaja como campo Y como línea en la descripción: el
      // campo lo leen los clientes que conocen la extensión, la línea la lee
      // todo el mundo (los SDK de MCP pueden pelar claves extra).
      const sunsetLine = deprecated
        ? `\n\n(DEPRECADO desde v${deprecated.since}` +
          (deprecated.sunset ? `; se retira en ${deprecated.sunset}` : '') +
          (deprecated.replacedBy ? `; usa ${deprecated.replacedBy}` : '') +
          '.)'
        : '';
      return {
        name: d.function.name,
        description: `${d.function.description}${sunsetLine}`,
        inputSchema: d.function.parameters,
        version: this.toolRegistry.getToolVersion(d.function.name),
        ...(deprecated ? { deprecated } : {}),
      };
    });
  }

  async callTool(
    name: string,
    args: Record<string, any>,
  ): Promise<McpToolResult> {
    if (this.isHiddenFromMcp(name)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Tool "${name}" is not available over MCP`,
          },
        ],
        isError: true,
      };
    }
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
