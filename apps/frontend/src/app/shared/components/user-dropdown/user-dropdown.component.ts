import { Component, Output, EventEmitter, HostListener, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import { AuthService } from '../../../core/services/auth.service';
import { GlobalFacade } from '../../../core/store/global.facade';

export interface UserMenuOption {
  label: string;
  icon: string;
  action: () => void;
  type?: 'default' | 'danger';
}

@Component({
  selector: 'app-user-dropdown',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="user-dropdown-container" [class.open]="isOpen">
      <button
        class="user-trigger"
        (click)="toggleDropdown()"
        [attr.aria-expanded]="isOpen"
        aria-label="Menú de usuario">
        <div class="user-info">
          <span class="user-name">{{ user.name || 'Usuario' }}</span>
          <span class="user-role">{{ user.role || 'Administrador' }}</span>
        </div>
        <div class="user-avatar">
          <span class="user-initials">{{ user.initials || 'US' }}</span>
        </div>
        <app-icon
          name="chevron"
          [size]="16"
          class="chevron-icon"
          [class.rotate]="isOpen">
        </app-icon>
      </button>

      <div class="dropdown-menu" [class.show]="isOpen">
        <div class="dropdown-header">
          <div class="header-avatar">{{ user.initials || 'US' }}</div>
          <div class="header-info">
            <p class="header-name">{{ user.name || 'Usuario' }}</p>
            <p class="header-email">{{ user.email || 'user@example.com' }}</p>
          </div>
        </div>

        <div class="dropdown-divider"></div>

        <div class="dropdown-content">
          <button
            *ngFor="let option of menuOptions"
            class="dropdown-item"
            [class.danger]="option.type === 'danger'"
            (click)="handleOptionClick(option)">
            <app-icon [name]="option.icon" [size]="18" class="item-icon"></app-icon>
            <span class="item-label">{{ option.label }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./user-dropdown.component.scss']
})
export class UserDropdownComponent implements OnInit {
  @Output() closeDropdown = new EventEmitter<void>();

  isOpen = false;
  
  private router = inject(Router);
  private authService = inject(AuthService);
  private globalFacade = inject(GlobalFacade);
  
  userContext$: Observable<{
    user?: any;
    organization?: any;
    store?: any;
    environment?: any;
    isAuthenticated: boolean;
    hasOrganization: boolean;
    hasStore: boolean;
  }>;

  constructor() {
    // Inicializar el observable en el constructor
    this.userContext$ = this.globalFacade.userContext$;
  }

  ngOnInit() {
    // El observable ya está inicializado en el constructor
  }

  get user() {
    const context = this.globalFacade.getUserContext();
    if (!context?.user) {
      return {
        name: 'Usuario',
        email: 'user@example.com',
        role: 'Administrador',
        initials: 'US'
      };
    }

    const { user } = context;
    const name = user.name || user.email || 'Usuario';
    const initials = this.generateInitials(name);

    return {
      name,
      email: user.email || 'user@example.com',
      role: this.getRoleDisplay(context),
      initials
    };
  }

  menuOptions: UserMenuOption[] = [
    {
      label: 'Mi Perfil',
      icon: 'user',
      action: () => this.goToProfile()
    },
    {
      label: 'Configuración',
      icon: 'settings',
      action: () => this.goToSettings()
    },
    {
      label: 'Cerrar Sesión',
      icon: 'logout',
      action: () => this.logout(),
      type: 'danger'
    }
  ];

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementContains(target)) {
      this.isOpen = false;
      this.closeDropdown.emit();
    }
  }

  @HostListener('keydown.escape')
  onEscape() {
    this.isOpen = false;
    this.closeDropdown.emit();
  }

  toggleDropdown() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.closeDropdown.emit();
    }
  }

  private elementContains(target: HTMLElement): boolean {
    const element = document.querySelector('.user-dropdown-container');
    return element?.contains(target) || false;
  }

  handleOptionClick(option: UserMenuOption) {
    option.action();
    this.isOpen = false;
    this.closeDropdown.emit();
  }

  private goToProfile() {
    this.router.navigate(['/profile']);
  }

  private goToSettings() {
    this.router.navigate(['/settings']);
  }

  private logout() {
    this.authService.logout().subscribe({
      next: () => {
        this.router.navigate(['/auth/login']);
      },
      error: (error) => {
        console.error('Error en logout:', error);
        this.router.navigate(['/auth/login']);
      }
    });
  }

  private generateInitials(name: string): string {
    return name
      .split(' ')
      .filter(word => word.length > 0)
      .map(word => word[0].toUpperCase())
      .slice(0, 2)
      .join('');
  }

  private getRoleDisplay(context: any): string {
    if (!context?.user) return 'Administrador';

    const { user, organization, store } = context;

    // Lógica para mostrar el rol más relevante
    if (user.roles?.includes('super_admin')) return 'Super Administrador';
    if (user.roles?.includes('admin')) return 'Administrador';
    if (user.roles?.includes('owner')) {
      if (organization && store) return `Dueño de ${store.name}`;
      if (organization) return `Dueño de ${organization.name}`;
      return 'Dueño';
    }
    if (user.roles?.includes('manager')) {
      if (store) return `Gerente de ${store.name}`;
      return 'Gerente';
    }

    return user.roles?.[0] || 'Usuario';
  }
}