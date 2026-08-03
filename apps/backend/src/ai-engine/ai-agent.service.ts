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

/**
 * Tool results go to the model in full; this cap applies only to the copy
 * echoed to the UI, which shows a one-line trace, not the payload.
 */
const TOOL_RESULT_SUMMARY_CHARS = 300;

export interface AgentRunParams {
  goal: string;
  system_prompt?: string;
  app_key?: string;
  tools?: string[];
  max_iterations?: number;
  timeout_ms?: number;
  config_id?: number;
  /**
   * Prior turns of the conversation, oldest first, WITHOUT the current goal —
   * that is appended as the last user message. Absent this, every question is
   * answered in isolation and "¿y de esos cuál es el más caro?" is unanswerable.
   */
  messages?: AIMessage[];
  /**
   * Interpolation variables for the application's stored `system_prompt`.
   * Only consulted when `app_key` is set, because that is the only path where
   * the prompt comes from the database instead of the caller.
   */
  variables?: Record<string, string>;
}

export interface AgentResult {
  content: string;
  iterations: number;
  tools_used: Array<{ name: string; args: any; result: string }>;
  total_tokens: number;
  success: boolean;
  error?: string;
  /**
   * A write the agent proposed but did not execute, waiting on the user.
   *
   * Surfaced separately from `content` because the UI renders it as a diff
   * card with approve/reject buttons, not as prose — and because the token
   * has to survive the round trip to come back on the apply call.
   */
  pending_confirmation?: {
    tool: string;
    arguments: Record<string, any>;
    confirmation_token: string;
    preview?: unknown;
  };
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

  /**
   * A provider answer that succeeded and said nothing.
   *
   * Requires all three to be absent — text, tool calls and token usage. A real
   * final answer always has content; a real tool step always has tool calls;
   * and even an empty-string completion reports prompt tokens. Zero of all
   * three is the transport dropping the response, not the model finishing.
   */
  private isEmptyCompletion(response: {
    success: boolean;
    content?: string | null;
    tool_calls?: unknown[] | null;
    usage?: { totalTokens?: number } | null;
  }): boolean {
    return (
      response.success === true &&
      !response.content?.trim() &&
      !response.tool_calls?.length &&
      !response.usage?.totalTokens
    );
  }

  /**
   * The sentence shown for a write that is proposed but not applied.
   *
   * Built from the preview the tool itself computed, so what the user reads
   * and what the approval card shows come from the same source. Falls back to
   * naming the tool when the preview is missing or has an unexpected shape —
   * an unhelpful sentence beats a confident false one.
   */
  private describePendingWrite(
    pending: NonNullable<AgentResult['pending_confirmation']>,
  ): string {
    const preview = pending.preview as
      | {
          target?: unknown;
          message?: unknown;
          changes?: Array<{ label?: unknown; from?: unknown; to?: unknown }>;
        }
      | undefined;

    const target =
      typeof preview?.target === 'string' && preview.target.trim()
        ? preview.target.trim()
        : null;

    const diff = (preview?.changes ?? [])
      .filter((change) => typeof change?.label === 'string')
      .map((change) => `${change.label}: ${change.from} → ${change.to}`)
      .join('; ');

    const head = target
      ? `Tengo lista la propuesta para ${target}.`
      : `Tengo lista la propuesta para "${pending.tool}".`;

    const note =
      typeof preview?.message === 'string' && preview.message.trim()
        ? ` ${preview.message.trim()}`
        : '';

    return [
      head,
      diff ? ` ${diff}.` : '',
      note,
      ' Todavía no la apliqué: apruébala y la aplico.',
    ].join('');
  }

  /**
   * Non-streaming entry point. Drains the streaming loop and keeps its return
   * value, so there is exactly one implementation of the agent protocol —
   * a second copy for the SSE path would drift the moment either is touched.
   */
  async runAgent(params: AgentRunParams): Promise<AgentResult> {
    const iterator = this.runAgentStream(params);
    let step = await iterator.next();
    while (!step.done) {
      step = await iterator.next();
    }
    return step.value;
  }

  /**
   * The agent loop, narrating itself.
   *
   * Yields `tool_call` before each execution and `tool_result` after, so the
   * UI can show what Vexi is doing instead of a 30-40s spinner. The final
   * answer arrives as `text` and then `done`.
   *
   * The final text is emitted as one chunk rather than token by token: the
   * loop cannot know which iteration is the last until the model answers
   * without tool calls, and switching that call to `runStream()` would mean
   * committing to "this is the end" before the model has said so. Narrating
   * the tools is what removes the dead air; the last paragraph arriving whole
   * is not what the wait was made of.
   */
  async *runAgentStream(
    params: AgentRunParams,
  ): AsyncGenerator<AIStreamChunk, AgentResult> {
    const startTime = Date.now();
    const maxIterations = params.max_iterations || this.DEFAULT_MAX_ITERATIONS;
    const timeoutMs = params.timeout_ms || this.DEFAULT_TIMEOUT_MS;

    const context = RequestContextService.getContext();

    // Same resolution `executeTool()` uses, and it has to be: the catalog and
    // the execution gate must authorize on identical grounds. Passing `roles`
    // here compared `['owner']` against `['store:inventory:stock_levels:read']`,
    // so `every()` never matched and the model was handed an empty toolset
    // while `executeTool()` would happily have run those same tools.
    // `[]` is truthy, so the fallback needs a length check.
    const granted = context?.permissions;
    const authScopes = granted?.length ? granted : (context?.roles ?? []);
    const toolDefinitions = this.toolRegistry.getAvailableDefinitions(authScopes);

    // Filter tools if specific ones requested
    const filteredTools = params.tools?.length
      ? toolDefinitions.filter((t) => params.tools!.includes(t.function.name))
      : toolDefinitions;

    const messages: AIMessage[] = [];

    // With an app key the system prompt lives in the database and `run()`
    // prepends it already interpolated, so pushing one here would send two
    // competing system messages and defeat the variable substitution.
    if (!params.app_key) {
      messages.push({
        role: 'system',
        content:
          params.system_prompt ??
          'You are a helpful business assistant for Vendix. Use the available tools to answer questions with real data. Always provide specific numbers and insights. Respond in the same language the user uses.',
      });
    }

    if (params.messages?.length) {
      messages.push(...params.messages);
    }

    messages.push({ role: 'user', content: params.goal });

    const toolsUsed: AgentResult['tools_used'] = [];
    let pendingConfirmation: AgentResult['pending_confirmation'];
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

        const toolOptions = {
          tools: filteredTools.length > 0 ? filteredTools : undefined,
          tool_choice: (filteredTools.length > 0 ? 'auto' : undefined) as
            | 'auto'
            | undefined,
        };

        // Route through `run()` whenever an application exists: it is the only
        // path that enforces the subscription gate, the rate limit and writes
        // an `ai_engine_logs` row. `chat()`/`chatWith()` skip all three, so an
        // agent that iterates ten times used to burn ten calls off the books.
        // Every iteration counts — that is the point, not a side effect.
        const callProvider = () =>
          params.app_key
            ? this.aiEngine.run(
                params.app_key,
                params.variables,
                messages,
                toolOptions,
              )
            : params.config_id
              ? this.aiEngine.chatWith(params.config_id, messages, toolOptions)
              : this.aiEngine.chat(messages, toolOptions);

        let response = await callProvider();

        // Around one call in six comes back `success` with no content, no tool
        // calls and no usage at all — a provider hiccup, not a decision. The
        // loop reads that as "the model has nothing more to say" and ends the
        // turn, so the user asks a question and gets silence. One retry costs a
        // second and turns most of those into real answers; the retry is not
        // repeated so a genuinely mute model still terminates the loop.
        if (this.isEmptyCompletion(response)) {
          this.logger.warn(
            `Empty completion at iteration ${iteration}; retrying once`,
          );
          response = await callProvider();
        }

        if (!response.success) {
          yield { type: 'error', error: response.error || 'AI request failed' };
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

          // With a write still awaiting approval, the model's own wording is
          // not trusted to describe it. Observed with weaker models: the tool
          // answers "esperando confirmación" and the reply is "ya quedó, le
          // subí el 5%" — a claim that the store's data changed when it did
          // not. The prompt forbids it and the model does it anyway, so the
          // sentence is composed from the server's own preview instead. Tone
          // loses a little; a false report about the business would cost more.
          const narration = pendingConfirmation
            ? this.describePendingWrite(pendingConfirmation)
            : response.content;

          if (narration) {
            yield { type: 'text', content: narration };
          }
          yield {
            type: 'done',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            },
          };

          return {
            content: narration || '',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: true,
            pending_confirmation: pendingConfirmation,
          };
        }

        // Process tool calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        for (const toolCall of response.tool_calls) {
          // Normalized once, here, so the whole turn speaks one name: the
          // streamed frames, the trace, the clientSide check and the browser's
          // command dispatcher. Gemini prefixes calls with `default_api.`, and
          // a frame carrying that prefix reaches a frontend that matches on the
          // bare name — the UI command silently never runs.
          const toolName = this.toolRegistry.canonicalName(
            toolCall.function.name,
          );
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

          yield {
            type: 'tool_call',
            tool: { id: toolCall.id, name: toolName, arguments: toolArgs },
          };

          // A UI command is dispatched by the browser off the `tool_call`
          // frame just emitted; there is no router or cart in this process to
          // run it against. Calling `executeTool()` would be correct-by-
          // contract and useless here — it rejects client-side tools on
          // purpose, and the model would read that rejection as a failure and
          // apologize for something the user is watching happen. That
          // rejection still guards the surfaces that bypass this loop (voice
          // bridge, MCP), where a client that cannot dispatch must fail loudly.
          if (this.toolRegistry.isClientSide(toolName)) {
            toolsUsed.push({
              name: toolName,
              args: toolArgs,
              result: 'dispatched_to_client',
            });
            messages.push({
              role: 'tool',
              content: JSON.stringify({
                dispatched: true,
                command: toolName,
                // Se nombra el comando y se acota el alcance porque la nota
                // genérica ("asume que se ejecutó") licenciaba dar por hecho lo
                // que nunca se pidió: tras un solo `ui_navigate`, el modelo
                // afirmaba haber agregado dos productos al carrito que seguía
                // vacío. Enviado ≠ hecho, y enviado uno ≠ enviados todos.
                note: `Se envió al navegador ÚNICAMENTE el comando "${toolName}" con esos argumentos. No se ejecutó ningún otro, y NO sabes si funcionó: el resultado ocurre en la pantalla del usuario, no acá. Habla en intención, no en hecho consumado ("te lo estoy agregando", no "ya quedó agregado"); la pantalla y la traza le muestran el resultado real. Si tu objetivo necesita más pasos —cada producto, el cliente, el refresco— pídelos uno por uno con su propia llamada. Nunca digas que hiciste algo para lo que no llamaste la herramienta.`,
              }),
              tool_call_id: toolCall.id,
            });
            continue;
          }

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

            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: result.slice(0, TOOL_RESULT_SUMMARY_CHARS),
              },
            };
          } catch (error: any) {
            // A confirmation demand is not a failure — it is the proposal
            // step of the write protocol. The registry answers `AI_AGENT_005`
            // carrying the diff and a single-use token; the model needs both
            // so it can describe the change in the user's own terms, and the
            // caller needs the token so approving it can actually apply.
            const payload =
              error instanceof VendixHttpException
                ? (error.getResponse() as Record<string, any>)
                : null;

            if (payload?.error_code === 'AI_AGENT_005') {
              const details = payload.details as
                | Record<string, any>
                | undefined;
              if (details?.confirmation_token) {
                pendingConfirmation = {
                  tool: toolName,
                  arguments: toolArgs,
                  confirmation_token: details.confirmation_token,
                  preview: details.preview,
                };
              }
              messages.push({
                role: 'tool',
                content: JSON.stringify({
                  requires_confirmation: true,
                  message: payload.message,
                  preview: details?.preview,
                }),
                tool_call_id: toolCall.id,
              });
              yield {
                type: 'tool_result',
                tool: {
                  id: toolCall.id,
                  name: toolName,
                  summary: 'Esperando confirmación del usuario.',
                },
              };
              continue;
            }

            const errorMsg =
              error instanceof VendixHttpException
                ? (payload?.message ?? error.message)
                : `Tool error: ${error.message}`;

            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMsg }),
              tool_call_id: toolCall.id,
            });

            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: errorMsg.slice(0, TOOL_RESULT_SUMMARY_CHARS),
                failed: true,
              },
            };
          }
        }
      }

      // Max iterations reached
      throw new VendixHttpException(ErrorCodes.AI_AGENT_001);
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;

      this.logger.error(`Agent failed: ${error.message}`);
      yield { type: 'error', error: error.message };
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
