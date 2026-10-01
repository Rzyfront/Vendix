import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { VexChatsSidebarComponent } from './components/vex-chats-sidebar/vex-chats-sidebar.component';
import { VexLogSidebarComponent } from './components/vex-log-sidebar/vex-log-sidebar.component';
import { VexComposerComponent } from './components/vex-composer/vex-composer.component';
import { VexThreadComponent } from './components/vex-thread/vex-thread.component';
import { VexWelcomeComponent } from './components/vex-welcome/vex-welcome.component';
import { VexChatStore } from './state/vex-chat.store';
import { VexLogStore } from './state/vex-log.store';

const DESKTOP_QUERY = '(min-width: 1024px)';
const CHATS_KEY = 'vex.chats_collapsed';
const LOG_KEY = 'vex.log_collapsed';

function isDesktop(): boolean {
  try {
    return (
      typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
    );
  } catch {
    return false;
  }
}

function readFlag(key: string): boolean {
  if (!isDesktop()) return true;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (!isDesktop()) return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // storage no disponible: se ignora
  }
}

@Component({
  selector: 'vendix-vex-page',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    VexChatsSidebarComponent,
    VexLogSidebarComponent,
    VexComposerComponent,
    VexThreadComponent,
    VexWelcomeComponent,
  ],
  providers: [VexChatStore, VexLogStore],
  template: `
    <div
      class="h-dvh w-full flex overflow-hidden bg-[var(--color-background)] text-[var(--color-text-primary)]"
    >
      @if (!chats_collapsed()) {
        <div
          class="fixed inset-0 bg-black/40 z-30 lg:hidden"
          (click)="chats_collapsed.set(true)"
        ></div>
      }
      @if (!log_collapsed()) {
        <div
          class="fixed inset-0 bg-black/40 z-30 lg:hidden"
          (click)="log_collapsed.set(true)"
        ></div>
      }

      <div
        [class]="
          chats_collapsed()
            ? 'hidden lg:flex shrink-0'
            : 'fixed inset-y-0 left-0 z-40 flex lg:static lg:z-auto shrink-0'
        "
      >
        <vendix-vex-chats-sidebar
          [(collapsed)]="chats_collapsed"
          (conversationSelected)="onConversationSelected()"
        />
      </div>

      <main class="relative flex-1 min-w-0 flex flex-col">
        <div
          class="absolute inset-0 pointer-events-none opacity-60 dark:opacity-100"
          style="background: radial-gradient(ellipse 60% 50% at 50% 45%, rgba(59,130,246,0.22), transparent 70%)"
          aria-hidden="true"
        ></div>

        <header class="relative z-10 h-14 shrink-0 flex items-center gap-2 px-2">
          <button
            type="button"
            class="lg:hidden w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            aria-label="Abrir chats"
            (click)="openChats()"
          >
            <app-icon name="menu" [size]="20"></app-icon>
          </button>
          <a
            routerLink="/admin/dashboard"
            class="min-h-10 px-3 rounded-full flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            aria-label="Volver al panel"
          >
            <app-icon name="arrow-left" [size]="18"></app-icon>
            <span>Panel</span>
          </a>
          <span
            class="lg:hidden flex-1 min-w-0 truncate text-right text-sm text-[var(--color-text-secondary)]"
          >
            {{ conversation_title() }}
          </span>
          <span class="hidden lg:block flex-1"></span>
          <button
            type="button"
            class="lg:hidden w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            aria-label="Abrir bitácora"
            (click)="openLog()"
          >
            <app-icon name="history" [size]="20"></app-icon>
          </button>
        </header>

        @if (store.active_conversation()) {
          <div class="relative z-10 flex-1 min-h-0">
            <vendix-vex-thread />
          </div>
          <div class="relative z-10 max-w-3xl mx-auto w-full px-4 pb-4">
            <vendix-vex-composer />
          </div>
        } @else {
          <div
            class="relative z-10 flex-1 flex flex-col items-center justify-center gap-8 max-w-3xl mx-auto w-full px-4 pb-16"
          >
            <vendix-vex-welcome />
            <vendix-vex-composer />
          </div>
        }
      </main>

      <div
        [class]="
          log_collapsed()
            ? 'hidden lg:flex shrink-0'
            : 'fixed inset-y-0 right-0 z-40 flex lg:static lg:z-auto shrink-0'
        "
      >
        <vendix-vex-log-sidebar [(collapsed)]="log_collapsed" />
      </div>
    </div>
  `,
})
export class VexPageComponent {
  readonly store = inject(VexChatStore);

  readonly chats_collapsed = signal<boolean>(readFlag(CHATS_KEY));
  readonly log_collapsed = signal<boolean>(readFlag(LOG_KEY));

  readonly conversation_title = computed(
    () => this.store.active_conversation()?.title ?? '',
  );

  constructor() {
    effect(() => writeFlag(CHATS_KEY, this.chats_collapsed()));
    effect(() => writeFlag(LOG_KEY, this.log_collapsed()));
  }

  openChats(): void {
    this.log_collapsed.set(true);
    this.chats_collapsed.set(false);
  }

  openLog(): void {
    this.chats_collapsed.set(true);
    this.log_collapsed.set(false);
  }

  onConversationSelected(): void {
    if (!isDesktop()) this.chats_collapsed.set(true);
  }
}
