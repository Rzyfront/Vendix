import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { RequestContextService } from '../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import { VexiUiChannelService } from '../domains/store/vexi/vexi-ui-channel.service';
import { PROPOSE_PLAN_TOOL } from './tools/domains/planning.tools';
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

/**
 * Iteration budget once a multi-step plan is on the table.
 *
 * A single question fits in ten rounds and that stays the default, because a
 * wider budget on a one-shot question buys nothing and pays for it in latency
 * and tokens. A declared plan is the opposite case: "crea el proveedor y
 * regístrale la factura" is four to six rounds per step, and hitting the ceiling
 * mid-chain used to end the turn with the work half done and no way for the model
 * to say which half.
 */
const PLANNED_MAX_ITERATIONS = 25;

/**
 * Wall-clock budget for a planned turn.
 *
 * Iterations alone are not the binding constraint once the interface is in the
 * loop: each `ui_*` command can block up to 25 s waiting for the browser, so a
 * three-step plan can legitimately spend well past the one-minute default before
 * the model has done anything wrong.
 */
const PLANNED_TIMEOUT_MS = 180_000;

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
  /**
   * Correlation id of the turn's SSE stream, when there is a browser on the
   * other end.
   *
   * Present only on the chat surface. Its absence is what tells the loop that a
   * `clientSide` command has nobody to execute it — the voice bridge and MCP both
   * dispatch commands out of band — so the loop can be honest about it instead of
   * waiting on a result that will never arrive.
   */
  stream_id?: string;
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
    private readonly uiChannel: VexiUiChannelService,
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
   * and what the approval card shows come from the same source.
   *
   * Two preview shapes are accepted because two families of tools produce
   * them: the typed tools describe *what* they touch (`target`), while
   * `write_endpoint` describes *the operation* (`label`, e.g. "Crear un
   * gasto"). Reading only `target` made every bridge write fall through to the
   * last resort, which used to name the tool — "la propuesta para
   * write_endpoint" — exactly the internal detail the agent is told never to
   * show. The fallback is now generic instead: vague beats leaking, and the
   * approval card carries the specifics regardless.
   */
  private describePendingWrite(
    pending: NonNullable<AgentResult['pending_confirmation']>,
  ): string {
    const preview = pending.preview as
      | {
          target?: unknown;
          label?: unknown;
          message?: unknown;
          changes?: Array<{ label?: unknown; from?: unknown; to?: unknown }>;
        }
      | undefined;

    const target =
      typeof preview?.target === 'string' && preview.target.trim()
        ? preview.target.trim()
        : null;

    // Labels are verb-initial by construction (`describeWrite`), so they read
    // as a clause once the leading capital is dropped.
    const label =
      typeof preview?.label === 'string' && preview.label.trim()
        ? preview.label.trim().charAt(0).toLowerCase() +
          preview.label.trim().slice(1)
        : null;

    const diff = (preview?.changes ?? [])
      .filter((change) => typeof change?.label === 'string')
      .map((change) => `${change.label}: ${change.from} → ${change.to}`)
      .join('; ');

    const head = label
      ? `Tengo lista la propuesta: ${label}.`
      : target
        ? `Tengo lista la propuesta para ${target}.`
        : 'Tengo lista la propuesta del cambio.';

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
    // Not `const`: a declared plan widens it mid-turn (see PLANNED_MAX_ITERATIONS).
    let maxIterations = params.max_iterations || this.DEFAULT_MAX_ITERATIONS;
    // Widened alongside the iteration budget, and for a second reason: a turn
    // that drives the interface now blocks up to 25 s per command waiting for the
    // browser, so two UI steps alone can consume the whole one-minute default and
    // abort a turn that was working correctly.
    let timeoutMs = params.timeout_ms || this.DEFAULT_TIMEOUT_MS;

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
            // With a browser on the line, the turn now WAITS for what actually
            // happened on screen instead of assuming. This is the fix for the
            // loop's worst honesty defect: the old code pushed
            // `dispatched_to_client` and moved on, so the model's next thought
            // was formed with no idea whether the command found the module, hit
            // a variant picker, or failed outright — and it routinely narrated
            // success it had never observed. Now `ui_add_to_cart` on a product
            // with variants comes back `needs_user_input` and the same turn asks
            // which variant, because the answer arrived before the model spoke.
            const uiResult = params.stream_id
              ? await this.uiChannel.awaitResult(params.stream_id, toolCall.id)
              : null;

            const resultPayload =
              uiResult ??
              JSON.stringify({
                dispatched: true,
                command: toolName,
                result_unknown: true,
                // Reached in two situations that share one honest answer: no
                // browser is listening (voice, MCP), or the browser never
                // answered within the window because the user closed the panel
                // or navigated away. Either way the outcome is unobserved, and
                // saying so is the only truthful option left.
                note: `Se envió al navegador ÚNICAMENTE el comando "${toolName}" con esos argumentos y NO llegó respuesta, así que no sabes si funcionó. Habla en intención, no en hecho consumado ("te lo estoy agregando", no "ya quedó agregado"), y ofrécele verificarlo. Si tu objetivo necesita más pasos, pídelos uno por uno con su propia llamada. Nunca digas que hiciste algo cuyo resultado no viste.`,
              });

            toolsUsed.push({
              name: toolName,
              args: toolArgs,
              result: resultPayload,
            });
            messages.push({
              role: 'tool',
              content: resultPayload,
              tool_call_id: toolCall.id,
            });

            // Emitted for the real result too, so the panel's trace shows what
            // the screen answered and not just what was asked of it.
            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: resultPayload.slice(0, TOOL_RESULT_SUMMARY_CHARS),
              },
            };
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

            // A plan is a promise about the rest of the turn, so the turn is
            // given room to keep it. Raised here rather than at the top because
            // the model decides mid-turn whether the request is compound: a
            // budget set before the first provider call would have to guess, and
            // guessing high makes every simple question slower.
            if (toolName === PROPOSE_PLAN_TOOL) {
              maxIterations = Math.max(maxIterations, PLANNED_MAX_ITERATIONS);
              timeoutMs = Math.max(timeoutMs, PLANNED_TIMEOUT_MS);
            }

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

              // The token is what separates the two outcomes that share this
              // error code. `enforceConfirmation` throws it both when a change
              // is queued for approval AND when the preview already proved the
              // change impossible — and the second case deliberately mints no
              // token. Reporting both as `requires_confirmation: true` told the
              // model a rejected write was waiting on the user, so it narrated
              // approval cards that did not exist. Without a token there is no
              // proposal: it is a refusal the model can still fix and retry.
              if (!details?.confirmation_token) {
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({
                    requires_confirmation: false,
                    applied: false,
                    error: payload.message,
                    preview: details?.preview,
                    next_step:
                      'Este cambio NO quedó propuesto y no hay nada que el usuario pueda aprobar. Corrige lo que falló y vuelve a intentarlo, o dile a la persona qué dato hace falta.',
                  }),
                  tool_call_id: toolCall.id,
                });
                yield {
                  type: 'tool_result',
                  tool: {
                    id: toolCall.id,
                    name: toolName,
                    summary: 'No se pudo preparar el cambio.',
                  },
                };
                continue;
              }

              pendingConfirmation = {
                tool: toolName,
                arguments: toolArgs,
                confirmation_token: details.confirmation_token,
                preview: details.preview,
              };

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

        // Un turno que propone un cambio TERMINA ahí.
        //
        // Sin este corte el bucle seguía girando con `requires_confirmation:
        // true` en el último resultado, y el modelo —que no tiene forma de
        // aprobar nada— volvía a llamar la misma herramienta de escritura. Cada
        // reintento acuñaba un token nuevo, pisaba `pendingConfirmation` y
        // emitía otro "esperando confirmación": la persona veía a Vexi pidiendo
        // permiso una y otra vez dentro del mismo turno, y terminaba en la rama
        // de iteraciones agotadas. La tarjeta que sí llega al navegador es la
        // del token que sobrevivió, no la del cambio que la persona leyó
        // primero.
        //
        // La frase la compone el servidor a partir del preview, por la misma
        // razón que la salida sin tool_calls: con una escritura pendiente no se
        // le confía al modelo la redacción de lo que pasó.
        if (pendingConfirmation) {
          this.eventEmitter.emit('ai.agent.completed', {
            iterations: iteration,
            tools_used: toolsUsed.length,
            total_tokens: totalTokens,
            store_id: context?.store_id,
          });

          const narration = this.describePendingWrite(pendingConfirmation);
          yield { type: 'text', content: narration };
          yield {
            type: 'done',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            },
          };

          return {
            content: narration,
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: true,
            pending_confirmation: pendingConfirmation,
          };
        }
      }

      // Iterations exhausted.
      //
      // This used to throw AI_AGENT_001, which surfaced to the person as a raw
      // error at the exact moment Vexi had worked hardest — ten rounds of
      // searching and nothing to show for it but red text. And the model was
      // in the best possible position to close: it had every tool result from
      // the whole loop in `messages`.
      //
      // So instead of abandoning, it gets one last turn with the tools taken
      // away. With no tool to call it can only answer in words, which is
      // exactly the pessimistic-but-human close the situation calls for.
      // Failing THAT, the fallback below is still a sentence, never an error.
      messages.push({
        role: 'user',
        content:
          'Ya no puedes usar más herramientas en este turno. Responde ahora con lo que hayas averiguado: si encontraste algo, dilo; si no, dile con naturalidad que no diste con lo que buscaba y qué le sugieres hacer. No menciones herramientas, rutas, reintentos ni límites internos.',
      });

      let closing = '';
      try {
        const lastCall = params.app_key
          ? await this.aiEngine.run(
              params.app_key,
              params.variables,
              messages,
              {},
            )
          : params.config_id
            ? await this.aiEngine.chatWith(params.config_id, messages, {})
            : await this.aiEngine.chat(messages, {});

        totalTokens += lastCall?.usage?.totalTokens ?? 0;
        closing = (lastCall?.content ?? '').trim();
      } catch (closingError: any) {
        this.logger.warn(
          `Agent closing turn failed: ${closingError?.message ?? 'unknown'}`,
        );
      }

      const content =
        closing ||
        'Estuve buscando por varios lados y no logré dar con lo que necesitas. ¿Me lo describes de otra forma o me das algún dato más para intentarlo de nuevo?';

      yield { type: 'text', content };

      return {
        content,
        iterations: iteration,
        tools_used: toolsUsed,
        total_tokens: totalTokens,
        success: true,
        pending_confirmation: pendingConfirmation,
      };
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
