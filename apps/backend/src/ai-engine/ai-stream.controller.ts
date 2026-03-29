import { Controller, Param, Query, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AIEngineService } from './ai-engine.service';

@Controller('store/ai')
export class AIStreamController {
  constructor(private readonly aiEngine: AIEngineService) {}

  @Sse('stream/:appKey')
  streamRun(
    @Param('appKey') appKey: string,
    @Query() query: Record<string, string>,
  ): Observable<MessageEvent> {
    // Remove 'token' from variables (it's for auth, not AI)
    const { token, ...variables } = query;

    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          for await (const chunk of this.aiEngine.runStream(
            appKey,
            Object.keys(variables).length > 0 ? variables : undefined,
          )) {
            subscriber.next({
              data: JSON.stringify(chunk),
              type: 'ai-chunk',
            } as MessageEvent);

            if (chunk.type === 'done' || chunk.type === 'error') {
              subscriber.complete();
              return;
            }
          }
          subscriber.complete();
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', error: error.message }),
            type: 'ai-chunk',
          } as MessageEvent);
          subscriber.complete();
        }
      })();
    });
  }
}
