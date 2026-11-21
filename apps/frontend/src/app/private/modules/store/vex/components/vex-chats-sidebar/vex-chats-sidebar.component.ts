import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { UserAvatarComponent } from '../../../../../../shared/components/user-avatar/user-avatar.component';
import { VexChatStore } from '../../state/vex-chat.store';
import {
  VEX_PURGE_RUNNING_MESSAGE,
  purgeConfirmMessage,
} from '../../state/vex-conversation-purge.util';
import { groupConversationsByDate } from '../../state/vex-conversation-groups.util';
import { VEX_COPY } from '../../vex-copy';
import { VexTitleEditorComponent } from '../vex-title-editor/vex-title-editor.component';

interface VexSidebarUser {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

@Component({
  selector: 'vendix-vex-chats-sidebar',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    UserAvatarComponent,
    InputsearchComponent,
    SpinnerComponent,
    EmptyStateComponent,
    VexTitleEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <aside
      id="vex-chats-panel"
      [attr.aria-label]="copy.panel_label"
      class="h-full flex flex-col overflow-hidden bg-surface border-r border-border text-text-primary transition-[width] duration-200"
      [class.w-72]="!collapsed()"
      [class.w-14]="collapsed()"
    >
      @if (collapsed()) {
        <div class="flex flex-col items-center gap-1 py-3">
          <img src="assets/vex/vexicon-96.webp" alt="" class="w-7 h-7 mb-2" />
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [attr.title]="copy.open"
            [attr.aria-label]="copy.open"
            aria-controls="vex-chats-panel"
            [attr.aria-expanded]="false"
            (click)="collapsed.set(false)"
          >
            <app-icon name="panel-left-open" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [attr.title]="copy.new_chat"
            [attr.aria-label]="copy.new_chat"
            (click)="onNewChat()"
          >
            <app-icon name="square-pen" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [attr.title]="copy.search"
            [attr.aria-label]="copy.search"
            (click)="collapsed.set(false)"
          >
            <app-icon name="search" [size]="18" />
          </button>
        </div>
      } @else {
        <div class="flex items-center justify-between gap-2 px-3 py-3 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <img src="assets/vex/vexicon-96.webp" alt="" class="w-7 h-7" />
            <span class="font-semibold">{{ copy.brand }}</span>
          </div>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [attr.title]="copy.close_panel"
            [attr.aria-label]="copy.close_panel"
            aria-controls="vex-chats-panel"
            [attr.aria-expanded]="true"
            (click)="onClose()"
          >
            <app-icon name="panel-left-close" [size]="18" />
          </button>
        </div>

        <div class="px-3 pb-2 flex flex-col gap-2 shrink-0">
          <app-button
            variant="outline"
            size="md"
            [fullWidth]="true"
            customClasses="min-h-10"
            (clicked)="onNewChat()"
          >
            <app-icon slot="icon" name="square-pen" [size]="18" />
            {{ copy.new_chat }}
          </app-button>
          <app-inputsearch
            size="sm"
            [placeholder]="copy.search"
            [ariaLabel]="copy.search"
            [debounceTime]="0"
            (searchChange)="onSearch($event)"
          />
        </div>

        <div #scroller class="flex-1 overflow-y-auto px-2 pb-2">
          @for (group of groups(); track group.key) {
            <section role="group" [attr.aria-labelledby]="'vex-chat-group-' + group.key">
              <h3
                [id]="'vex-chat-group-' + group.key"
                class="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-text-secondary"
              >
                {{ group.label }}
              </h3>
              <ul class="flex flex-col gap-0.5">
                @for (conversation of group.items; track conversation.id) {
                  <li>
                    @if (renaming_id() === conversation.id) {
                      <div class="flex px-1 py-1">
                        <vendix-vex-title-editor
                          [value]="conversation.title"
                          (saved)="onRenameSaved(conversation.id, $event)"
                          (cancelled)="onRenameDone(conversation.id)"
                        />
                      </div>
                    } @else {
                      <div
                        class="group flex items-center rounded-lg min-h-10 hover:bg-text-primary/5"
                        [style.background-color]="conversation.id === chat_store.active_id() ? 'rgba(var(--color-primary-rgb),0.12)' : null"
                      >
                        <button
                          type="button"
                          class="flex-1 min-w-0 min-h-10 text-left px-3 py-2 text-sm truncate rounded-lg"
                          [class.font-medium]="conversation.id === chat_store.active_id()"
                          [attr.aria-current]="conversation.id === chat_store.active_id() ? 'true' : null"
                          [attr.data-vex-chat-title]="conversation.id"
                          [attr.title]="conversation.title"
                          (click)="onSelect(conversation.id)"
                          (dblclick)="startRename(conversation.id)"
                        >
                          {{ conversation.title }}
                        </button>
                        <button
                          type="button"
                          class="shrink-0 w-10 h-10 mr-0.5 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary"
                          [class]="menuTriggerClass(conversation.id)"
                          aria-haspopup="menu"
                          [attr.aria-expanded]="menu_id() === conversation.id"
                          [attr.aria-label]="copy.actions_of(conversation.title)"
                          [attr.data-vex-chat-menu]="conversation.id"
                          (click)="toggleMenu($event, conversation.id)"
                          (keydown.arrowdown)="openMenu($event, conversation.id)"
                        >
                          <app-icon name="more-horizontal" [size]="16" />
                        </button>
                      </div>
                      @if (menu_id() === conversation.id) {
                        <div
                          role="menu"
                          [attr.aria-label]="copy.menu_label"
                          class="mx-2 mb-1 flex flex-col rounded-lg border border-border bg-background p-1"
                          (keydown)="onMenuKeydown($event, conversation.id)"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            class="min-h-10 flex items-center gap-2 px-3 rounded-md text-sm text-left hover:bg-text-primary/5 focus-visible:bg-text-primary/5"
                            (click)="startRename(conversation.id)"
                          >
                            <app-icon name="pencil" [size]="16" />
                            <span>{{ copy.rename }}</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            class="min-h-10 flex items-center gap-2 px-3 rounded-md text-sm text-left text-error hover:bg-error/10 focus-visible:bg-error/10"
                            (click)="onDelete(conversation.id)"
                          >
                            <app-icon name="trash-2" [size]="16" />
                            <span>{{ copy.delete }}</span>
                          </button>
                        </div>
                      }
                    }
                  </li>
                }
              </ul>
            </section>
          } @empty {
            @if (chat_store.loading_list()) {
              <app-spinner size="sm" [text]="copy.loading" [center]="true" />
            } @else {
              <app-empty-state
                size="xsm"
                icon="search"
                [title]="chat_store.search_term().trim() ? copy.empty_search_title : copy.empty_title"
                [description]="chat_store.search_term().trim() ? copy.empty_search_description : copy.empty_description"
                [showActionButton]="false"
              />
            }
          }
          @if (chat_store.has_more() && !chat_store.load_more_failed()) {
            <div #sentinel class="h-6" aria-hidden="true"></div>
          }
          @if (chat_store.load_more_failed()) {
            <div
              role="status"
              class="flex flex-wrap items-center justify-center gap-2 px-2 py-3 text-xs text-text-secondary"
            >
              <span>{{ copy.load_more_failed }}</span>
              <app-button
                variant="ghost"
                size="sm"
                (clicked)="chat_store.retryLoadMore()"
              >
                {{ copy.retry }}
              </app-button>
            </div>
          }
          @if (chat_store.loading_more()) {
            <div role="status" aria-live="polite">
              <app-spinner size="sm" [text]="copy.loading_more" [center]="true" />
            </div>
          }
        </div>

        <div
          class="shrink-0 flex items-center gap-3 px-3 py-3 border-t border-border"
        >
          <div
            class="w-9 h-9 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold"
          >
            <app-user-avatar
              [src]="current_user()?.avatar_url"
              [initials]="initials()"
              [alt]="display_name()"
            ></app-user-avatar>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium truncate">{{ display_name() }}</p>
            @if (auth.userStoreName(); as store_name) {
              <p class="text-xs text-text-secondary truncate">
                {{ store_name }}
              </p>
            }
          </div>
        </div>
      }
    </aside>
  `,
})
export class VexChatsSidebarComponent {
  protected readonly copy = VEX_COPY.chats;
  readonly chat_store = inject(VexChatStore);
  readonly auth = inject(AuthFacade);

  readonly collapsed = model<boolean>(false);
  readonly conversationSelected = output<void>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  readonly renaming_id = signal<string | null>(null);
  readonly menu_id = signal<string | null>(null);

  /** Chat list grouped by last activity in local time: Hoy, Ayer, Últimos 7 días, months. */
  readonly groups = computed(() =>
    groupConversationsByDate(this.chat_store.conversations()),
  );

  private readonly dialog = inject(DialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    // Progressive loading: the sentinel at the end of the list asks for the
    // next page when it scrolls into view. The observer is rebuilt after each
    // page so a sentinel still in view (short list) fires again.
    effect((onCleanup) => {
      const el = this.sentinel()?.nativeElement;
      this.chat_store.conversations();
      this.chat_store.loading_more();
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.chat_store.loadMore();
          }
        },
        { root: this.scroller()?.nativeElement ?? null, rootMargin: '120px' },
      );
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
  }

  protected readonly current_user = computed<VexSidebarUser | null>(
    () => (this.auth.user() as VexSidebarUser | null) ?? null,
  );

  readonly display_name = computed(() => {
    const user = this.current_user();
    if (!user) return this.copy.user_fallback;
    const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return full || user.username || user.email || this.copy.user_fallback;
  });

  readonly initials = computed(() => {
    const user = this.current_user();
    const first = user?.first_name?.trim().charAt(0) ?? '';
    const last = user?.last_name?.trim().charAt(0) ?? '';
    const letters = `${first}${last}`;
    if (letters) return letters.toUpperCase();
    return (this.display_name().charAt(0) || 'U').toUpperCase();
  });

  /** Closing the panel also drops the search, so reopening shows the full list. */
  onClose(): void {
    this.chat_store.setSearchTerm('');
    this.collapsed.set(true);
  }

  onNewChat(): void {
    this.chat_store.newConversation();
    this.conversationSelected.emit();
  }

  onSelect(id: string): void {
    if (id !== this.chat_store.active_id()) {
      this.chat_store.selectConversation(id);
    }
    this.conversationSelected.emit();
  }

  /**
   * Real deletion: reads what would be erased, asks with the shared
   * confirmation dialog and only then deletes. A running task blocks it.
   */
  async onDelete(id: string): Promise<void> {
    this.menu_id.set(null);
    const preview = await this.chat_store.previewPurge(id);
    if (!preview) return;
    if (preview.has_running_task) {
      await this.explainRunningTask(id);
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: this.copy.delete_title,
      message: purgeConfirmMessage(preview),
      confirmText: this.copy.delete_confirm,
      cancelText: this.copy.cancel,
      confirmVariant: 'danger',
    });
    if (!confirmed) {
      this.focusAfterRender(`[data-vex-chat-title="${id}"]`);
      return;
    }
    const result = await this.chat_store.purgeConversation(id);
    if (result === 'running') await this.explainRunningTask(id);
  }

  /** The conversation has a task running: nothing is deleted; offers to stop it when the store can. */
  private async explainRunningTask(id: string): Promise<void> {
    const can_stop =
      this.chat_store.active_id() === id && this.chat_store.is_agent_typing();
    const accepted = await this.dialog.confirm({
      title: this.copy.running_title,
      message: VEX_PURGE_RUNNING_MESSAGE,
      confirmText: can_stop ? this.copy.stop_task : this.copy.understood,
      cancelText: can_stop ? this.copy.cancel : this.copy.close,
      confirmVariant: 'primary',
    });
    if (accepted && can_stop) this.chat_store.stopStream();
  }

  // ── Rename ──────────────────────────────────────────────────────────

  startRename(id: string): void {
    this.menu_id.set(null);
    this.renaming_id.set(id);
  }

  async onRenameSaved(id: string, title: string): Promise<void> {
    this.onRenameDone(id);
    await this.chat_store.renameConversation(id, title);
  }

  /** Closes the editor and returns focus to the row it came from. */
  onRenameDone(id: string): void {
    this.renaming_id.set(null);
    this.focusAfterRender(`[data-vex-chat-title="${id}"]`);
  }

  // ── Row actions menu ────────────────────────────────────────────────

  /** The trigger shows on hover/focus on desktop and always on touch; it stays while its menu is open. */
  menuTriggerClass(id: string): string {
    return this.menu_id() === id
      ? 'lg:opacity-100'
      : 'lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100';
  }

  toggleMenu(event: Event, id: string): void {
    event.stopPropagation();
    if (this.menu_id() === id) {
      this.menu_id.set(null);
      return;
    }
    this.openMenu(event, id);
  }

  openMenu(event: Event, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.menu_id.set(id);
    afterNextRender(
      () => this.menuItems(id)[0]?.focus(),
      { injector: this.injector },
    );
  }

  onMenuKeydown(event: KeyboardEvent, id: string): void {
    const items = this.menuItems(id);
    const index = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        return;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        return;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        return;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.menu_id.set(null);
        this.focusAfterRender(`[data-vex-chat-menu="${id}"]`);
        return;
      case 'Tab':
        this.menu_id.set(null);
        return;
    }
  }

  onDocumentClick(event: Event): void {
    if (this.menu_id() === null) return;
    const target = event.target as Element | null;
    if (target?.closest('[role="menu"]')) return;
    this.menu_id.set(null);
  }

  private menuItems(id: string): HTMLElement[] {
    const trigger = this.host.nativeElement.querySelector(
      `[data-vex-chat-menu="${id}"]`,
    );
    const menu = trigger?.closest('li')?.querySelector('[role="menu"]');
    return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector },
    );
  }

  onSearch(term: string): void {
    this.chat_store.setSearchTerm(term);
  }
}
