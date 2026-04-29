import { Injectable, Logger } from '@nestjs/common';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';

export interface McpAuditEntry {
  method: string;
  resource_uri?: string;
  tool_name?: string;
  prompt_name?: string;
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  client_id?: string;
  params?: Record<string, any>;
  result_status: 'success' | 'error';
  error_message?: string;
  latency_ms: number;
}

@Injectable()
export class McpAuditService {
  private readonly logger = new Logger(McpAuditService.name);

  constructor(private readonly aiLogging: AILoggingService) {}

  async logInvocation(entry: McpAuditEntry): Promise<void> {
    try {
      await this.aiLogging.logRequest({
        app_key: `mcp:${entry.method}`,
        organization_id: entry.organization_id,
        store_id: entry.store_id,
        user_id: entry.user_id,
        model:
          entry.tool_name || entry.resource_uri || entry.prompt_name || 'mcp',
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        latency_ms: entry.latency_ms,
        status: entry.result_status,
        error_message: entry.error_message,
        input_preview: entry.params
          ? JSON.stringify(entry.params).substring(0, 500)
          : undefined,
      });
    } catch (error: any) {
      this.logger.error(`MCP audit log failed: ${error.message}`);
    }
  }
}
