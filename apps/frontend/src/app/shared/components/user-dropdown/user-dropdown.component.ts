import {
  Component,
  Output,
  EventEmitter,
  HostListener,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, Subject, takeUntil } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import { UserUiService } from '../../services/user-ui.service';
import { AuthService } from '../../../core/services/auth.service';
import { GlobalFacade } from '../../../core/store/global.facade';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';
import { EnvironmentContextService } from '../../../core/services/environment-context.service';
import { FullscreenService } from '../../services/fullscreen.service';

export interface UserMenuOption {
  label: string;
  icon: string;
  action: () => void;
  type?: 'default' | 'danger';
  condition?: () => boolean;
}

@Component({
  selector: 'app-user-dropdown',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="user-dropdown-container" [class.open]="isOpen">
      <!-- Desktop: Full trigger with user info -->
      <button
        class="user-trigger user-trigger-full hidden md:flex"
        (click)="toggleDropdown()"
        [attr.aria-expanded]="isOpen"
        aria-label="Menú de usuario"
      >
        <div class="user-avatar">
          <span class="user-initials">{{ user.initials || 'US' }}</span>
        </div>
        <div class="user-info">
          <span class="user-name">{{ user.name || 'Usuario' }}</span>
          <span class="user-role">{{ user.role || 'Administrador' }}</span>
        </div>
        <app-icon
          name="chevron"
          [size]="14"
          class="chevron-icon"
          [class.rotate]="isOpen"
        >
        </app-icon>
      </button>

      <!-- Mobile: Minimal trigger -->
      <button
        class="user-trigger user-trigger-minimal flex md:hidden"
        (click)="toggleDropdown()"
        [attr.aria-expanded]="isOpen"
        aria-label="Menú de usuario"
      >
        <div class="user-avatar-minimal">
          <span class="user-initials">{{ user.initials || 'US' }}</span>
        </div>
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
            *ngFor="let option of visibleMenuOptions"
            class="dropdown-item"
            [class.danger]="option.type === 'danger'"
            (click)="handleOptionClick(option)"
          >
            <app-icon
              [name]="option.icon"
              [size]="18"
              class="item-icon"
            ></app-icon>
            <span class="item-label">{{ option.label }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./user-dropdown.component.scss'],
})
export class UserDropdownComponent implements OnInit, OnDestroy {
  @Output() closeDropdown = new EventEmitter<void>();

  isOpen = false;
  isFullscreen = false;
  private destroy$ = new Subject<void>();

  private router = inject(Router);
  private authService = inject(AuthService);
  private globalFacade = inject(GlobalFacade);
  private environmentSwitchService = inject(EnvironmentSwitchService);
  private environmentContextService = inject(EnvironmentContextService);

  private fullscreenService = inject(FullscreenService);
  private userUiService = inject(UserUiService);

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
    // Suscribirse a cambios de fullscreen
    this.fullscreenService.isFullscreen
      .pipe(takeUntil(this.destroy$))
      .subscribe((isFullscreen) => {
        this.isFullscreen = isFullscreen;
        this.updateFullscreenOption();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get user() {
    const context = this.globalFacade.getUserContext();
    if (!context?.user) {
      return {
        name: 'Usuario',
        email: 'user@example.com',
        role: 'Administrador',
        initials: 'US',
      };
    }

    const { user } = context;
    // Build full name from first_name and last_name
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const name = fullName || user.name || 'Usuario';
    const email = user.email || 'user@example.com';
    const initials = this.generateInitials(name !== 'Usuario' ? name : email);

    return {
      name,
      email,
      role: this.getRoleDisplay(context),
      initials,
    };
  }

  menuOptions: UserMenuOption[] = [
    {
      label: 'Mi Perfil',
      icon: 'user',
      action: () => this.goToProfile(),
    },
    {
      label: 'Configuración',
      icon: 'settings',
      action: () => this.goToSettings(),
    },
    {
      label: 'Pantalla Completa',
      icon: 'fullscreen-enter',
      action: () => this.toggleFullscreen(),
      condition: () =>
        this.fullscreenService.isFullscreenSupported() && !this.isFullscreen,
    },
    {
      label: 'Salir de Pantalla Completa',
      icon: 'fullscreen-exit',
      action: () => this.exitFullscreen(),
      condition: () => this.isFullscreen,
    },
    {
      label: 'Administrar Organización',
      icon: 'building',
      action: () => this.switchToOrganization(),
      condition: () => this.canSwitchToOrganization(),
    },
    {
      label: 'Ir a Tienda',
      icon: 'store',
      action: () => this.switchToStore(),
      condition: () => this.canSwitchToStore(),
    },
    {
      label: 'Cerrar Sesión',
      icon: 'logout',
      action: () => this.logout(),
      type: 'danger',
    },
  ];

  get visibleMenuOptions(): UserMenuOption[] {
    return this.menuOptions.filter(
      (option) => !option.condition || option.condition(),
    );
  }

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
    console.log('UserDropdown: goToProfile clicked');
    this.userUiService.openProfile();
    this.isOpen = false;
    this.closeDropdown.emit();
  }

  private goToSettings() {
    this.userUiService.openSettings();
    this.isOpen = false;
    this.closeDropdown.emit();
  }

  private logout() {
    this.authService.logout();
    this.isOpen = false;
    this.closeDropdown.emit();
  }

  private generateInitials(name: string): string {
    return name
      .split(' ')
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase())
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

  private canSwitchToOrganization(): boolean {
    const canSwitch = this.environmentContextService.canSwitchToOrganization();
    return canSwitch;
  }

  private async switchToOrganization(): Promise<void> {
    try {
      const success =
        await this.environmentSwitchService.performEnvironmentSwitch(
          'ORG_ADMIN',
        );

      if (success) {
        // El éxito se maneja en el servicio con la redirección
        console.log('Switched to organization environment');
      } else {
        console.error('Failed to switch to organization environment');
      }
    } catch (error) {
      console.error('Error switching to organization environment:', error);
    }
  }

  private async switchToStore(): Promise<void> {
    try {
      // Obtener la primera tienda disponible del usuario
      const user = this.globalFacade.getUserContext()?.user;
      const availableStores = user?.stores || [];

      if (availableStores.length === 0) {
        console.warn('No stores available for switching');
        return;
      }

      const firstStore = availableStores[0];
      const success =
        await this.environmentSwitchService.performEnvironmentSwitch(
          'STORE_ADMIN',
          firstStore.slug,
        );

      if (success) {
        console.log('Switched to store environment');
      } else {
        console.error('Failed to switch to store environment');
      }
    } catch (error) {
      console.error('Error switching to store environment:', error);
    }
  }

  private canSwitchToStore(): boolean {
    const canSwitch = this.environmentContextService.canSwitchToStore();
    return canSwitch;
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      await this.fullscreenService.toggleFullscreen();
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  }

  private async exitFullscreen(): Promise<void> {
    try {
      await this.fullscreenService.exitFullscreen();
    } catch (error) {
      console.error('Error exiting fullscreen:', error);
    }
  }

  private updateFullscreenOption(): void {
    // Las opciones se actualizan automáticamente mediante las condiciones
    // Esto asegura que el menú se actualice cuando cambia el estado de fullscreen
  }
}
