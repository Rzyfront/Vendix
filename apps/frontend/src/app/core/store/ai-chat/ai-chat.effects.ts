import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { switchMap, map, catchError, mergeMap } from 'rxjs/operators';
import * as AIChatActions from './ai-chat.actions';
import { AIChatApiService } from '../../services/ai-chat-api.service';

@Injectable()
export class AIChatEffects {
  private actions$ = inject(Actions);
  private chatApi = inject(AIChatApiService);

  loadConversations$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AIChatActions.loadConversations),
      switchMap(() =>
        this.chatApi.getConversations({ limit: 50 }).pipe(
          map((result) =>
            AIChatActions.loadConversationsSuccess({
              conversations: result.data,
            }),
          ),
          catchError((error) =>
            of(
              AIChatActions.loadConversationsFailure({
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
      ofType(AIChatActions.createConversation),
      switchMap(({ appKey, title }) =>
        this.chatApi.createConversation({ app_key: appKey, title }).pipe(
          map((conversation) =>
            AIChatActions.createConversationSuccess({ conversation }),
          ),
          catchError((error) =>
            of(
              AIChatActions.createConversationFailure({
                error: error?.message || 'Failed to create conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  selectConversation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AIChatActions.selectConversation),
      switchMap(({ conversationId }) =>
        this.chatApi.getConversation(conversationId).pipe(
          map((conversation) =>
            AIChatActions.loadMessagesSuccess({
              messages: conversation.messages || [],
            }),
          ),
          catchError((error) =>
            of(
              AIChatActions.selectConversationFailure({
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
      ofType(AIChatActions.sendMessage),
      switchMap(({ conversationId, content }) =>
        this.chatApi.sendMessage(conversationId, content).pipe(
          map((response) =>
            AIChatActions.sendMessageSuccess({
              userMessage: response.user_message,
              assistantMessage: response.assistant_message,
            }),
          ),
          catchError((error) =>
            of(
              AIChatActions.sendMessageFailure({
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
      ofType(AIChatActions.archiveConversation),
      mergeMap(({ conversationId }) =>
        this.chatApi.archiveConversation(conversationId).pipe(
          map(() =>
            AIChatActions.archiveConversationSuccess({ conversationId }),
          ),
          catchError((error) =>
            of(
              AIChatActions.archiveConversationFailure({
                error: error?.message || 'Failed to archive conversation',
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
