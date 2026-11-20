import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  output,
  viewChild,
} from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { UserAvatarComponent } from '../../../../../../shared/components/user-avatar/user-avatar.component';
import { VexChatStore } from '../../state/vex-chat.store';

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
    IconComponent,
    UserAvatarComponent,
    InputsearchComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <aside
      id="vex-chats-panel"
      aria-label="Chats"
      class="h-full flex flex-col overflow-hidden bg-[var(--color-surface)] border-r border-[var(--color-border)] text-[var(--color-text-primary)] transition-[width] duration-200"
      [class.w-72]="!collapsed()"
      [class.w-14]="collapsed()"
    >
      @if (collapsed()) {
        <div class="flex flex-col items-center gap-1 py-3">
          <img src="assets/vex/vexicon-96.webp" alt="" class="w-7 h-7 mb-2" />
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            title="Abrir chats"
            aria-label="Abrir chats"
            aria-controls="vex-chats-panel"
            [attr.aria-expanded]="false"
            (click)="collapsed.set(false)"
          >
            <app-icon name="panel-left-open" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            title="Nuevo chat"
            aria-label="Nuevo chat"
            (click)="onNewChat()"
          >
            <app-icon name="square-pen" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            title="Buscar chats"
            aria-label="Buscar chats"
            (click)="collapsed.set(false)"
          >
            <app-icon name="search" [size]="18" />
          </button>
        </div>
      } @else {
        <div class="flex items-center justify-between gap-2 px-3 py-3 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <img src="assets/vex/vexicon-96.webp" alt="" class="w-7 h-7" />
            <span class="font-semibold">Vex</span>
          </div>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            title="Cerrar chats"
            aria-label="Cerrar chats"
            aria-controls="vex-chats-panel"
            [attr.aria-expanded]="true"
            (click)="onClose()"
          >
            <app-icon name="panel-left-close" [size]="18" />
          </button>
        </div>

        <div class="px-3 pb-2 flex flex-col gap-2 shrink-0">
          <button
            type="button"
            class="w-full min-h-10 flex items-center gap-2 px-3 rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            (click)="onNewChat()"
          >
            <app-icon name="square-pen" [size]="18" />
            <span>Nuevo chat</span>
          </button>
          <app-inputsearch
            size="sm"
            placeholder="Buscar chats"
            ariaLabel="Buscar chats"
            [debounceTime]="0"
            (searchChange)="onSearch($event)"
          />
        </div>

        <div #scroller class="flex-1 overflow-y-auto px-2 pb-2">
          <p
            class="px-2 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            {{ chat_store.search_term().trim() ? 'Resultados' : 'Recientes' }}
          </p>
          @for (conversation of chat_store.conversations(); track conversation.id) {
            <div
              class="group relative flex items-center rounded-lg cursor-pointer min-h-10 hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
              [style.background-color]="conversation.id === chat_store.active_id() ? 'rgba(var(--color-primary-rgb),0.12)' : null"
              (click)="onSelect(conversation.id)"
            >
              <button
                type="button"
                class="flex-1 min-w-0 text-left px-3 py-2 text-sm truncate"
                [class.font-medium]="conversation.id === chat_store.active_id()"
                [attr.aria-current]="conversation.id === chat_store.active_id() ? 'true' : null"
                [title]="conversation.title"
              >
                {{ conversation.title }}
              </button>
              <button
                type="button"
                class="shrink-0 w-10 h-10 mr-0.5 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-error)]"
                aria-label="Eliminar chat"
                (click)="onDelete($event, conversation.id)"
              >
                <app-icon name="trash-2" [size]="16" />
              </button>
            </div>
          } @empty {
            @if (chat_store.loading_list()) {
              <app-spinner size="sm" text="Cargando chats…" [center]="true" />
            } @else {
              <app-empty-state
                size="xsm"
                icon="search"
                [title]="chat_store.search_term().trim() ? 'Sin resultados' : 'Aún no hay chats'"
                [description]="chat_store.search_term().trim() ? 'Prueba con otra palabra.' : 'Tu primer chat con Vex aparecerá aquí.'"
                [showActionButton]="false"
              />
            }
          }
          @if (chat_store.has_more()) {
            <div #sentinel class="h-6" aria-hidden="true"></div>
          }
          @if (chat_store.loading_more()) {
            <div role="status" aria-live="polite">
              <app-spinner size="sm" text="Cargando más chats…" [center]="true" />
            </div>
          }
        </div>

        <div
          class="shrink-0 flex items-center gap-3 px-3 py-3 border-t border-[var(--color-border)]"
        >
          <div
            class="w-9 h-9 shrink-0 rounded-full bg-[rgba(var(--color-primary-rgb),0.12)] text-[var(--color-primary)] flex items-center justify-center text-sm font-semibold"
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
              <p class="text-xs text-[var(--color-text-secondary)] truncate">
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
  readonly chat_store = inject(VexChatStore);
  readonly auth = inject(AuthFacade);

  readonly collapsed = model<boolean>(false);
  readonly conversationSelected = output<void>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

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
    if (!user) return 'Usuario';
    const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return full || user.username || user.email || 'Usuario';
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
    this.chat_store.selectConversation(id);
    this.conversationSelected.emit();
  }

  onDelete(event: Event, id: string): void {
    event.stopPropagation();
    this.chat_store.deleteConversation(id);
  }

  onSearch(term: string): void {
    this.chat_store.setSearchTerm(term);
  }
}
