import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpAuditService } from './mcp-audit.service';
import { McpResourceProvider } from './providers/mcp-resource.provider';
import { McpToolProvider } from './providers/mcp-tool.provider';
import { McpPromptProvider } from './providers/mcp-prompt.provider';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

interface McpRequest {
  method: string;
  params?: Record<string, any>;
}

@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpController {
  constructor(
    private readonly auditService: McpAuditService,
    private readonly resourceProvider: McpResourceProvider,
    private readonly toolProvider: McpToolProvider,
    private readonly promptProvider: McpPromptProvider,
  ) {}

  @Post('initialize')
  async initialize() {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: 'vendix-mcp-server',
        version: '1.0.0',
      },
    };
  }

  @Post('resources/list')
  async listResources(@Req() req: any) {
    const startTime = Date.now();
    try {
      const resources = this.resourceProvider.listResources();
      await this.audit(req, 'resources/list', startTime, 'success');
      return { resources };
    } catch (error: any) {
      await this.audit(
        req,
        'resources/list',
        startTime,
        'error',
        error.message,
      );
      throw error;
    }
  }

  @Post('resources/read')
  async readResource(@Body() body: { uri: string }, @Req() req: any) {
    const startTime = Date.now();
    if (!body.uri) {
      throw new VendixHttpException(
        ErrorCodes.AI_MCP_004,
        'Resource URI is required',
      );
    }

    try {
      const content = await this.resourceProvider.readResource(body.uri);
      await this.audit(req, 'resources/read', startTime, 'success', undefined, {
        resource_uri: body.uri,
      });
      return { contents: [content] };
    } catch (error: any) {
      await this.audit(
        req,
        'resources/read',
        startTime,
        'error',
        error.message,
      );
      throw error;
    }
  }

  @Post('tools/list')
  async listTools(@Req() req: any) {
    const startTime = Date.now();
    try {
      const tools = this.toolProvider.listTools();
      await this.audit(req, 'tools/list', startTime, 'success');
      return { tools };
    } catch (error: any) {
      await this.audit(req, 'tools/list', startTime, 'error', error.message);
      throw error;
    }
  }

  @Post('tools/call')
  async callTool(
    @Body() body: { name: string; arguments?: Record<string, any> },
    @Req() req: any,
  ) {
    const startTime = Date.now();
    if (!body.name) {
      throw new VendixHttpException(
        ErrorCodes.AI_MCP_004,
        'Tool name is required',
      );
    }

    try {
      const result = await this.toolProvider.callTool(
        body.name,
        body.arguments || {},
      );
      await this.audit(
        req,
        'tools/call',
        startTime,
        result.isError ? 'error' : 'success',
        undefined,
        {
          tool_name: body.name,
          params: body.arguments,
        },
      );
      return result;
    } catch (error: any) {
      await this.audit(req, 'tools/call', startTime, 'error', error.message, {
        tool_name: body.name,
      });
      throw error;
    }
  }

  @Post('prompts/list')
  async listPrompts(@Req() req: any) {
    const startTime = Date.now();
    try {
      const prompts = await this.promptProvider.listPrompts();
      await this.audit(req, 'prompts/list', startTime, 'success');
      return { prompts };
    } catch (error: any) {
      await this.audit(req, 'prompts/list', startTime, 'error', error.message);
      throw error;
    }
  }

  @Post('prompts/get')
  async getPrompt(
    @Body() body: { name: string; arguments?: Record<string, string> },
    @Req() req: any,
  ) {
    const startTime = Date.now();
    if (!body.name) {
      throw new VendixHttpException(
        ErrorCodes.AI_MCP_004,
        'Prompt name is required',
      );
    }

    try {
      const result = await this.promptProvider.getPrompt(
        body.name,
        body.arguments,
      );
      await this.audit(req, 'prompts/get', startTime, 'success', undefined, {
        prompt_name: body.name,
      });
      return result;
    } catch (error: any) {
      await this.audit(req, 'prompts/get', startTime, 'error', error.message, {
        prompt_name: body.name,
      });
      throw error;
    }
  }

  private async audit(
    req: any,
    method: string,
    startTime: number,
    status: 'success' | 'error',
    errorMessage?: string,
    extra?: {
      resource_uri?: string;
      tool_name?: string;
      prompt_name?: string;
      params?: any;
    },
  ): Promise<void> {
    const auth = req.mcpAuth;
    await this.auditService.logInvocation({
      method,
      resource_uri: extra?.resource_uri,
      tool_name: extra?.tool_name,
      prompt_name: extra?.prompt_name,
      organization_id: auth?.organization_id,
      store_id: auth?.store_id,
      user_id: auth?.user_id,
      params: extra?.params,
      result_status: status,
      error_message: errorMessage,
      latency_ms: Date.now() - startTime,
    });
  }
}
