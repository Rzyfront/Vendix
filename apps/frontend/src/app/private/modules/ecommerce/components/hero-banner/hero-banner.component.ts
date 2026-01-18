import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TenantFacade } from '../../../../../../app/core/store';

export interface HeroBannerConfig {
  title: string;
  subtitle: string;
  image_url?: string;
  background_color?: string;
  text_color?: string;
  cta_text: string;
  cta_link: string;
  show_overlay?: boolean;
}

@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss'],
})
export class HeroBannerComponent {
  @Input() banner: Partial<HeroBannerConfig> = {};
  @Input() class = '';

  private domain_service = inject(TenantFacade);
  private router = inject(Router);

  get banner_config(): HeroBannerConfig {
    const tenantConfig = this.domain_service.getCurrentTenantConfig();

    return {
      title: this.banner.title || 'Bienvenido a nuestra tienda',
      subtitle: this.banner.subtitle || 'Encuentra los mejores productos al mejor precio',
      image_url: this.banner.image_url || undefined,
      background_color: this.banner.background_color || tenantConfig?.branding?.colors?.primary || 'var(--color-primary)',
      text_color: this.banner.text_color || '#ffffff',
      cta_text: this.banner.cta_text || 'Ver productos',
      cta_link: this.banner.cta_link || '/catalog',
      show_overlay: this.banner.show_overlay ?? true,
    };
  }

  onCtaClick(): void {
    this.router.navigate([this.banner_config.cta_link]);
  }
}
