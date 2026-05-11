import {
  Component,
  input,
  model,
  signal,
  inject,
  OnInit,
  OnDestroy,
  DestroyRef,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UsersService } from '../../../../organization/users/services/users.service';
import { User, UserState } from '../../../../organization/users/interfaces/user.interface';
import { IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-user-select',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="relative" #container>
      <!-- Selected User Display -->
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
                {{ selectedUser()!.username.charAt(0).toUpperCase() }}
              </span>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-text-primary truncate">
                {{ selectedUser()!.username }}
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
        <!-- Search Input -->
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

      <!-- Dropdown -->
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
                    {{ (user.username.charAt(0) || '?').toUpperCase() }}
                  </span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ user.username }}
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
  styles: [`
    :host { display: block; position: relative; }
  `],
})
export class UserSelectComponent implements OnInit, OnDestroy {
  @ViewChild('container') container!: ElementRef<HTMLDivElement>;

  private usersService = inject(UsersService);
  private destroyRef = inject(DestroyRef);
  private searchSubject = new Subject<string>();

  readonly value = model<number | null>(null);
  readonly placeholder = input<string>('Buscar usuario...');
  readonly organizationId = input<number | null>(null);

  searchQuery = '';
  selectedUser = signal<User | null>(null);
  users = signal<User[]>([]);
  isLoading = signal(false);
  isOpen = signal(false);

  ngOnInit(): void {
    // Set up debounced search
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query.trim()) {
            return of({ data: [] as User[] });
          }
          this.isLoading.set(true);
          return this.usersService.getUsers({ search: query, limit: 10, state: UserState.ACTIVE }).pipe(
            catchError(() => of({ data: [] as User[] })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result: any) => {
        this.isLoading.set(false);
        this.users.set(result.data ?? []);
      });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
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
    // Delay to allow click on dropdown items
    setTimeout(() => {
      if (!this.isLoading()) {
        this.isOpen.set(false);
      }
    }, 200);
  }

  selectUser(user: User): void {
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
  }
}
