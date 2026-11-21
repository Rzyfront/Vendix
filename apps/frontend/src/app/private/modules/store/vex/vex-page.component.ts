import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { VexChatsSidebarComponent } from './components/vex-chats-sidebar/vex-chats-sidebar.component';
import { VexLogSidebarComponent } from './components/vex-log-sidebar/vex-log-sidebar.component';
import { VexComposerComponent } from './components/vex-composer/vex-composer.component';
import { VexTitleEditorComponent } from './components/vex-title-editor/vex-title-editor.component';
import { VexThreadComponent } from './components/vex-thread/vex-thread.component';
import { VexWelcomeComponent } from './components/vex-welcome/vex-welcome.component';
import { VexChatStore } from './state/vex-chat.store';
import { VexLogStore } from './state/vex-log.store';
import { VexPresenceStore } from './state/vex-presence.store';
import { VexPresenceComponent } from './components/vex-presence/vex-presence.component';
import { VexHelpComponent } from './components/vex-help/vex-help.component';
import { TourModalComponent } from '../../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../../shared/components/tour/services/tour.service';
import { VEX_TOUR_CONFIG } from '../../../../shared/components/tour/configs/vex-tour.config';
import { VEX_COPY } from './vex-copy';

const DESKTOP_QUERY = '(min-width: 1024px)';
function isDesktop(): boolean {
  try {
    return (
      typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
    );
  } catch {
    return false;
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
    VexTitleEditorComponent,
    VexPresenceComponent,
    VexHelpComponent,
    TourModalComponent,
  ],
  providers: [VexChatStore, VexLogStore, VexPresenceStore],
  template: `
    <div
      class="h-dvh w-full flex overflow-hidden bg-background text-text-primary"
    >
      @if (!chats_collapsed()) {
        <div
          class="fixed inset-0 bg-text-primary/40 z-30 lg:hidden"
          (click)="chats_collapsed.set(true)"
        ></div>
      }
      @if (!log_collapsed()) {
        <div
          class="fixed inset-0 bg-text-primary/40 z-30 lg:hidden"
          (click)="log_collapsed.set(true)"
        ></div>
      }

      <div
        [class]="
          chats_collapsed()
            ? 'hidden lg:flex shrink-0'
            : 'fixed inset-y-0 left-0 z-40 flex lg:static lg:z-auto shrink-0'
        "
        data-tour="vex-chats"
      >
        <vendix-vex-chats-sidebar
          [(collapsed)]="chats_collapsed"
          (conversationSelected)="onConversationSelected()"
        />
      </div>

      <main
        class="relative flex-1 min-w-0 flex flex-col"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        @if (dragging()) {
          <div
            class="absolute inset-3 z-30 rounded-3xl border-2 border-dashed border-primary bg-primary/10 flex flex-col items-center justify-center gap-2 pointer-events-none text-primary"
            role="status"
          >
            <app-icon name="upload" [size]="32"></app-icon>
            <span class="text-sm font-semibold">{{ copy.drop_to_attach }}</span>
          </div>
        }
        <div
          class="absolute inset-0 pointer-events-none"
          style="background: radial-gradient(ellipse 60% 50% at 50% 45%, rgba(var(--color-primary-rgb),0.18), transparent 70%), radial-gradient(ellipse 40% 35% at 60% 60%, rgba(var(--color-accent-rgb),0.12), transparent 70%)"
          aria-hidden="true"
        ></div>

        <header class="relative z-10 h-14 shrink-0 flex items-center gap-2 px-2">
          <button
            type="button"
            class="lg:hidden w-10 h-10 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary"
            [attr.aria-label]="copy.open_chats"
            data-tour="vex-chats-button"
            aria-controls="vex-chats-panel"
            [attr.aria-expanded]="!chats_collapsed()"
            (click)="openChats()"
          >
            <app-icon name="menu" [size]="20"></app-icon>
          </button>
          <a
            routerLink="/admin/dashboard"
            class="min-h-10 px-3 rounded-full flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
            [attr.aria-label]="copy.back_aria"
          >
            <app-icon name="arrow-left" [size]="18"></app-icon>
            <span>{{ copy.back }}</span>
          </a>
          <div class="flex-1 min-w-0 flex items-center justify-center gap-3">
            @if (renaming_title() && header_conversation(); as current) {
              <div class="w-full max-w-md">
                <vendix-vex-title-editor
                  [value]="current.title"
                  (saved)="onTitleSaved(current.id, $event)"
                  (cancelled)="onTitleDone()"
                />
              </div>
            } @else if (header_conversation(); as current) {
              <button
                #titleButton
                type="button"
                class="group min-h-10 max-w-full px-3 rounded-full flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary hover:bg-text-primary/5"
                [attr.aria-label]="copy.rename_aria(current.title)"
                [title]="copy.rename"
                (click)="renaming_title.set(true)"
              >
                <span class="truncate">{{ current.title }}</span>
                <app-icon name="pencil" [size]="14" class="shrink-0 opacity-60 group-hover:opacity-100" />
              </button>
            }
            <span class="hidden sm:inline-flex shrink-0">
              <vendix-vex-presence variant="header" />
            </span>
          </div>
          <button
            type="button"
            class="w-10 h-10 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary"
            [attr.aria-label]="helpCopy.open_aria"
            [title]="helpCopy.open"
            (click)="help_open.set(true)"
          >
            <app-icon name="help-circle" [size]="20"></app-icon>
          </button>
          <button
            type="button"
            class="lg:hidden w-10 h-10 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary"
            [attr.aria-label]="copy.open_log"
            data-tour="vex-log-button"
            aria-controls="vex-log-panel"
            [attr.aria-expanded]="!log_collapsed()"
            (click)="openLog()"
          >
            <app-icon name="history" [size]="20"></app-icon>
          </button>
        </header>

        @if (store.active_conversation()) {
          <div class="relative z-10 flex-1 min-h-0">
            <vendix-vex-thread />
          </div>
          <div class="relative z-10 max-w-3xl mx-auto w-full px-4 pb-4" data-tour="vex-composer">
            <vendix-vex-composer />
          </div>
        } @else {
          <div
            class="relative z-10 flex-1 flex flex-col items-center justify-center gap-8 max-w-3xl mx-auto w-full px-4 pb-16"
          >
            <vendix-vex-welcome (helpRequested)="help_open.set(true)" />
            <div class="w-full" data-tour="vex-composer">
              <vendix-vex-composer />
            </div>
          </div>
        }
      </main>

      <div
        [class]="
          log_collapsed()
            ? 'hidden lg:flex shrink-0'
            : 'fixed inset-y-0 right-0 z-40 flex lg:static lg:z-auto shrink-0'
        "
        data-tour="vex-log"
      >
        <vendix-vex-log-sidebar [(collapsed)]="log_collapsed" />
      </div>
    </div>
    <vendix-vex-help [(isOpen)]="help_open" (tourRequested)="tour_open.set(true)" />
    <app-tour-modal [(isOpen)]="tour_open" [tourConfig]="tourConfig"></app-tour-modal>
  `,
})
export class VexPageComponent {
  readonly store = inject(VexChatStore);
  private readonly tours = inject(TourService);
  protected readonly copy = VEX_COPY.page;
  protected readonly helpCopy = VEX_COPY.help;
  protected readonly tourConfig = VEX_TOUR_CONFIG;
  /** «¿Cómo funciona Vex?» */
  readonly help_open = signal(false);
  /** Guided tour: opens by itself only on the first visit. */
  readonly tour_open = signal(false);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `:id` of `/admin/vex/c/:id`; `null` on `/admin/vex`. */
  private readonly route_id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: this.route.snapshot.paramMap.get('id') },
  );

  /**
   * Both panels start collapsed on every visit, at any viewport. Nothing is
   * stored: within the visit they open and close freely.
   */
  readonly chats_collapsed = signal<boolean>(true);
  readonly log_collapsed = signal<boolean>(true);

  private readonly composer = viewChild(VexComposerComponent);
  readonly dragging = signal(false);
  private drag_depth = 0;

  /** Open conversation that already exists on the server (the only one that can be renamed). */
  readonly header_conversation = computed(() => {
    const conversation = this.store.active_conversation();
    return conversation && !conversation.local ? conversation : null;
  });
  readonly renaming_title = signal(false);
  private readonly title_button = viewChild<ElementRef<HTMLButtonElement>>('titleButton');
  private readonly injector = inject(Injector);

  constructor() {
    // First visit only: completing or skipping it is remembered per user.
    afterNextRender(() => {
      if (this.tours.canShowTour(VEX_TOUR_CONFIG.id)) this.tour_open.set(true);
    });
    // Switching conversation drops a half-edited header title.
    effect(() => {
      this.store.active_id();
      untracked(() => this.renaming_title.set(false));
    });
    // URL -> store: first load, reload, back/forward and shared links.
    effect(() => {
      const id = this.route_id();
      untracked(() => {
        this.store.openFromRoute(id);
        // An id the store refused (not a number) leaves the URL stale.
        const active = this.store.route_id();
        if (id !== null && active !== id && this.store.active_id() !== id) {
          this.navigateTo(active, true);
        }
      });
    });
    // Store -> URL: picking, creating, deleting or a missing conversation.
    effect(() => {
      const active = this.store.route_id();
      untracked(() => {
        if (active === this.route_id()) {
          this.store.takeReplaceNavigation();
          return;
        }
        this.navigateTo(active, this.store.takeReplaceNavigation());
      });
    });
  }

  async onTitleSaved(id: string, title: string): Promise<void> {
    this.onTitleDone();
    await this.store.renameConversation(id, title);
  }

  /** Closes the header editor and returns focus to the title button. */
  onTitleDone(): void {
    this.renaming_title.set(false);
    afterNextRender(() => this.title_button()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private navigateTo(id: string | null, replaceUrl: boolean): void {
    void this.router.navigate(id ? ['/admin/vex/c', id] : ['/admin/vex'], {
      replaceUrl,
    });
  }

  private hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  private canDrop(): boolean {
    return this.composer()?.can_attach() ?? false;
  }

  onDragEnter(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.drag_depth++;
    if (this.canDrop()) this.dragging.set(true);
  }

  onDragOver(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    // Required for the drop event to fire.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = this.canDrop() ? 'copy' : 'none';
    }
  }

  onDragLeave(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    this.drag_depth = Math.max(0, this.drag_depth - 1);
    if (this.drag_depth === 0) this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.drag_depth = 0;
    this.dragging.set(false);
    if (!this.canDrop()) return;
    this.composer()?.addFiles(Array.from(event.dataTransfer?.files ?? []));
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
