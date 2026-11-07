import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { VendixLandingComponent } from './vendix-landing.component';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { PublicPlansService } from '../../pricing/services/public-plans.service';

/**
 * SEO-TECH-09: «Planes y Precios» del menú es un enlace real a /pricing
 * (rastreable, abrible en otra pestaña y enfocable con Tab), no un botón de scroll.
 */
describe('VendixLandingComponent menu links (SEO-TECH-09)', () => {
  let fixture: ComponentFixture<VendixLandingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VendixLandingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: TenantFacade, useValue: { tenantConfig$: of(null) } },
        { provide: PublicPlansService, useValue: { list$: of({ success: true, data: [] }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VendixLandingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  function pricingLinks(): HTMLAnchorElement[] {
    return fixture.debugElement
      .queryAll(By.css('header a'))
      .map((el) => el.nativeElement as HTMLAnchorElement)
      .filter((a) => a.textContent?.trim() === 'Planes y Precios');
  }

  function pricingButtons(): HTMLButtonElement[] {
    return fixture.debugElement
      .queryAll(By.css('header button'))
      .map((el) => el.nativeElement as HTMLButtonElement)
      .filter((b) => b.textContent?.trim() === 'Planes y Precios');
  }

  it('renders the desktop "Planes y Precios" item as a link to /pricing', () => {
    const links = pricingLinks();
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/pricing');
    expect(links[0].tabIndex).toBe(0);
    expect(pricingButtons().length).toBe(0);
  });

  it('renders the mobile "Planes y Precios" item as a link that closes the menu', async () => {
    fixture.componentInstance.toggleMobileMenu();
    fixture.detectChanges();
    await fixture.whenStable();

    const links = pricingLinks();
    expect(links.length).toBe(2);
    expect(links.every((a) => a.getAttribute('href') === '/pricing')).toBeTrue();
    expect(pricingButtons().length).toBe(0);

    links[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.mobileMenuOpen()).toBeFalse();
  });

  function menuToggle(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('header button[aria-controls="landing-mobile-menu"]'))
      .nativeElement as HTMLButtonElement;
  }

  it('exposes the mobile menu state to screen readers and closes it with Escape', async () => {
    const toggle = menuToggle();
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Abrir menú de navegación');
    expect(fixture.nativeElement.querySelector('#landing-mobile-menu')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const menu = fixture.nativeElement.querySelector('#landing-mobile-menu') as HTMLElement;
    expect(menu.tagName).toBe('NAV');
    expect(menu.getAttribute('aria-label')).toBe('Menú principal');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Cerrar menú de navegación');

    // Keyboard: every item in the drawer is a focusable button or link.
    const items = Array.from(menu.querySelectorAll<HTMLElement>('a, button'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((el) => el.tabIndex === 0)).toBeTrue();

    menu.querySelector('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.mobileMenuOpen()).toBeFalse();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('#landing-mobile-menu')).toBeNull();
  });
});
