import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TenantFacade } from '../../core/store/tenant/tenant.facade';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-storefront-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './storefront-layout.component.html',
  styleUrls: ['./storefront-layout.component.scss']
})
export class StorefrontLayoutComponent implements OnInit, OnDestroy {
  brandingColors: any = {};
  private destroy$ = new Subject<void>();

  constructor(private tenantFacade: TenantFacade) {}

  ngOnInit(): void {
    // Subscribe to tenant branding colors
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.branding?.colors) {
        const colors = tenantConfig.branding.colors;
        this.brandingColors = {
          primary: colors.primary,
          secondary: colors.secondary,
          accent: colors.accent,
          background: colors.background,
          text: colors.text?.primary || colors.text,
          border: colors.surface
        };
        this.setBrandingCSSVariables();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setBrandingCSSVariables(): void {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--primary-color', this.primaryColor);
      root.style.setProperty('--secondary-color', this.secondaryColor);
      root.style.setProperty('--accent-color', this.accentColor);
      root.style.setProperty('--background-color', this.backgroundColor);
      root.style.setProperty('--text-color', this.textColor);
      root.style.setProperty('--border-color', this.borderColor);
    }
  }

  // Helper methods for template colors with defaults
  get primaryColor(): string {
    return this.brandingColors?.primary || '#7ED7A5';
  }

  get secondaryColor(): string {
    return this.brandingColors?.secondary || '#2F6F4E';
  }

  get accentColor(): string {
    return this.brandingColors?.accent || '#FFFFFF';
  }

  get backgroundColor(): string {
    return this.brandingColors?.background || '#F4F4F4';
  }

  get textColor(): string {
    return this.brandingColors?.text || '#222222';
  }

  get borderColor(): string {
    return this.brandingColors?.border || '#B0B0B0';
  }
}