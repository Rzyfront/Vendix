import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../../../shared/components';
import { CrmConversation, CrmMessage } from '../crm-inbox.interface';
import {
  CHANNEL_META,
  CONVERSATION_STATUS_META,
  MESSAGE_STATUS_META,
  conversationTitle,
  groupByDay,
  initials,
  personName,
  timeLabel,
} from '../crm-inbox.utils';
import { MessageComposerComponent } from './message-composer.component';

export type ThreadAction = 'assign' | 'close' | 'reopen' | 'read';

/** Right pane of the inbox: header, message history and reply box. */
@Component({
  selector: 'app-crm-conversation-thread',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    EmptyStateComponent,
    IconComponent,
    MessageComposerComponent,
  ],
  template: `
    @let c = conversation();
    <div class="flex h-full min-h-0 flex-col">
      <!-- Header -->
      <header
        class="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-3"
      >
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-primary/10 lg:hidden"
          aria-label="Volver a la lista"
          (click)="back.emit()"
        >
          <app-icon name="arrow-left" [size]="18"></app-icon>
        </button>
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          aria-hidden="true"
        >
          {{ avatar() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            @if (c.customer) {
              <a
                class="truncate text-sm font-bold text-[var(--color-text-primary)] hover:text-primary hover:underline"
                [routerLink]="['/admin/customers', c.customer.id]"
                >{{ title() }}</a
              >
            } @else {
              <h2 class="truncate text-sm font-bold text-[var(--color-text-primary)]">
                {{ title() }}
              </h2>
            }
            <app-badge [variant]="statusMeta().variant" size="xsm">
              {{ statusMeta().label }}
            </app-badge>
          </div>
          <div
            class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]"
          >
            <span class="inline-flex items-center gap-1">
              <app-icon [name]="channel().icon" [size]="12"></app-icon>
              {{ channel().label }} · {{ c.contact_address }}
            </span>
            <span class="inline-flex items-center gap-1">
              <app-icon name="user" [size]="12"></app-icon>
              {{ assignee() || 'Sin asignar' }}
            </span>
            @if (c.channel === 'whatsapp') {
              <span
                class="inline-flex items-center gap-1"
                [class.text-warning]="!c.window_open"
              >
                <app-icon name="clock" [size]="12"></app-icon>
                {{ windowLabel() }}
              </span>
            }
          </div>
        </div>
        <div class="flex items-center gap-1">
          @if (c.unread_count > 0) {
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-primary/5 disabled:opacity-50"
              [disabled]="busy() !== null"
              (click)="action.emit('read')"
            >
              <app-icon name="check-check" [size]="12"></app-icon>
              <span class="hidden sm:inline">Marcar leído</span>
            </button>
          }
          @if (canAssign()) {
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-primary/5 disabled:opacity-50"
              [disabled]="busy() !== null"
              (click)="action.emit('assign')"
            >
              <app-icon name="user-plus" [size]="12"></app-icon>
              <span class="hidden sm:inline">Asignar</span>
            </button>
          }
          @if (canReply()) {
            @if (c.status === 'closed') {
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-3 text-xs font-semibold text-primary-on-tint hover:bg-primary/15 disabled:opacity-50"
                [disabled]="busy() !== null"
                (click)="action.emit('reopen')"
              >
                <app-icon
                  [name]="busy() === 'reopen' ? 'loader-2' : 'rotate-ccw'"
                  [spin]="busy() === 'reopen'"
                  [size]="12"
                ></app-icon>
                Reabrir
              </button>
            } @else {
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-primary/5 disabled:opacity-50"
                [disabled]="busy() !== null"
                (click)="action.emit('close')"
              >
                <app-icon
                  [name]="busy() === 'close' ? 'loader-2' : 'circle-check'"
                  [spin]="busy() === 'close'"
                  [size]="12"
                ></app-icon>
                Cerrar
              </button>
            }
          }
        </div>
      </header>

      <!-- Messages -->
      <div
        #scroller
        class="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-4"
        aria-live="polite"
        aria-label="Mensajes"
      >
        @if (error()) {
          <app-empty-state
            size="sm"
            icon="triangle-alert"
            iconColor="error"
            title="No pudimos cargar los mensajes"
            [description]="error() ?? ''"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="retry.emit()"
          ></app-empty-state>
        } @else if (loading() && messages().length === 0) {
          <div
            class="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-secondary)]"
          >
            <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
            Cargando mensajes…
          </div>
        } @else if (messages().length === 0) {
          <app-empty-state
            size="sm"
            icon="message-circle"
            title="Sin mensajes todavía"
            description="Escribe el primer mensaje o deja una nota para tu equipo."
            [showActionButton]="false"
          ></app-empty-state>
        } @else {
          @if (hasMore()) {
            <div class="mb-4 flex justify-center">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] bg-surface px-3 text-xs font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
                [disabled]="loadingOlder()"
                (click)="loadOlder.emit()"
              >
                {{ loadingOlder() ? 'Cargando…' : 'Ver mensajes anteriores' }}
              </button>
            </div>
          }
          @for (group of groups(); track group.key) {
            <div class="my-3 flex items-center gap-3" role="separator">
              <span class="h-px flex-1 bg-[var(--color-border)]"></span>
              <span
                class="rounded-full border border-[var(--color-border)] bg-surface px-3 py-1 text-xs font-semibold capitalize text-[var(--color-text-secondary)]"
              >
                {{ group.label }}
              </span>
              <span class="h-px flex-1 bg-[var(--color-border)]"></span>
            </div>
            @for (message of group.messages; track message.id) {
              @if (message.channel === 'internal_note') {
                <div class="my-2 flex justify-center">
                  <div
                    class="w-full max-w-xl rounded-2xl border border-dashed border-warning/25 bg-warning/10 px-4 py-3"
                  >
                    <div
                      class="mb-1 flex items-center gap-1 text-xs font-semibold text-warning"
                    >
                      <app-icon name="sticky-note" [size]="12"></app-icon>
                      Nota interna · {{ author(message) }}
                    </div>
                    <p
                      class="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]"
                    >
                      {{ message.body }}
                    </p>
                    <p class="mt-1 text-right text-xs text-[var(--color-text-secondary)]">
                      {{ time(message.created_at) }}
                    </p>
                  </div>
                </div>
              } @else {
                <div
                  class="my-1 flex"
                  [class.justify-end]="message.direction === 'outbound'"
                >
                  <div
                    class="max-w-xs rounded-2xl border px-3 py-2 sm:max-w-md"
                    [class]="
                      message.direction === 'outbound'
                        ? message.status === 'failed'
                          ? 'border-error/25 bg-error/10'
                          : 'border-primary/25 bg-primary/10'
                        : 'border-[var(--color-border)] bg-surface'
                    "
                  >
                    @if (message.template_name) {
                      <p
                        class="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                      >
                        <app-icon name="file-text" [size]="12"></app-icon>
                        Plantilla {{ message.template_name }}
                      </p>
                    }
                    @if (message.body) {
                      <p
                        class="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]"
                      >
                        {{ message.body }}
                      </p>
                    }
                    @for (media of message.media; track $index) {
                      @if (media.url) {
                        @if (media.type === 'image') {
                          <a [href]="media.url" target="_blank" rel="noopener">
                            <img
                              [src]="media.url"
                              [alt]="media.filename || 'Imagen adjunta'"
                              class="mt-1 max-h-60 rounded-xl"
                              loading="lazy"
                            />
                          </a>
                        } @else {
                          <a
                            [href]="media.url"
                            target="_blank"
                            rel="noopener"
                            class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary underline"
                          >
                            <app-icon name="file-text" [size]="12"></app-icon>
                            {{ media.filename || 'Archivo adjunto' }}
                          </a>
                        }
                      } @else {
                        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                          [{{ media.type || 'adjunto' }} no disponible]
                        </p>
                      }
                    }
                    <div
                      class="mt-1 flex items-center justify-end gap-1 text-xs text-[var(--color-text-secondary)]"
                    >
                      @if (message.direction === 'outbound' && message.sent_by) {
                        <span class="truncate">{{ author(message) }} ·</span>
                      }
                      <span>{{ time(message.created_at) }}</span>
                      @if (message.direction === 'outbound') {
                        <span
                          class="inline-flex items-center gap-0.5"
                          [class.text-primary]="message.status === 'read'"
                          [class.text-error]="message.status === 'failed'"
                          [attr.title]="statusLabel(message)"
                        >
                          <app-icon [name]="statusIcon(message)" [size]="12"></app-icon>
                          <span>{{ statusLabel(message) }}</span>
                        </span>
                      }
                    </div>
                    @if (message.status === 'failed' && message.error_message) {
                      <p class="mt-1 text-xs text-error">{{ message.error_message }}</p>
                    }
                  </div>
                </div>
              }
            }
          }
        }
      </div>

      <app-crm-message-composer
        [conversation]="c"
        [canReply]="canReply()"
        (sent)="sent.emit($event)"
      ></app-crm-message-composer>
    </div>
  `,
})
export class ConversationThreadComponent {
  readonly conversation = input.required<CrmConversation>();
  readonly messages = input.required<CrmMessage[]>();
  readonly loading = input(false);
  readonly loadingOlder = input(false);
  readonly hasMore = input(false);
  readonly error = input<string | null>(null);
  readonly canReply = input(false);
  readonly canAssign = input(false);
  readonly busy = input<ThreadAction | null>(null);

  readonly back = output<void>();
  readonly retry = output<void>();
  readonly loadOlder = output<void>();
  readonly action = output<ThreadAction>();
  readonly sent = output<CrmMessage>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly title = computed(() => conversationTitle(this.conversation()));
  protected readonly avatar = computed(() => initials(this.title()));
  protected readonly assignee = computed(() =>
    personName(this.conversation().assigned_user),
  );
  protected readonly channel = computed(
    () => CHANNEL_META[this.conversation().channel] ?? CHANNEL_META.whatsapp,
  );
  protected readonly statusMeta = computed(
    () =>
      CONVERSATION_STATUS_META[this.conversation().status] ??
      CONVERSATION_STATUS_META.open,
  );
  protected readonly groups = computed(() => groupByDay(this.messages()));
  private readonly lastMessageId = computed(
    () => this.messages()[this.messages().length - 1]?.id ?? null,
  );

  protected readonly windowLabel = computed(() => {
    const c = this.conversation();
    if (!c.window_open || !c.window_expires_at) return 'Ventana de 24 h cerrada';
    return `Ventana abierta hasta ${timeLabel(c.window_expires_at)}`;
  });

  constructor() {
    // Stick to the newest message when one arrives (older pages keep position).
    effect(() => {
      const last = this.lastMessageId();
      const element = this.scroller()?.nativeElement;
      if (last === null || !element) return;
      untracked(() =>
        requestAnimationFrame(() => {
          element.scrollTop = element.scrollHeight;
        }),
      );
    });
  }

  protected time(iso: string): string {
    return timeLabel(iso);
  }

  protected author(message: CrmMessage): string {
    return personName(message.sent_by) || 'Equipo';
  }

  protected statusIcon(message: CrmMessage): string {
    return MESSAGE_STATUS_META[message.status]?.icon ?? 'clock';
  }

  protected statusLabel(message: CrmMessage): string {
    return MESSAGE_STATUS_META[message.status]?.label ?? message.status;
  }
}
