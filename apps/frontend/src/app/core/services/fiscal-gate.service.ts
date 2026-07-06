import { Injectable, Signal, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PaywallVariant } from './subscription-access.service';

/**
 * F4 — Gate "no responsable de IVA".
 *
 * Clon del molde `SubscriptionAccessService` (paywall) adaptado al ciclo de
 * vida fiscal del IVA. Cuando un comercio que NO es responsable de IVA ante la
 * DIAN intenta asignar IVA a un producto o cobrarlo en una venta, este servicio
 * abre un modal informativo (reutilizando `<app-ai-paywall-modal>` vía
 * `<app-fiscal-gate-outlet>`) con un CTA que lleva al wizard de activación
 * fiscal (`/admin/fiscal/wizard`, protegido por `fiscalManagementGuard`).
 *
 * Es un broker de UI puro: no consulta el backend ni decide la
 * responsabilidad. La detección positiva vive en `AuthFacade.isVatBlocked()`
 * (frontend) y en el enforcement backend (`FISCAL_VAT_NOT_RESPONSIBLE_001`).
 */

/** Origen que disparó el gate — hoy solo hay una variante ('vat_responsible'). */
export type FiscalGateCode = 'vat_responsible';

export interface FiscalGateState {
  code: FiscalGateCode;
  /** Config visual reutilizada por `<app-ai-paywall-modal>`. */
  variant: PaywallVariant;
  /** Copy opcional que sobreescribe la descripción del variant. */
  message?: string;
}

/**
 * Variante visual del gate de IVA. Comparte la forma `PaywallVariant` para
 * poder renderizarse con el mismo modal `variantConfig`-driven del paywall.
 */
const VAT_RESPONSIBLE_VARIANT: PaywallVariant = {
  title: 'Tu comercio aún no es responsable de IVA',
  description:
    'Según tu configuración fiscal (RUT), tu comercio no es responsable de IVA ante la DIAN. Por eso no puedes asignar IVA a un producto ni cobrarlo en una venta. Activa el manejo fiscal y actualiza tus responsabilidades para habilitarlo.',
  ctaLabel: 'Activar manejo fiscal',
  ctaRoute: '/admin/fiscal/wizard',
  severity: 'info',
  category: 'feature-locked',
  iconName: 'receipt',
  badgeLabel: 'IVA no habilitado',
  secondaryCtaLabel: 'Entendido',
};

@Injectable({ providedIn: 'root' })
export class FiscalGateService {
  private readonly router = inject(Router);

  /** Dedupe: evita apilar múltiples modales del mismo gate. */
  private readonly isOpen = signal(false);
  private readonly gateState = signal<FiscalGateState | null>(null);

  /** Vistas read-only consumidas por `<app-fiscal-gate-outlet>`. */
  readonly isFiscalGateOpen: Signal<boolean> = this.isOpen.asReadonly();
  readonly fiscalGateState: Signal<FiscalGateState | null> =
    this.gateState.asReadonly();

  /**
   * Abre el gate "no responsable de IVA". Idempotente: si ya hay un modal
   * abierto, las llamadas adicionales se ignoran.
   */
  openVatResponsibleGate(message?: string): void {
    if (this.isOpen()) return;
    this.gateState.set({
      code: 'vat_responsible',
      variant: VAT_RESPONSIBLE_VARIANT,
      message,
    });
    this.isOpen.set(true);
  }

  /** Cierra el gate sin ejecutar la navegación del CTA. */
  closeGate(): void {
    this.isOpen.set(false);
    this.gateState.set(null);
  }

  /**
   * Dispara el CTA — navega al wizard de activación fiscal y cierra. El
   * `fiscalManagementGuard` decide si el rol tiene permiso (si no, muestra
   * toast + redirect a `/admin/fiscal`).
   */
  triggerCta(): void {
    const current = this.gateState();
    const route = current?.variant.ctaRoute ?? '/admin/fiscal/wizard';
    void this.router.navigateByUrl(route);
    this.closeGate();
  }
}
