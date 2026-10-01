import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  output,
} from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexChatStore } from '../../state/vex-chat.store';

interface VexSidebarUser {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
}

@Component({
  selector: 'vendix-vex-chats-sidebar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <aside
      class="h-full flex flex-col overflow-hidden bg-[var(--color-surface)] border-r border-[var(--color-border)] text-[var(--color-text-primary)] transition-[width] duration-200"
      [class.w-72]="!collapsed()"
      [class.w-14]="collapsed()"
    >
      @if (collapsed()) {
        <div class="flex flex-col items-center gap-1 py-3">
          <img src="assets/vex/vexicon-96.webp" alt="" class="w-7 h-7 mb-2" />
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/10"
            title="Expandir chats"
            aria-label="Expandir chats"
            (click)="collapsed.set(false)"
          >
            <app-icon name="panel-left-open" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/10"
            title="Nuevo chat"
            aria-label="Nuevo chat"
            (click)="onNewChat()"
          >
            <app-icon name="square-pen" [size]="18" />
          </button>
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/10"
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
            class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Contraer chats"
            (click)="collapsed.set(true)"
          >
            <app-icon name="panel-left-close" [size]="18" />
          </button>
        </div>

        <div class="px-3 pb-2 flex flex-col gap-2 shrink-0">
          <button
            type="button"
            class="w-full min-h-10 flex items-center gap-2 px-3 rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
            (click)="onNewChat()"
          >
            <app-icon name="square-pen" [size]="18" />
            <span>Nuevo chat</span>
          </button>
          <div
            class="flex items-center gap-2 min-h-10 px-3 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)]"
          >
            <app-icon name="search" [size]="18" />
            <input
              type="text"
              class="flex-1 min-w-0 bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
              placeholder="Buscar chats"
              aria-label="Buscar chats"
              [value]="chat_store.search_term()"
              (input)="onSearch($event)"
            />
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-2 pb-2">
          <p
            class="px-2 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]"
          >
            Recientes
          </p>
          @for (conversation of chat_store.filtered_conversations(); track conversation.id) {
            <div
              class="group relative flex items-center rounded-lg cursor-pointer min-h-10 hover:bg-black/5 dark:hover:bg-white/10"
              [class.bg-black/5]="conversation.id === chat_store.active_id()"
              [class.dark:bg-white/10]="conversation.id === chat_store.active_id()"
              (click)="onSelect(conversation.id)"
            >
              <button
                type="button"
                class="flex-1 min-w-0 text-left px-3 py-2 text-sm truncate"
                [class.font-medium]="conversation.id === chat_store.active_id()"
                [title]="conversation.title"
              >
                {{ conversation.title }}
              </button>
              <button
                type="button"
                class="shrink-0 w-10 h-10 mr-0.5 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-rose-500"
                aria-label="Eliminar chat"
                (click)="onDelete($event, conversation.id)"
              >
                <app-icon name="trash-2" [size]="16" />
              </button>
            </div>
          } @empty {
            <p class="px-3 py-4 text-sm text-[var(--color-text-secondary)]">
              Sin resultados
            </p>
          }
        </div>

        <div
          class="shrink-0 flex items-center gap-3 px-3 py-3 border-t border-[var(--color-border)]"
        >
          <div
            class="w-9 h-9 shrink-0 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 flex items-center justify-center text-sm font-semibold"
          >
            {{ initials() }}
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

  private readonly current_user = computed<VexSidebarUser | null>(
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

  onSearch(event: Event): void {
    this.chat_store.setSearchTerm((event.target as HTMLInputElement).value);
  }
}
