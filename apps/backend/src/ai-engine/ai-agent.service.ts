import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { RequestContextService } from '../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import {
  AIMessage,
  AIResponse,
  AIStreamChunk,
} from './interfaces/ai-provider.interface';

export interface AgentRunParams {
  goal: string;
  system_prompt?: string;
  app_key?: string;
  tools?: string[];
  max_iterations?: number;
  timeout_ms?: number;
  config_id?: number;
}

export interface AgentResult {
  content: string;
  iterations: number;
  tools_used: Array<{ name: string; args: any; result: string }>;
  total_tokens: number;
  success: boolean;
  error?: string;
}

@Injectable()
export class AIAgentService {
  private readonly logger = new Logger(AIAgentService.name);
  private readonly DEFAULT_MAX_ITERATIONS = 10;
  private readonly DEFAULT_TIMEOUT_MS = 60000;

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly aiLogging: AILoggingService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async runAgent(params: AgentRunParams): Promise<AgentResult> {
    const startTime = Date.now();
    const maxIterations = params.max_iterations || this.DEFAULT_MAX_ITERATIONS;
    const timeoutMs = params.timeout_ms || this.DEFAULT_TIMEOUT_MS;

    const context = RequestContextService.getContext();
    const toolDefinitions = this.toolRegistry.getAvailableDefinitions(
      context?.roles,
    );

    // Filter tools if specific ones requested
    const filteredTools = params.tools?.length
      ? toolDefinitions.filter((t) => params.tools!.includes(t.function.name))
      : toolDefinitions;

    const messages: AIMessage[] = [];

    if (params.system_prompt) {
      messages.push({ role: 'system', content: params.system_prompt });
    } else {
      messages.push({
        role: 'system',
        content:
          'You are a helpful business assistant for Vendix. Use the available tools to answer questions with real data. Always provide specific numbers and insights. Respond in the same language the user uses.',
      });
    }

    messages.push({ role: 'user', content: params.goal });

    const toolsUsed: AgentResult['tools_used'] = [];
    let totalTokens = 0;
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        // Timeout check
        if (Date.now() - startTime > timeoutMs) {
          throw new VendixHttpException(ErrorCodes.AI_AGENT_002);
        }

        iteration++;

        this.eventEmitter.emit('ai.agent.iteration', {
          iteration,
          max_iterations: maxIterations,
          store_id: context?.store_id,
        });

        // Call LLM with tools
        const response = params.config_id
          ? await this.aiEngine.chatWith(params.config_id, messages, {
              tools: filteredTools.length > 0 ? filteredTools : undefined,
              tool_choice: filteredTools.length > 0 ? 'auto' : undefined,
            })
          : await this.aiEngine.chat(messages, {
              tools: filteredTools.length > 0 ? filteredTools : undefined,
              tool_choice: filteredTools.length > 0 ? 'auto' : undefined,
            });

        if (!response.success) {
          return {
            content: response.error || 'AI request failed',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: false,
            error: response.error,
          };
        }

        totalTokens += response.usage?.totalTokens || 0;

        // If finish_reason is 'length', the response was truncated
        if (response.finish_reason === 'length') {
          this.logger.warn(
            `Agent response truncated (max tokens) at iteration ${iteration}`,
          );
        }

        // If no tool calls, we have the final answer
        if (
          !response.tool_calls?.length ||
          response.finish_reason !== 'tool_calls'
        ) {
          this.eventEmitter.emit('ai.agent.completed', {
            iterations: iteration,
            tools_used: toolsUsed.length,
            total_tokens: totalTokens,
            store_id: context?.store_id,
          });

          return {
            content: response.content || '',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: true,
          };
        }

        // Process tool calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, any>;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          this.logger.log(
            `Agent iteration ${iteration}: executing tool "${toolName}"`,
          );

          this.eventEmitter.emit('ai.agent.tool_executed', {
            iteration,
            tool_name: toolName,
            store_id: context?.store_id,
          });

          try {
            const result = await this.toolRegistry.executeTool(
              toolName,
              toolArgs,
            );

            toolsUsed.push({
              name: toolName,
              args: toolArgs,
              result,
            });

            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });
          } catch (error: any) {
            const errorMsg =
              error instanceof VendixHttpException
                ? error.message
                : `Tool error: ${error.message}`;

            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMsg }),
              tool_call_id: toolCall.id,
            });
          }
        }
      }

      // Max iterations reached
      throw new VendixHttpException(ErrorCodes.AI_AGENT_001);
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;

      this.logger.error(`Agent failed: ${error.message}`);
      return {
        content: '',
        iterations: iteration,
        tools_used: toolsUsed,
        total_tokens: totalTokens,
        success: false,
        error: error.message,
      };
    }
  }
}
