import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  EmptyStateComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { StickyHeaderActionButton } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmInboxService } from './crm-inbox.service';
import { CrmInboxStreamService, CrmStreamSignal } from './crm-inbox-stream.service';
import {
  CrmConversation,
  CrmConversationStats,
  CrmConversationsQuery,
  CrmMessage,
} from './crm-inbox.interface';
import { mergeMessages } from './crm-inbox.utils';
import {
  ConversationListComponent,
  InboxFilter,
} from './components/conversation-list.component';
import {
  ConversationThreadComponent,
  ThreadAction,
} from './components/conversation-thread.component';
import { AssignConversationModalComponent } from './components/assign-conversation-modal.component';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Clientes → Bandeja (PLAN-CRM §7). Two panes on desktop; on mobile the list
 * and the thread alternate, with Back on the thread.
 *
 * Real time: the SSE only carries ids and states, so every event re-reads the
 * list (debounced) and, when it touches the open conversation, its detail and
 * newest messages.
 */
@Component({
  selector: 'app-crm-inbox',
  standalone: true,
  providers: [CrmInboxStreamService],
  imports: [
    EmptyStateComponent,
    StatsComponent,
    StickyHeaderComponent,
    ConversationListComponent,
    ConversationThreadComponent,
    AssignConversationModalComponent,
  ],
  styles: [
    `
      .inbox-panes {
        height: calc(100dvh - 12rem);
        min-height: 28rem;
      }
    `,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Bandeja"
        subtitle="Conversaciones de WhatsApp, SMS y correo con tus clientes."
        icon="inbox"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="stats-container mb-4">
        <app-stats
          title="Abiertas"
          [value]="stats()?.open ?? 0"
          iconName="message-circle"
          [loading]="statsLoading()"
          [clickable]="true"
          (click)="filter.set('open')"
        ></app-stats>
        @if (canAssign()) {
          <app-stats
            title="Sin asignar"
            [value]="stats()?.unassigned ?? 0"
            iconName="user-x"
            iconBgColor="bg-warning/10"
            iconColor="text-warning"
            [loading]="statsLoading()"
            [clickable]="true"
            (click)="filter.set('unassigned')"
          ></app-stats>
        }
        <app-stats
          title="Mías"
          [value]="stats()?.mine ?? 0"
          iconName="user-check"
          [loading]="statsLoading()"
          [clickable]="true"
          (click)="filter.set('mine')"
        ></app-stats>
        <app-stats
          title="Sin leer"
          [value]="stats()?.unread ?? 0"
          iconName="inbox"
          [smallText]="streamLabel()"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <div
        class="inbox-panes flex overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface"
      >
        <aside
          class="min-h-0 w-full flex-col border-[var(--color-border)] lg:flex lg:w-96 lg:shrink-0 lg:border-r"
          [class.flex]="!showThread()"
          [class.hidden]="showThread()"
          aria-label="Conversaciones"
        >
          <app-crm-conversation-list
            class="block h-full min-h-0"
            [conversations]="conversations()"
            [selectedId]="selectedId()"
            [loading]="listLoading()"
            [loadingMore]="loadingMore()"
            [hasMore]="page() < totalPages()"
            [error]="listError()"
            [searchText]="search()"
            [canSeeAll]="canAssign()"
            [(filter)]="filter"
            (search)="search.set($event)"
            (selected)="select($event)"
            (loadMore)="loadMore()"
            (retry)="reloadList()"
            (clearFilters)="clearFilters()"
          ></app-crm-conversation-list>
        </aside>

        <main
          class="min-h-0 min-w-0 flex-1 flex-col lg:flex"
          [class.flex]="showThread()"
          [class.hidden]="!showThread()"
        >
          @if (selected(); as conversation) {
            <app-crm-conversation-thread
              class="block h-full min-h-0"
              [conversation]="conversation"
              [messages]="messages()"
              [loading]="messagesLoading()"
              [loadingOlder]="loadingOlder()"
              [hasMore]="hasOlder()"
              [error]="messagesError()"
              [canReply]="canReply()"
              [canAssign]="canAssign()"
              [busy]="busy()"
              (back)="deselect()"
              (retry)="openConversation(conversation.id)"
              (loadOlder)="loadOlder()"
              (action)="onAction($event)"
              (sent)="onSent($event)"
            ></app-crm-conversation-thread>
          } @else if (selectedId() !== null && detailError()) {
            <div class="m-auto max-w-md p-6">
              <app-empty-state
                icon="triangle-alert"
                iconColor="error"
                title="No pudimos abrir la conversación"
                [description]="detailError() ?? ''"
                [showActionButton]="false"
                [showRefreshButton]="true"
                (refreshClick)="openConversation(selectedId()!)"
              ></app-empty-state>
            </div>
          } @else if (selectedId() !== null) {
            <div class="m-auto text-sm text-[var(--color-text-secondary)]">
              Cargando conversación…
            </div>
          } @else {
            <div class="m-auto max-w-md p-6">
              <app-empty-state
                icon="message-circle"
                title="Elige una conversación"
                description="Selecciona una conversación de la lista para leerla y responder."
                [showActionButton]="false"
              ></app-empty-state>
            </div>
          }
        </main>
      </div>
    </section>

    <app-crm-assign-conversation-modal
      [(isOpen)]="assignOpen"
      [assignedUserId]="selected()?.assigned_user?.id ?? null"
      [currentUserId]="auth.userId()"
      [saving]="busy() === 'assign'"
      (assign)="assign($event)"
    ></app-crm-assign-conversation-modal>
  `,
})
export class InboxComponent {
  private readonly inbox = inject(CrmInboxService);
  private readonly stream = inject(CrmInboxStreamService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthFacade);

  // List
  protected readonly filter = signal<InboxFilter>('all');
  protected readonly search = signal('');
  protected readonly conversations = signal<CrmConversation[]>([]);
  protected readonly listLoading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly listError = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);
  protected readonly stats = signal<CrmConversationStats | null>(null);
  protected readonly statsLoading = signal(false);

  // Thread
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selected = signal<CrmConversation | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly messages = signal<CrmMessage[]>([]);
  protected readonly messagesLoading = signal(false);
  protected readonly messagesError = signal<string | null>(null);
  protected readonly hasOlder = signal(false);
  protected readonly loadingOlder = signal(false);
  protected readonly busy = signal<ThreadAction | null>(null);
  protected readonly assignOpen = signal(false);
  private olderCursor: number | null = null;

  /** Ignore responses of superseded requests. */
  private listSeq = 0;
  private threadSeq = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingThreadRefresh = false;

  protected readonly canReply = computed(
    () =>
      this.auth.hasPermission('store:crm_inbox:manage') || this.auth.isOwner(),
  );
  protected readonly canAssign = computed(
    () =>
      this.auth.hasPermission('store:crm_inbox:assign') || this.auth.isOwner(),
  );
  protected readonly showThread = computed(() => this.selectedId() !== null);

  protected readonly streamLabel = computed(() => {
    switch (this.stream.state()) {
      case 'open':
        return 'En vivo';
      case 'reconnecting':
        return 'Reconectando…';
      case 'connecting':
        return 'Conectando…';
      default:
        return '';
    }
  });

  protected readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'refresh',
      label: 'Actualizar',
      variant: 'outline',
      icon: 'refresh-cw',
      loading: this.listLoading(),
    },
  ]);

  constructor() {
    const initial = Number(this.route.snapshot.queryParamMap.get('c'));
    if (Number.isInteger(initial) && initial > 0) {
      void this.openConversation(initial);
    }

    // Filters and search drive the list.
    effect(() => {
      this.filter();
      this.search();
      untracked(() => void this.reloadList());
    });

    void this.loadStats();

    this.stream.signals
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((signal) => this.onStream(signal));
    this.stream.connect();
    this.destroyRef.onDestroy(() => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
    });
  }

  protected onHeaderAction(id: string): void {
    if (id !== 'refresh') return;
    void this.reloadList();
    void this.loadStats();
    const current = this.selectedId();
    if (current !== null) void this.refreshThread(current);
  }

  protected clearFilters(): void {
    this.filter.set('all');
    this.search.set('');
  }

  // ─── List ──────────────────────────────────────────────────────────────

  async reloadList(silent = false): Promise<void> {
    const seq = ++this.listSeq;
    if (!silent) {
      this.listLoading.set(true);
      this.listError.set(null);
    }
    // A silent refresh keeps every row already loaded.
    const limit = silent
      ? Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, this.conversations().length))
      : PAGE_SIZE;
    try {
      const result = await firstValueFrom(
        this.inbox.list({ ...this.query(), page: 1, limit }),
      );
      if (seq !== this.listSeq) return;
      this.conversations.set(result.data);
      this.page.set(silent ? Math.ceil(result.data.length / PAGE_SIZE) || 1 : 1);
      this.totalPages.set(
        silent ? Math.ceil(result.total / PAGE_SIZE) || 1 : result.totalPages,
      );
      this.listError.set(null);
    } catch (error) {
      if (seq !== this.listSeq) return;
      if (!silent) this.listError.set(parseApiError(error).userMessage);
    } finally {
      if (seq === this.listSeq) this.listLoading.set(false);
    }
  }

  protected async loadMore(): Promise<void> {
    if (this.loadingMore()) return;
    const seq = this.listSeq;
    const next = this.page() + 1;
    this.loadingMore.set(true);
    try {
      const result = await firstValueFrom(
        this.inbox.list({ ...this.query(), page: next, limit: PAGE_SIZE }),
      );
      if (seq !== this.listSeq) return;
      const known = new Set(this.conversations().map((c) => c.id));
      this.conversations.update((list) => [
        ...list,
        ...result.data.filter((c) => !known.has(c.id)),
      ]);
      this.page.set(next);
      this.totalPages.set(result.totalPages);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async loadStats(): Promise<void> {
    this.statsLoading.set(this.stats() === null);
    try {
      this.stats.set(await firstValueFrom(this.inbox.stats()));
    } catch {
      // Counters are secondary: the list shows its own error.
    } finally {
      this.statsLoading.set(false);
    }
  }

  private query(): CrmConversationsQuery {
    const q = this.search().trim() || undefined;
    switch (this.filter()) {
      case 'unassigned':
        return { assigned: 'unassigned', q };
      case 'mine':
        return { assigned: 'me', q };
      case 'open':
        return { status: 'open', q };
      case 'closed':
        return { status: 'closed', q };
      default:
        return { q };
    }
  }

  // ─── Thread ────────────────────────────────────────────────────────────

  protected select(id: number): void {
    if (id === this.selectedId() && this.selected()) return;
    void this.openConversation(id);
  }

  protected deselect(): void {
    this.threadSeq++;
    this.selectedId.set(null);
    this.selected.set(null);
    this.messages.set([]);
    this.detailError.set(null);
    this.syncUrl(null);
  }

  async openConversation(id: number): Promise<void> {
    const seq = ++this.threadSeq;
    this.selectedId.set(id);
    this.syncUrl(id);
    // Show the row we already have while the detail loads.
    this.selected.set(this.conversations().find((c) => c.id === id) ?? null);
    this.detailError.set(null);
    this.messages.set([]);
    this.messagesError.set(null);
    this.messagesLoading.set(true);
    this.hasOlder.set(false);
    this.olderCursor = null;
    try {
      const [conversation, page] = await Promise.all([
        firstValueFrom(this.inbox.get(id)),
        firstValueFrom(this.inbox.messages(id)),
      ]);
      if (seq !== this.threadSeq) return;
      this.selected.set(conversation);
      this.messages.set([...page.data].reverse());
      this.hasOlder.set(page.has_more);
      this.olderCursor = page.next_before_id;
      if (conversation.unread_count > 0) void this.markRead(id, true);
    } catch (error) {
      if (seq !== this.threadSeq) return;
      const message = parseApiError(error).userMessage;
      if (this.selected()) {
        this.messagesError.set(message);
      } else {
        this.detailError.set(message);
      }
    } finally {
      if (seq === this.threadSeq) this.messagesLoading.set(false);
    }
  }

  protected async loadOlder(): Promise<void> {
    const id = this.selectedId();
    if (id === null || this.loadingOlder() || !this.olderCursor) return;
    const seq = this.threadSeq;
    this.loadingOlder.set(true);
    try {
      const page = await firstValueFrom(this.inbox.messages(id, this.olderCursor));
      if (seq !== this.threadSeq) return;
      this.messages.update((list) => mergeMessages(list, page.data));
      this.hasOlder.set(page.has_more);
      this.olderCursor = page.next_before_id;
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.loadingOlder.set(false);
    }
  }

  /** Re-read detail and newest messages of the open conversation. */
  private async refreshThread(id: number): Promise<void> {
    const seq = this.threadSeq;
    try {
      const [conversation, page] = await Promise.all([
        firstValueFrom(this.inbox.get(id)),
        firstValueFrom(this.inbox.messages(id)),
      ]);
      if (seq !== this.threadSeq || this.selectedId() !== id) return;
      this.selected.set(conversation);
      this.messages.update((list) => mergeMessages(list, page.data));
      if (conversation.unread_count > 0 && document.visibilityState === 'visible') {
        void this.markRead(id, true);
      }
    } catch (error) {
      if (seq !== this.threadSeq) return;
      // Reassigned away or deleted: it is no longer visible to this user.
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.toast.info('Ya no tienes acceso a esta conversación.');
        this.deselect();
      }
    }
  }

  protected onSent(message: CrmMessage): void {
    this.messages.update((list) => mergeMessages(list, [message]));
    // Replying reopens a closed conversation on the server.
    const current = this.selected();
    if (current && current.status === 'closed' && message.channel !== 'internal_note') {
      this.selected.set({ ...current, status: 'open', closed_at: null });
    }
    this.scheduleRefresh();
  }

  protected onAction(action: ThreadAction): void {
    const id = this.selectedId();
    if (id === null) return;
    switch (action) {
      case 'assign':
        this.assignOpen.set(true);
        return;
      case 'read':
        void this.markRead(id, false);
        return;
      case 'close':
        void this.runAction('close', () => firstValueFrom(this.inbox.close(id)), 'Conversación cerrada');
        return;
      case 'reopen':
        void this.runAction('reopen', () => firstValueFrom(this.inbox.reopen(id)), 'Conversación reabierta');
        return;
    }
  }

  protected async assign(userId: number | null): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    const done = await this.runAction(
      'assign',
      () => firstValueFrom(this.inbox.assign(id, userId)),
      userId === null ? 'Conversación sin responsable' : 'Conversación asignada',
    );
    if (done) this.assignOpen.set(false);
  }

  private async runAction(
    action: ThreadAction,
    request: () => Promise<CrmConversation>,
    success: string,
  ): Promise<boolean> {
    this.busy.set(action);
    try {
      const conversation = await request();
      if (this.selectedId() === conversation.id) this.selected.set(conversation);
      this.patchRow(conversation);
      this.toast.success(success);
      this.scheduleRefresh();
      return true;
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  private async markRead(id: number, quiet: boolean): Promise<void> {
    if (!quiet) this.busy.set('read');
    try {
      await firstValueFrom(this.inbox.markRead(id));
      const current = this.selected();
      if (current?.id === id) this.selected.set({ ...current, unread_count: 0 });
      this.conversations.update((list) =>
        list.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)),
      );
      void this.loadStats();
    } catch (error) {
      if (!quiet) this.toast.error(parseApiError(error).userMessage);
    } finally {
      if (!quiet) this.busy.set(null);
    }
  }

  private patchRow(conversation: CrmConversation): void {
    this.conversations.update((list) =>
      list.map((c) =>
        c.id === conversation.id
          ? { ...conversation, last_message_preview: c.last_message_preview }
          : c,
      ),
    );
  }

  // ─── Real time ─────────────────────────────────────────────────────────

  private onStream(signal: CrmStreamSignal): void {
    if (signal.kind === 'resync') {
      this.pendingThreadRefresh = true;
    } else if (signal.event.conversation_id === this.selectedId()) {
      this.pendingThreadRefresh = true;
    }
    this.scheduleRefresh();
  }

  /** Coalesce bursts of events (status updates arrive in quick succession). */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.reloadList(true);
      void this.loadStats();
      const id = this.selectedId();
      if (this.pendingThreadRefresh && id !== null) void this.refreshThread(id);
      this.pendingThreadRefresh = false;
    }, REFRESH_DEBOUNCE_MS);
  }

  private syncUrl(id: number | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { c: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
