import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { switchMap, map, catchError, mergeMap } from 'rxjs/operators';
import * as VexiActions from './vexi.actions';
import { VexiApiService } from '../../services/vexi-api.service';

@Injectable()
export class VexiEffects {
  private actions$ = inject(Actions);
  private chatApi = inject(VexiApiService);

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

  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(VexiActions.sendMessage),
      switchMap(({ conversationId, content }) =>
        this.chatApi.sendMessage(conversationId, content).pipe(
          map((response) =>
            VexiActions.sendMessageSuccess({
              userMessage: response.user_message,
              assistantMessage: response.assistant_message,
            }),
          ),
          catchError((error) =>
            of(
              VexiActions.sendMessageFailure({
                error: error.message || 'Failed to send message',
              }),
            ),
          ),
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
