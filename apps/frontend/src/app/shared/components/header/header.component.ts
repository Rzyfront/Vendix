import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
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
    UserDropdownComponent
  ],
  template: `
    <header class="header-container">
      <div class="header-content">
        <div class="header-left">
          <!-- Toggle Sidebar Button -->
          <app-button
            variant="ghost"
            size="sm"
            (clicked)="toggleSidebar.emit()"
            class="sidebar-toggle">
            <app-icon name="menu" [size]="20"></app-icon>
          </app-button>

          <!-- Dynamic Breadcrumb -->
          <div class="breadcrumb-section">
            <div class="breadcrumb-trail" *ngIf="breadcrumb$ | async as breadcrumb">
              <ng-container *ngIf="breadcrumb.parent">
                <a
                  *ngIf="breadcrumb.parent.url"
                  [routerLink]="breadcrumb.parent.url"
                  class="breadcrumb-link">
                  <app-icon
                    *ngIf="breadcrumb.parent.icon"
                    [name]="breadcrumb.parent.icon"
                    [size]="14"
                    class="parent-icon">
                  </app-icon>
                  {{ breadcrumb.parent.label }}
                </a>
                <span *ngIf="!breadcrumb.parent.url" class="breadcrumb-label">
                  <app-icon
                    *ngIf="breadcrumb.parent.icon"
                    [name]="breadcrumb.parent.icon"
                    [size]="14"
                    class="parent-icon">
                  </app-icon>
                  {{ breadcrumb.parent.label }}
                </span>
                <span class="breadcrumb-separator">/</span>
              </ng-container>
              <span class="breadcrumb-current">
                <app-icon
                  *ngIf="breadcrumb.current.icon"
                  [name]="breadcrumb.current.icon"
                  [size]="14"
                  class="current-icon">
                </app-icon>
                {{ breadcrumb.current.label }}
              </span>
            </div>
            <h1 class="page-title">{{ (breadcrumb$ | async)?.title || title }}</h1>
          </div>
        </div>

        <!-- User Dropdown -->
        <div class="header-right">
          <app-user-dropdown (closeDropdown)="onDropdownClose()"></app-user-dropdown>
        </div>
      </div>
    </header>
  `,
  styleUrls: ['./header.component.scss']
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
    private router: Router
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
}