import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, Observable } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import { UserDropdownComponent } from '../user-dropdown/user-dropdown.component';

import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    ButtonComponent,
    UserDropdownComponent,
  ],
  template: `
    <header
      class="bg-transparent border-b-0 sticky top-0 backdrop-blur-md text-slate-900 relative z-50"
    >
      <div
        class="flex items-center justify-between px-2 py-1 sm:px-3 sm:py-2 md:p-2 gap-1.5 md:gap-6"
      >
        <div class="flex items-center gap-1.5 sm:gap-5 flex-1 min-w-0">
          <!-- Toggle Sidebar Button -->
          <app-button
            variant="ghost"
            size="sm"
            (clicked)="toggleSidebar.emit()"
            class="flex-shrink-0 p-1.5 sm:p-2.5 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <app-icon name="menu" [size]="20"></app-icon>
          </app-button>

          <!-- Dynamic Breadcrumb -->
          <div class="flex flex-col gap-0 min-w-0 flex-1">
            <div
              class="flex items-center gap-1 sm:gap-2 flex-nowrap overflow-hidden"
              *ngIf="breadcrumb$ | async as breadcrumbData"
            >
              <ng-container *ngIf="breadcrumbData.parent">
                <a
                  *ngIf="breadcrumbData.parent.url"
                  [routerLink]="breadcrumbData.parent.url"
                  class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 no-underline transition-colors duration-200 hover:text-blue-600 min-w-0"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70 hidden sm:block flex-shrink-0"
                  ></app-icon>
                  <span class="truncate">{{
                    breadcrumbData.parent.label
                  }}</span>
                </a>
                <span
                  *ngIf="!breadcrumbData.parent.url"
                  class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 min-w-0"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70 hidden sm:block flex-shrink-0"
                  ></app-icon>
                  <span class="truncate">{{
                    breadcrumbData.parent.label
                  }}</span>
                </span>
                <span
                  class="text-slate-600 opacity-70 mx-0.5 text-[10px] sm:text-xs font-normal flex-shrink-0"
                  >/</span
                >
              </ng-container>
              <span
                class="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-slate-900 min-w-0"
              >
                <app-icon
                  *ngIf="breadcrumbData.current.icon"
                  [name]="breadcrumbData.current.icon"
                  [size]="14"
                  class="text-blue-600 hidden sm:block flex-shrink-0"
                ></app-icon>
                <span class="truncate">{{ breadcrumbData.current.label }}</span>
              </span>
            </div>
            <h1
              class="text-sm sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 m-0 leading-none tracking-tight block truncate"
            >
              {{ (breadcrumb$ | async)?.title || title }}
            </h1>
          </div>
        </div>

        <!-- User Dropdown -->
        <div class="flex-shrink-0">
          <app-user-dropdown
            (closeDropdown)="onDropdownClose()"
          ></app-user-dropdown>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() title: string = 'Panel Principal';
  @Input() breadcrumb: any = {};
  @Input() user: any = {};
  @Output() toggleSidebar = new EventEmitter<void>();

  breadcrumb$: Observable<{
    parent?: BreadcrumbItem;
    current: BreadcrumbItem;
    title: string;
  }>;
  private subscription?: Subscription;

  constructor(
    private breadcrumbService: BreadcrumbService,
    private router: Router,
  ) {
    // Inicializar el observable del breadcrumb en el constructor
    this.breadcrumb$ = this.breadcrumbService.breadcrumb$;
  }

  ngOnInit() {
    // Suscribirse a cambios en el breadcrumb para actualizar dinámicamente
    this.subscription = this.breadcrumb$.subscribe((breadcrumb) => {
      // Opcional: Puedes agregar lógica adicional aquí si necesitas
      // reaccionar a cambios en el breadcrumb
    });
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  onDropdownClose() {
    // Puedes agregar lógica cuando se cierra el dropdown si es necesario
  }

  navigateToUrl(url: string) {
    this.router.navigateByUrl(url);
  }
}
