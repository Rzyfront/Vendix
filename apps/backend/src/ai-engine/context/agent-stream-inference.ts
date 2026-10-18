import type {
  AIResponse,
  AIStreamChunk,
} from '../interfaces/ai-provider.interface';

export function agentStreamingEnabled(): boolean {
  return process.env.AI_AGENT_STREAMING_ENABLED === 'true';
}

/** Run one inference under the SAME durable meter as buffered calls. Provider
 * text is genuinely consumed incrementally, but is not a business fact: do not
 * expose an unverified "already changed" sentence before its tool result. */
export async function* streamAgentInference(
  source: () => AsyncGenerator<AIStreamChunk>,
  run: (consume: () => Promise<AIResponse>) => Promise<AIResponse>,
  cancel: () => void,
): AsyncGenerator<AIStreamChunk, AIResponse> {
  let wake: (() => void) | undefined;
  let progress = false;
  let deliveredProgress = false;
  let settled = false;
  let response: AIResponse | undefined;
  let failure: unknown;
  let iterator: AsyncGenerator<AIStreamChunk> | undefined;
  let returned = false;
  const task = run(async () => {
    iterator = source();
    let content = '';
    let terminal: AIStreamChunk | undefined;
    for await (const chunk of iterator) {
      if (chunk.type === 'text') {
        content += chunk.content ?? '';
        if (chunk.content) {
          progress = true;
          wake?.();
        }
      } else if (chunk.type === 'done') {
        terminal = chunk;
      } else if (chunk.type === 'error') {
        return {
          success: false,
          content: '',
          error: chunk.error,
          error_code: chunk.error_code ?? 'PROVIDER_FAILURE',
          usage: chunk.usage,
        };
      }
    }
    if (!terminal)
      return {
        success: false,
        error: 'La respuesta no terminó; no se ejecutaron sus argumentos.',
        error_code: 'AI_STREAM_INCOMPLETE',
      };
    return {
      success: true,
      content: terminal.content ?? content,
      tool_calls: terminal.tool_calls,
      finish_reason: terminal.finish_reason,
      usage: terminal.usage,
      model: terminal.model,
    };
  })
    .then(
      (value) => {
        response = value;
      },
      (error) => {
        failure = error;
      },
    )
    .finally(() => {
      settled = true;
      wake?.();
    });
  try {
    while (!settled || (progress && !deliveredProgress)) {
      if (progress && !deliveredProgress) {
        deliveredProgress = true;
        // Transport progress, NOT useful-business TTFT and NOT evidence.
        yield {
          type: 'progress',
          content:
            'Recibiendo la respuesta; todavía debo comprobar el resultado.',
        };
      } else if (!settled) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    }
    await task;
    if (failure) throw failure;
    returned = true;
    return response!;
  } finally {
    if (!returned) {
      cancel();
      // The engine owns logging/usage in its finally. Never hide its completion
      // or invent a rollback; a noncooperative late result remains fenced.
      void iterator?.return(undefined).catch(() => undefined);
    }
  }
}
