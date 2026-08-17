import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
  model,
  signal,
  DestroyRef,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Observable, of, debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs';

// Domain services are providedIn:'root', so DI resolves them regardless of the
// caller module. The shared picker sits at the boundary between private
// `organization/users` (org scope) and `super-admin/users` (global scope) —
// see plan §B.3.
import { UsersService } from '../../../private/modules/organization/users/services/users.service';
import { User, UserState, PaginatedUsersResponse } from '../../../private/modules/organization/users/interfaces/user.interface';
import { IconComponent } from '../icon/icon.component';
import { SuperAdminUsersLookupService } from '../../../private/modules/super-admin/stores/services/super-admin-users-lookup.service';

/**
 * Shape the picker exposes regardless of scope. The org `UsersService` already
 * returns rich `User` rows; for the global `superadmin/users` endpoint we
 * normalize to the same shape via {@link SuperAdminUsersLookupService}.
 */
export interface UserPickerOption {
  id: number;
  /** Display name in the chip — `username` for org, `first_name last_name` for global. */
  displayName: string;
  email: string;
  /** Optional avatar fallback initials source. Falls back to `displayName[0]`. */
  initialsSource?: string;
}

/**
 * Shared user picker used by both the org-scope `UserSelectComponent` wrapper
 * (existing `store-create-modal`) and the new global-scope consumers from the
 * super-admin console.
 *
 * - Standalone, OnPush, zoneless + signals.
 * - Two-way binding via `model<number | null>` (`value`).
 * - `scope: 'org' | 'global'` (default `'org'`) selects which lookup pipeline
 *   to hit. `organizationId` is forwarded to the org endpoint when set; the
 *   global endpoint ignores it (global users are not org-scoped).
 *
 * The search input is debounced (300ms) before hitting the network, matching
 * the existing org-only picker's behavior. No remote fetching happens until
 * the user types at least one character, so the dropdown does not flood the
 * endpoint on open.
 */
@Component({
  selector: 'app-user-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="relative" #container>
      @if (selectedUser()) {
        <div
          class="flex items-center justify-between p-2 border border-border rounded-lg bg-surface hover:bg-muted/50 cursor-pointer"
          (click)="toggleDropdown()"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
            >
              <span class="text-xs font-bold">
                {{ initialFor(selectedUser()!.displayName) }}
              </span>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-text-primary truncate">
                {{ selectedUser()!.displayName }}
              </p>
              <p class="text-xs text-text-secondary truncate">
                {{ selectedUser()!.email }}
              </p>
            </div>
          </div>
          <button
            type="button"
            (click)="clearSelection($event)"
            class="p-1 text-text-secondary hover:text-destructive shrink-0"
          >
            <app-icon name="x" size="14" />
          </button>
        </div>
      } @else {
        <div class="relative">
          <input
            #searchInput
            type="text"
            [placeholder]="placeholder()"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            (focus)="openDropdown()"
            (blur)="onBlur()"
            (keydown.escape)="closeDropdown()"
            class="w-full px-3 py-2 pr-8 text-sm border border-border rounded-lg bg-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder-text-secondary"
          />
          <app-icon
            name="search"
            size="14"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
          />
        </div>
      }

      @if (isOpen()) {
        <div
          class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          @if (isLoading()) {
            <div class="p-4 text-center text-sm text-text-secondary">
              <span class="inline-block animate-spin mr-2">⟳</span>
              Buscando...
            </div>
          } @else if (users().length === 0) {
            <div class="p-4 text-center text-sm text-text-secondary">
              @if (searchQuery) {
                No se encontraron usuarios
              } @else {
                Escribe para buscar usuarios
              }
            </div>
          } @else {
            @for (user of users(); track user.id) {
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                (mousedown)="selectUser(user)"
              >
                <div
                  class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
                >
                  <span class="text-xs font-bold">
                    {{ initialFor(user.displayName) }}
                  </span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ user.displayName }}
                  </p>
                  <p class="text-xs text-text-secondary truncate">
                    {{ user.email }}
                  </p>
                </div>
              </button>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; }
    `,
  ],
})
export class UserSelectComponent implements OnInit {
  @ViewChild('container') container!: ElementRef<HTMLDivElement>;

  private readonly orgUsersService = inject(UsersService);
  private readonly superAdminLookup = inject(SuperAdminUsersLookupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly value = model<number | null>(null);
  readonly placeholder = input<string>('Buscar usuario...');
  readonly organizationId = input<number | null>(null);
  readonly scope = input<'org' | 'global'>('org');

  searchQuery = '';
  selectedUser = signal<UserPickerOption | null>(null);
  users = signal<UserPickerOption[]>([]);
  isLoading = signal(false);
  isOpen = signal(false);

  private readonly searchSubject = new Subject<string>();
  private hasHydrated = false;

  constructor() {
    // When the parent assigns a known id (e.g. while the modal opens with
    // pre-populated data) the chip must reflect that user even before the
    // user types. Only re-hydrates when the inbound id actually changes.
    effect(() => {
      const id = this.value();
      if (id == null) {
        if (this.hasHydrated) {
          this.selectedUser.set(null);
          this.hasHydrated = false;
        }
        return;
      }
      if (this.hasHydrated && this.selectedUser()?.id === id) return;
      this.hasHydrated = true;
      this.fetchById(id);
    });
  }

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => this.runSearch(query)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.isLoading.set(false);
        this.users.set(results);
      });
  }

  onSearchChange(query: string): void {
    this.searchSubject.next(query);
  }

  openDropdown(): void {
    this.isOpen.set(true);
    if (this.searchQuery) {
      this.searchSubject.next(this.searchQuery);
    }
  }

  toggleDropdown(): void {
    this.isOpen.update((v) => !v);
    if (this.isOpen() && this.searchQuery) {
      this.searchSubject.next(this.searchQuery);
    }
  }

  closeDropdown(): void {
    this.isOpen.set(false);
  }

  onBlur(): void {
    setTimeout(() => {
      if (!this.isLoading()) {
        this.isOpen.set(false);
      }
    }, 200);
  }

  selectUser(user: UserPickerOption): void {
    this.selectedUser.set(user);
    this.value.set(user.id);
    this.searchQuery = '';
    this.users.set([]);
    this.isOpen.set(false);
  }

  clearSelection(event: Event): void {
    event.stopPropagation();
    this.selectedUser.set(null);
    this.value.set(null);
    this.searchQuery = '';
    this.hasHydrated = false;
  }

  initialFor(name: string): string {
    const src = (name ?? '').trim();
    return (src.charAt(0) || '?').toUpperCase();
  }

  /**
   * Returns the picker-shape row mapped from either the org or super-admin
   * endpoint, depending on `scope()`. Empty queries short-circuit to an empty
   * list (mirrors the existing UX: no flood on open).
   */
  private runSearch(query: string): Observable<UserPickerOption[]> {
    const term = (query ?? '').trim();
    if (!term) {
      this.isLoading.set(false);
      return of([]);
    }
    this.isLoading.set(true);
    if (this.scope() === 'global') {
      return this.superAdminLookup.searchUsers(term).pipe(
        catchError(() => {
          this.isLoading.set(false);
          return of([]);
        }),
      );
    }
    return this.orgUsersService
      .getUsers({
        search: term,
        limit: 10,
        state: UserState.ACTIVE,
        organization_id: this.organizationId() ?? undefined,
      })
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          return of<PaginatedUsersResponse>({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } });
        }),
        // map PaginatedUsersResponse → UserPickerOption[]
        switchMap((resp: PaginatedUsersResponse) =>
          of(this.mapOrgUsers(resp?.data ?? [])),
        ),
      );
  }

  /**
   * Hydrates the selected chip from a known id. For org scope this reuses
   * `getUserById`; for global scope we resolve the display name from the
   * lookup endpoint (no `byId` exists for superadmin yet — re-querying the
   * search by the manager id keeps the chip meaningful without a new
   * endpoint).
   */
  private fetchById(id: number): void {
    if (this.scope() === 'global') {
      this.superAdminLookup
        .searchUsers(String(id))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((rows) => {
          const found = rows.find((r) => r.id === id);
          if (found) {
            this.selectedUser.set(found);
          } else {
            // Fallback: show a minimal chip; user must type to refresh.
            this.selectedUser.set({
              id,
              displayName: `Usuario #${id}`,
              email: '',
            });
          }
        });
      return;
    }
    this.orgUsersService
      .getUserById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) =>
          this.selectedUser.set({
            id: u.id,
            displayName: u.username,
            email: u.email,
          }),
        error: () =>
          this.selectedUser.set({
            id,
            displayName: `Usuario #${id}`,
            email: '',
          }),
      });
  }

  private mapOrgUsers(users: User[]): UserPickerOption[] {
    return users.map((u) => ({
      id: u.id,
      displayName: u.username,
      email: u.email,
    }));
  }
}