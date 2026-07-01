import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Shared public header used by the PQR public pages
 * (/pqr, /pqr/gracias, /pqr/consultar). Mirrors the landing
 * nav so the visitor feels they're on the same product, not
 * a separate form.
 *
 * Sticky at the top, with the same glassmorphism treatment
 * as the landing's main nav. The mobile menu uses a backdrop
 * overlay + slide-in panel like the landing.
 *
 * Reuses the same vlogo.png as the landing so the brand asset
 * is single-sourced.
 */
@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './public-header.component.html',
  styleUrls: ['./public-header.component.scss'],
})
export class PublicHeaderComponent {
  mobileMenuOpen = false;

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
    if (this.mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
    document.body.style.overflow = '';
  }
}
