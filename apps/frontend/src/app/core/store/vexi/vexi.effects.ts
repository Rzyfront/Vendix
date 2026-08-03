import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import {
  switchMap,
  map,
  catchError,
  mergeMap,
  startWith,
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

@Injectable()
export class VexiEffects {
  private actions$ = inject(Actions);
  private chatApi = inject(VexiApiService);
  private store = inject(Store);
  private uiContext = inject(VexiUiContextService);
  private uiCommands = inject(VexiUiCommandService);

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
      switchMap(({ content, appKey }) =>
        this.chatApi.createConversation({ app_key: appKey }).pipe(
          switchMap((conversation) =>
            of(
              VexiActions.createConversationSuccess({ conversation }),
              VexiActions.sendMessage({
                conversationId: conversation.id,
                content,
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
      switchMap(({ conversationId, content }) =>
        this.chatApi
          .createStreamIntent(conversationId, content, this.uiContext.build())
          .pipe(
            switchMap((streamId) =>
              this.streamTurn(conversationId, streamId),
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
      withLatestFrom(this.facadeProposal$),
      switchMap(([, proposal]) => {
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
  ): Observable<Action> {
    const url = this.chatApi.getStreamUrl(conversationId, streamId);

    if (!url) {
      return of(
        VexiActions.streamError({
          error: 'Sesión no válida. Vuelve a iniciar sesión.',
        }),
      );
    }

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
                .then((summary) =>
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
                  ),
                )
                .catch(() =>
                  subscriber.next(
                    VexiActions.toolCallFinished({
                      id,
                      name,
                      summary: 'El comando de interfaz falló.',
                      failed: true,
                    }),
                  ),
                );
            }
            break;
          }

          case 'tool_result': {
            if (!chunk.tool) break;
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

          case 'done':
            subscriber.next(VexiActions.streamComplete());
            subscriber.complete();
            break;

          case 'error':
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
