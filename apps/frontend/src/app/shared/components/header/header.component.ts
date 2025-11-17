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
      <div class="flex items-center justify-between p-4 gap-6">
        <div class="flex items-center gap-5 flex-1 min-w-0">
          <!-- Toggle Sidebar Button -->
          <app-button
            variant="ghost"
            size="sm"
            (clicked)="toggleSidebar.emit()"
            class="flex-shrink-0 p-2.5 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <app-icon name="menu" [size]="20"></app-icon>
          </app-button>

          <!-- Dynamic Breadcrumb -->
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div
              class="flex items-center gap-2 flex-wrap"
              *ngIf="breadcrumb$ | async as breadcrumbData"
            >
              <ng-container *ngIf="breadcrumbData.parent">
                <a
                  *ngIf="breadcrumbData.parent.url"
                  [routerLink]="breadcrumbData.parent.url"
                  class="flex items-center gap-1.5 text-xs font-medium text-slate-600 no-underline transition-colors duration-200 hover:text-blue-600"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70"
                  ></app-icon>
                  {{ breadcrumbData.parent.label }}
                </a>
                <span
                  *ngIf="!breadcrumbData.parent.url"
                  class="flex items-center gap-1.5 text-xs font-medium text-slate-600"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70"
                  ></app-icon>
                  {{ breadcrumbData.parent.label }}
                </span>
                <span class="text-slate-600 opacity-70 mx-1 text-sm font-normal"
                  >/</span
                >
              </ng-container>
              <span
                class="flex items-center gap-1.5 text-xs font-semibold text-slate-900"
              >
                <app-icon
                  *ngIf="breadcrumbData.current.icon"
                  [name]="breadcrumbData.current.icon"
                  [size]="14"
                  class="text-blue-600"
                ></app-icon>
                {{ breadcrumbData.current.label }}
              </span>
            </div>
            <h1
              class="text-2xl lg:text-3xl font-bold text-slate-900 m-0 leading-tight tracking-tight block"
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
  @Input() title: string = 'Dashboard';
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
