import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, interval, of } from 'rxjs';
import {
  switchMap,
  map,
  catchError,
  mergeMap,
  startWith,
  takeUntil,
  takeWhile,
  withLatestFrom,
} from 'rxjs/operators';
import * as VexiActions from './vexi.actions';
import type { VexiProposalPreview } from './vexi.actions';
import * as VexiSelectors from './vexi.selectors';
import {
  VexiApiService,
  VexiStreamChunk,
} from '../../services/vexi-api.service';
import { VexiUiContextService } from '../../services/vexi-ui-context.service';
import { VexiUiCommandService } from '../../services/vexi-ui-command.service';
import { VexiVoicePipelineService } from '../../services/vexi-voice-pipeline.service';

@Injectable()
export class VexiEffects {
  /**
   * 5 s. Fast enough that a short job looks responsive, slow enough that a job
   * running for ten minutes costs 120 requests instead of 600.
   */
  private static readonly TASK_POLL_MS = 5000;

  /**
   * States after which nothing changes, so polling stops.
   *
   * Both the persisted `status` and BullMQ's `live_status` are checked against this
   * list: the row is written by the `vexi.task.finished` listener and the job's own
   * state can settle first, so whichever arrives first ends the poll.
   */
  private static readonly TERMINAL_TASK_STATES = [
    'completed',
    'failed',
    'cancelled',
  ];

  private actions$ = inject(Actions);
  private chatApi = inject(VexiApiService);
  private store = inject(Store);
  private uiContext = inject(VexiUiContextService);
  private uiCommands = inject(VexiUiCommandService);
  private voice = inject(VexiVoicePipelineService);

  private readonly facadeProposal$ = this.store.select(
    VexiSelectors.selectPendingProposal,
  );

  loadConversations$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.loadConversations),
      switchMap(() =>
        this.chatApi.getConversations({ limit: 50 }).pipe(
          map((result) =>
            VexiActions.loadConversationsSuccess({
              conversations: result.data,
            }),
          ),
          catchError((error) =>
            of(
              VexiActions.loadConversationsFailure({
                error: error.message || 'Failed to load conversations',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  createConversation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.createConversation),
      switchMap(({ appKey, title }) =>
        this.chatApi.createConversation({ app_key: appKey, title }).pipe(
          map((conversation) =>
            VexiActions.createConversationSuccess({ conversation }),
          ),
          catchError((error) =>
            of(
              VexiActions.createConversationFailure({
                error: error?.message || 'Failed to create conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /**
   * Creates the conversation and immediately sends the pending text as one
   * chain. Emits `createConversationSuccess` first so the reducer has set
   * `activeConversationId` by the time `sendMessage` lands — its handler
   * bails out when there is no active conversation.
   */
  startConversation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.startConversation),
      switchMap(({ content, appKey, attachmentIds, speak }) =>
        this.chatApi.createConversation({ app_key: appKey }).pipe(
          switchMap((conversation) =>
            of(
              VexiActions.createConversationSuccess({ conversation }),
              VexiActions.sendMessage({
                conversationId: conversation.id,
                content,
                // Threaded through so a first message CAN carry a document. Without
                // it, attaching an invoice to the very first thing you ever say to
                // Vexi silently dropped the file.
                attachmentIds,
                // Same reason for `speak`: the first thing a person ever says to
                // Vexi can be spoken, and dropping it here would answer their
                // very first voice turn in silence.
                speak,
              }),
            ),
          ),
          catchError((error) =>
            of(
              VexiActions.createConversationFailure({
                error: error?.message || 'Failed to start conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  selectConversation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.selectConversation),
      switchMap(({ conversationId }) =>
        this.chatApi.getConversation(conversationId).pipe(
          map((conversation) =>
            VexiActions.loadMessagesSuccess({
              messages: conversation.messages || [],
            }),
          ),
          catchError((error) =>
            of(
              VexiActions.selectConversationFailure({
                error: error?.message || 'Failed to load conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /**
   * Sends a turn over SSE and translates the stream into actions.
   *
   * Two steps, not one: `EventSource` cannot send a body, so the message and
   * the UI context go over POST first (`stream-intent`) and the stream URL
   * carries only the opaque id it returns. The previous shape was a plain POST
   * that blocked until the whole answer was ready — for an agent turn that ran
   * tools, that is 30-40 seconds of nothing on screen.
   *
   * `switchMap` cancels the previous turn if the user sends another, and the
   * teardown below closes the socket on unsubscribe as well as on `done` and
   * `error`. All three matter: an EventSource left open reconnects on its own
   * and would re-run the turn.
   */
  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.sendMessage),
      switchMap(({ conversationId, content, attachmentIds, speak }) =>
        this.chatApi
          .createStreamIntent(
            conversationId,
            content,
            this.uiContext.build(),
            attachmentIds,
            speak,
          )
          .pipe(
            switchMap((streamId) =>
              this.streamTurn(conversationId, streamId, speak === true),
            ),
            startWith(VexiActions.streamStarted({ conversationId })),
            catchError((error) =>
              of(
                VexiActions.sendMessageFailure({
                  error: error?.message || 'No pude enviar el mensaje',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /**
   * Applies the write the user approved.
   *
   * `withLatestFrom` reads the proposal from the store rather than carrying it
   * in the action: the card can be approved from anywhere (panel, toast, voice)
   * and none of those surfaces should have to hold the token.
   */
  confirmProposal$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.confirmProposal),
      withLatestFrom(
        this.facadeProposal$,
        this.store.select(VexiSelectors.selectActiveConversationId),
      ),
      switchMap(([, proposal, conversationId]) => {
        if (!proposal) {
          return of(
            VexiActions.confirmProposalFailure({
              error: 'Ya no hay ningún cambio pendiente por aprobar.',
            }),
          );
        }

        return this.chatApi
          .applyConfirmation(
            proposal.tool,
            proposal.arguments,
            proposal.confirmationToken,
            conversationId ?? undefined,
          )
          .pipe(
            map((result) =>
              VexiActions.confirmProposalSuccess({
                tool: proposal.tool,
                output: result.output,
                domain: proposal.preview?.domain,
              }),
            ),
            catchError((error) =>
              of(
                VexiActions.confirmProposalFailure({
                  error:
                    error?.error?.message ||
                    error?.message ||
                    'No pude aplicar el cambio.',
                }),
              ),
            ),
          );
      }),
    ),
  );

  /**
   * Opens the EventSource and turns each frame into an action.
   *
   * Built by hand rather than with a helper because the teardown is the whole
   * point: `close()` has to run on completion, on error and on unsubscribe.
   */
  private streamTurn(
    conversationId: number,
    streamId: string,
    speak = false,
  ): Observable<Action> {
    const url = this.chatApi.getStreamUrl(conversationId, streamId);

    if (!url) {
      return of(
        VexiActions.streamError({
          error: 'Sesión no válida. Vuelve a iniciar sesión.',
        }),
      );
    }

    // Claims playback for this stream. Frames from a turn the person interrupted
    // are dropped by id — the old EventSource is still open and still emitting
    // audio that was already paid for, and it must not talk over the new question.
    if (speak) this.voice.startTurn(streamId);

    return new Observable<Action>((subscriber) => {
      const source = new EventSource(url);

      source.addEventListener('ai-chunk', (event) => {
        let chunk: VexiStreamChunk;
        try {
          chunk = JSON.parse((event as MessageEvent).data);
        } catch {
          return;
        }

        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              subscriber.next(
                VexiActions.receiveStreamChunk({ content: chunk.content }),
              );
            }
            break;

          case 'tool_call': {
            if (!chunk.tool) break;
            const { id, name, arguments: args } = chunk.tool;
            subscriber.next(
              VexiActions.toolCallStarted({ id, name, arguments: args }),
            );

            // UI commands run here, not on the server — there is no router or
            // cart in that process. The backend emits the frame and moves on,
            // so this is the only place the command actually happens.
            if (this.uiCommands.handles(name)) {
              void this.uiCommands
                .execute(name, args ?? {})
                .then((summary) => {
                  // Back to the waiting turn. The agent loop is suspended on
                  // this exact `(stream_id, tool_call_id)` pair, so this is what
                  // lets the model reason about what really happened on screen
                  // instead of assuming its command worked. Fire-and-forget: the
                  // loop has its own timeout, and a failed POST must not also
                  // break the trace the user is watching.
                  this.chatApi.postUiResult(streamId, id, summary).subscribe({
                    error: () => undefined,
                  });

                  subscriber.next(
                    VexiActions.toolCallFinished({
                      id,
                      name,
                      summary,
                      // A UI command that resolves with `status: 'error'` is a
                      // failure the promise never rejected on — the cart
                      // refused the product, the POS was not open. Without
                      // this the trace narrates it in the past tense of
                      // success ("Añadí Cafe sello rojo") over a refusal.
                      failed: this.uiCommandFailed(summary),
                    }),
                  );
                })
                .catch(() => {
                  // The turn is told about the failure too, otherwise it waits
                  // out the full 25 s for a result that is never coming and then
                  // reports "no llegó respuesta" for something that did answer.
                  const failure = JSON.stringify({
                    status: 'error',
                    message: 'El comando de interfaz falló en el navegador.',
                  });

                  this.chatApi.postUiResult(streamId, id, failure).subscribe({
                    error: () => undefined,
                  });

                  subscriber.next(
                    VexiActions.toolCallFinished({
                      id,
                      name,
                      summary: 'El comando de interfaz falló.',
                      failed: true,
                    }),
                  );
                });
            }
            break;
          }

          case 'tool_result': {
            if (!chunk.tool) break;

            // A queued job is announced here and nowhere else. The result frame is
            // the only place the id appears, so missing it means the person has no
            // handle on work that is already running.
            const queued = this.readQueuedTask(
              chunk.tool.name,
              chunk.tool.summary,
            );
            if (queued) {
              subscriber.next(VexiActions.taskQueued(queued));
            }

            const proposal = this.readProposal(chunk.tool.summary);
            if (proposal) {
              // The backend signals a pending write by sending the token and
              // diff as a tool result — the same channel, so no extra frame
              // type and no second connection to keep in sync.
              subscriber.next(
                VexiActions.proposalReceived({
                  tool: chunk.tool.name,
                  arguments: proposal.arguments ?? {},
                  confirmationToken: proposal.confirmation_token,
                  preview: proposal.preview,
                }),
              );
            }
            subscriber.next(
              VexiActions.toolCallFinished({
                id: chunk.tool.id,
                name: chunk.tool.name,
                summary: proposal ? undefined : chunk.tool.summary,
                failed: chunk.tool.failed,
              }),
            );
            break;
          }

          case 'audio':
            // Handed straight to the player, never dispatched. A base64 mp3 in
            // a reducer is megabytes of state the devtools cannot render and the
            // store has no reason to remember — playback is browser state, like
            // the `HTMLAudioElement` that holds it.
            if (chunk.audio_base64 !== undefined && chunk.index !== undefined) {
              this.voice.enqueue(streamId, {
                index: chunk.index,
                audio_base64: chunk.audio_base64,
                content_type: chunk.content_type ?? 'audio/mpeg',
                filler: chunk.filler,
              });
            }
            break;

          case 'timing':
            if (chunk.mark && chunk.ms !== undefined) {
              this.voice.serverMark(chunk.mark, chunk.ms);
            }
            break;

          case 'done':
            // Before completing: lets the player stop waiting on an index that a
            // failed synthesis means will never arrive, instead of holding the
            // remaining segments behind the gap.
            this.voice.finishTurn(streamId);
            subscriber.next(VexiActions.streamComplete());
            subscriber.complete();
            break;

          case 'error':
            this.voice.finishTurn(streamId);
            subscriber.next(
              VexiActions.streamError({
                error: chunk.error || 'La respuesta se interrumpió.',
              }),
            );
            subscriber.complete();
            break;
        }
      });

      // Transport-level failure. EventSource retries by itself, which for an
      // agent turn means re-running tools, so the connection is closed here
      // and the user is told instead.
      source.onerror = () => {
        subscriber.next(
          VexiActions.streamError({
            error: 'Se perdió la conexión con Vexi. Intenta de nuevo.',
          }),
        );
        subscriber.complete();
      };

      return () => source.close();
    });
  }

  /**
   * Whether a UI command reported a failure inside a resolved promise.
   *
   * `needs_user_input` is deliberately not a failure: the command did what it
   * could and handed the decision to the person, which the narration already
   * describes correctly.
   */
  private uiCommandFailed(summary: string): boolean {
    if (!summary.includes('"status"') && !summary.includes('"error"')) {
      return false;
    }
    try {
      const parsed = JSON.parse(summary) as {
        status?: unknown;
        error?: unknown;
      };
      return parsed?.status === 'error' || typeof parsed?.error === 'string';
    } catch {
      return false;
    }
  }

  /**
   * A `tool_result` whose summary is a confirmation envelope rather than data.
   * Returns `null` for ordinary results, which is the common case.
   */
  private readProposal(summary?: string): {
    confirmation_token: string;
    arguments?: Record<string, unknown>;
    preview?: VexiProposalPreview;
  } | null {
    if (!summary || !summary.includes('confirmation_token')) return null;
    try {
      const parsed = JSON.parse(summary);
      return parsed?.requires_confirmation && parsed?.confirmation_token
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  /**
   * The id of a job `queue_task` just enqueued, or `null` for every other result.
   *
   * Reads `queued === true` and not merely the presence of `task_id`, because the
   * refusal path (`queued: false`, an active job already running) carries no id and
   * must not put a strip on screen for work that never started.
   */
  private readQueuedTask(
    name: string,
    summary?: string,
  ): { taskId: number; goal?: string } | null {
    if (name !== 'queue_task' || !summary) return null;
    try {
      const parsed = JSON.parse(summary) as {
        queued?: unknown;
        task_id?: unknown;
        goal?: unknown;
      };
      return parsed?.queued === true && typeof parsed.task_id === 'number'
        ? {
            taskId: parsed.task_id,
            goal: typeof parsed.goal === 'string' ? parsed.goal : undefined,
          }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Whether a poll reading says the job is over.
   *
   * `live_status` (BullMQ) wins over the persisted `status` because the job settles
   * before the `vexi.task.finished` listener writes the row; trusting only the row
   * would keep polling a job that already finished.
   *
   * A failed poll is deliberately NOT settled: the network hiccuped, the job did not
   * end, so the poller keeps trying.
   */
  private taskSettled(
    action:
      | ReturnType<typeof VexiActions.pollTaskSuccess>
      | ReturnType<typeof VexiActions.pollTaskFailure>,
  ): boolean {
    if (action.type !== VexiActions.pollTaskSuccess.type) return false;
    const task = action.task;
    return VexiEffects.TERMINAL_TASK_STATES.includes(
      task.live_status ?? task.status,
    );
  }

  /**
   * Follows a queued job until it settles.
   *
   * Polling rather than SSE on purpose: the job's lifetime is unrelated to the turn
   * that started it — it can outlive the panel being open — and a second event-stream
   * per background job would hold a connection open for minutes for a payload that
   * changes twice.
   *
   * `switchMap` is what makes a newer task cancel the previous poller, so two strips
   * can never fight over the same slot.
   */
  pollTask$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.taskQueued),
      switchMap(({ taskId }) =>
        interval(VexiEffects.TASK_POLL_MS).pipe(
          startWith(0),
          switchMap(() =>
            this.chatApi.getTask(taskId).pipe(
              map((task) => VexiActions.pollTaskSuccess({ task })),
              catchError((error) =>
                of(
                  VexiActions.pollTaskFailure({
                    error:
                      error?.message ??
                      'No pude consultar el estado del trabajo.',
                  }),
                ),
              ),
            ),
          ),
          // Stops on the first terminal reading. `takeWhile(..., true)` keeps that
          // last emission, so the strip shows the outcome instead of freezing on
          // the previous "corriendo".
          takeWhile((action) => !this.taskSettled(action), true),
          // Only `dismissTask` needs an explicit stop; a newer `taskQueued` is
          // already cancelled by the outer `switchMap`.
          takeUntil(this.actions$.pipe(ofType(VexiActions.dismissTask))),
        ),
      ),
    ),
  );

  archiveConversation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.archiveConversation),
      mergeMap(({ conversationId }) =>
        this.chatApi.archiveConversation(conversationId).pipe(
          map(() =>
            VexiActions.archiveConversationSuccess({ conversationId }),
          ),
          catchError((error) =>
            of(
              VexiActions.archiveConversationFailure({
                error: error?.message || 'Failed to archive conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
