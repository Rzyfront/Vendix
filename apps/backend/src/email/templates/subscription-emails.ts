/**
 * Subscription-related email templates (G10 — Vendix SaaS consolidation).
 *
 * All copy is in Spanish (es-CO). No i18n keys: copy is inline by design.
 *
 * IMPORTANT — No-refund disclaimer:
 *   Vendix subscriptions are NOT refundable. The disclaimer MUST appear in
 *   the cancellation and payment-confirmed templates. Removing it requires
 *   product/legal sign-off.
 *
 * Templates return `{ subject, html, text }`. The HTML is intentionally
 * minimal (compatible with most email clients, no external assets). The
 * text version is rendered for clients that block HTML.
 */

const COMPANY_NAME = 'Vendix';
const SUPPORT_EMAIL = 'soporte@vendix.com';

const NO_REFUND_NOTICE_TEXT =
  'Recuerda: las suscripciones de Vendix no son reembolsables. ' +
  'Cancelar detiene la próxima renovación, pero el periodo en curso ' +
  'ya facturado no genera devolución.';

const NO_REFUND_NOTICE_HTML = `
  <div style="background-color:#FEF3C7;border-left:4px solid #F59E0B;padding:16px 20px;margin:24px 0;border-radius:8px;color:#78350F;font-size:14px;line-height:1.6;">
    <strong>Importante:</strong> ${NO_REFUND_NOTICE_TEXT}
  </div>
`;

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background-color:#F8FAFC;color:#1F2937;">
  <div style="max-width:600px;margin:24px auto;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#7ED7A5 0%,#2F6F4E 100%);padding:32px 24px;text-align:center;">
      <h1 style="color:#FFFFFF;margin:0;font-size:24px;font-weight:700;">${title}</h1>
    </div>
    <div style="padding:32px 28px;line-height:1.6;font-size:15px;color:#1F2937;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0 20px;">
      <div style="color:#6B7280;font-size:13px;">
        ¿Necesitas ayuda? Escríbenos a
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#2F6F4E;">${SUPPORT_EMAIL}</a>.
      </div>
    </div>
    <div style="background-color:#1F2937;padding:20px 24px;text-align:center;color:#9CA3AF;font-size:12px;">
      © ${new Date().getFullYear()} ${COMPANY_NAME}. Todos los derechos reservados.
    </div>
  </div>
</body>
</html>`;
}

export interface WelcomeData {
  storeName: string;
  organizationName?: string;
  planName: string;
  panelUrl?: string;
}

export interface CancellationData {
  storeName: string;
  organizationName?: string;
  planName: string;
  endsAt?: string; // formatted date
  reactivateUrl?: string;
  includeNoRefundNotice?: boolean;
}

export interface ReactivationData {
  storeName: string;
  organizationName?: string;
  planName: string;
  nextRenewalDate?: string;
}

export interface TrialEndingData {
  storeName: string;
  organizationName?: string;
  planName: string;
  bucket: 'today' | '1d' | '3d';
  upgradeUrl?: string;
  trialEndsAt?: string; // formatted date
}

export interface PaymentConfirmedData {
  invoiceNumber: string;
  amount: string;
  currency: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  storeName?: string;
  organizationName?: string;
  paymentMethod?: string;
}

export interface DunningData {
  storeName: string;
  planName: string;
  amountDue?: string;
  currency?: string;
  retryUrl?: string;
  daysOverdue?: number;
}

export interface SuspendedData {
  storeName: string;
  planName: string;
  reactivateUrl?: string;
}

export interface PaymentMethodExpiringData {
  storeName: string;
  cardLast4?: string;
  expiresOn?: string;
  updateUrl?: string;
}

export interface PaymentMethodExpiredData {
  storeName: string;
  cardLast4?: string;
  cardBrand?: string;
  expiredOn?: string; // formatted date string ("dd/MM/yyyy")
  updateUrl?: string;
}

export interface PaymentMethodInvalidatedDueToFailuresData {
  storeName: string;
  cardLast4?: string;
  cardBrand?: string;
  consecutiveFailures: number;
  updateUrl?: string;
}

export interface NextRenewalData {
  storeName: string;
  organizationName?: string;
  planName: string;
  renewsAt?: string; // formatted date
  amount?: string;
  currency?: string;
  manageUrl?: string;
}

export interface RetentionOfferData {
  storeName: string;
  planName: string;
  offerDescription?: string;
  acceptUrl?: string;
}

export const SubscriptionEmailTemplates = {
  /** subscription.welcome.email */
  welcome(data: WelcomeData) {
    const subject = `¡Bienvenido a ${COMPANY_NAME}! Tu plan ${data.planName} está activo`;
    const panelLink = data.panelUrl
      ? `<p style="margin:24px 0;text-align:center;">
           <a href="${data.panelUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Ir al panel</a>
         </p>`
      : '';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Hola${data.organizationName ? ' ' + data.organizationName : ''}!</p>
      <p>Tu suscripción al plan <strong>${data.planName}</strong> para la tienda <strong>${data.storeName}</strong> ya está activa.</p>
      <p>Estas son algunas funcionalidades clave que ya tienes disponibles:</p>
      <ul style="padding-left:20px;color:#374151;">
        <li>Gestión completa de inventario y pedidos.</li>
        <li>Reportes financieros y contables.</li>
        <li>Asistente de IA integrado.</li>
        <li>Multi-tienda y multi-canal.</li>
      </ul>
      ${panelLink}
      <p>Cualquier duda, estamos para ayudarte.</p>
    `;
    const text =
      `¡Bienvenido a ${COMPANY_NAME}!\n\n` +
      `Tu plan ${data.planName} para la tienda ${data.storeName} ya está activo.\n\n` +
      `Funcionalidades clave: gestión de inventario, reportes, asistente IA, multi-tienda.\n\n` +
      (data.panelUrl ? `Acceso al panel: ${data.panelUrl}\n\n` : '') +
      `Soporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('¡Bienvenido a Vendix!', body), text };
  },

  /** subscription.cancellation.email */
  cancellation(data: CancellationData) {
    const subject = `Cancelación de tu suscripción ${COMPANY_NAME}`;
    const reactivateBtn = data.reactivateUrl
      ? `<p style="margin:24px 0;text-align:center;">
           <a href="${data.reactivateUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Reactivar suscripción</a>
         </p>`
      : '';
    const noRefundHtml = data.includeNoRefundNotice
      ? NO_REFUND_NOTICE_HTML
      : '';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">Confirmamos la cancelación de tu suscripción.</p>
      <p>Hemos procesado la cancelación del plan <strong>${data.planName}</strong> para la tienda <strong>${data.storeName}</strong>.</p>
      ${data.endsAt ? `<p>Tu acceso continuará hasta <strong>${data.endsAt}</strong>. Después de esa fecha la tienda quedará suspendida.</p>` : ''}
      ${noRefundHtml}
      <p>Si cambiaste de opinión, puedes reactivar tu suscripción en cualquier momento.</p>
      ${reactivateBtn}
    `;
    const noRefundText = data.includeNoRefundNotice
      ? `\n\n${NO_REFUND_NOTICE_TEXT}\n`
      : '';
    const text =
      `Cancelación de tu suscripción ${COMPANY_NAME}\n\n` +
      `Plan: ${data.planName} — Tienda: ${data.storeName}\n` +
      (data.endsAt ? `Acceso hasta: ${data.endsAt}\n` : '') +
      noRefundText +
      (data.reactivateUrl ? `\nReactivar: ${data.reactivateUrl}\n` : '') +
      `\nSoporte: ${SUPPORT_EMAIL}`;
    return {
      subject,
      html: wrapHtml('Cancelación de suscripción', body),
      text,
    };
  },

  /** subscription.reactivation.email */
  reactivation(data: ReactivationData) {
    const subject = `Bienvenido de vuelta a ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Qué bueno tenerte de vuelta!</p>
      <p>Tu suscripción al plan <strong>${data.planName}</strong> para la tienda <strong>${data.storeName}</strong> está reactivada.</p>
      ${data.nextRenewalDate ? `<p>Próxima renovación: <strong>${data.nextRenewalDate}</strong>.</p>` : ''}
      <p>Ya tienes acceso completo a todas las funcionalidades de tu plan.</p>
    `;
    const text =
      `Bienvenido de vuelta a ${COMPANY_NAME}\n\n` +
      `Plan: ${data.planName} — Tienda: ${data.storeName}\n` +
      (data.nextRenewalDate
        ? `Próxima renovación: ${data.nextRenewalDate}\n`
        : '') +
      `\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Bienvenido de vuelta', body), text };
  },

  /** payment.confirmed.email — wraps the canonical EmailTemplates.getPaymentConfirmedTemplate but adds the no-refund disclaimer mandated by G10. */
  paymentConfirmed(data: PaymentConfirmedData) {
    const subject = `Pago confirmado — Factura ${data.invoiceNumber}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Gracias por tu pago!</p>
      <p>Hemos recibido y confirmado el pago de tu suscripción ${COMPANY_NAME}. Detalles:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#F8FAFC;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:10px 14px;color:#6B7280;font-size:14px;">Factura</td><td style="padding:10px 14px;text-align:right;font-weight:600;">${data.invoiceNumber}</td></tr>
        ${data.storeName ? `<tr><td style="padding:10px 14px;color:#6B7280;font-size:14px;border-top:1px solid #E5E7EB;">Tienda</td><td style="padding:10px 14px;text-align:right;font-weight:600;border-top:1px solid #E5E7EB;">${data.storeName}</td></tr>` : ''}
        <tr><td style="padding:10px 14px;color:#6B7280;font-size:14px;border-top:1px solid #E5E7EB;">Plan</td><td style="padding:10px 14px;text-align:right;font-weight:600;border-top:1px solid #E5E7EB;">${data.planName}</td></tr>
        <tr><td style="padding:10px 14px;color:#6B7280;font-size:14px;border-top:1px solid #E5E7EB;">Período</td><td style="padding:10px 14px;text-align:right;font-weight:600;border-top:1px solid #E5E7EB;">${data.periodStart} – ${data.periodEnd}</td></tr>
        ${data.paymentMethod ? `<tr><td style="padding:10px 14px;color:#6B7280;font-size:14px;border-top:1px solid #E5E7EB;">Método de pago</td><td style="padding:10px 14px;text-align:right;font-weight:600;border-top:1px solid #E5E7EB;">${data.paymentMethod}</td></tr>` : ''}
        <tr><td style="padding:14px;color:#166534;font-size:15px;font-weight:700;border-top:2px solid #E5E7EB;">Total pagado</td><td style="padding:14px;text-align:right;color:#166534;font-weight:700;border-top:2px solid #E5E7EB;">${data.amount} ${data.currency}</td></tr>
      </table>
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text =
      `Pago confirmado — Factura ${data.invoiceNumber}\n\n` +
      `Plan: ${data.planName}\n` +
      (data.storeName ? `Tienda: ${data.storeName}\n` : '') +
      `Periodo: ${data.periodStart} – ${data.periodEnd}\n` +
      `Total: ${data.amount} ${data.currency}\n` +
      (data.paymentMethod ? `Método de pago: ${data.paymentMethod}\n` : '') +
      `\n${NO_REFUND_NOTICE_TEXT}\n\n` +
      `Soporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Pago confirmado', body), text };
  },

  /** trial.ending.email — bucket-aware: 3d/1d/today */
  trialEnding(data: TrialEndingData) {
    let subject: string;
    let urgencyMessage: string;
    let title: string;
    switch (data.bucket) {
      case 'today':
        subject = '⚠️ Tu prueba termina hoy';
        title = 'Tu prueba termina hoy';
        urgencyMessage = `<p style="background:#FEE2E2;border-left:4px solid #EF4444;padding:14px 18px;margin:20px 0;border-radius:8px;color:#7F1D1D;">
          <strong>Última oportunidad:</strong> tu período de prueba termina hoy.
          Activa un plan ahora para no perder acceso a tu tienda.
        </p>`;
        break;
      case '1d':
        subject = 'Tu prueba termina mañana';
        title = 'Tu prueba termina mañana';
        urgencyMessage = `<p style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 18px;margin:20px 0;border-radius:8px;color:#78350F;">
          Tu período de prueba termina en menos de 24 horas. Elige un plan
          para mantener el acceso.
        </p>`;
        break;
      case '3d':
      default:
        subject = 'Tu prueba termina en 3 días';
        title = 'Tu prueba termina en 3 días';
        urgencyMessage = `<p>Tu período de prueba en <strong>${COMPANY_NAME}</strong> termina pronto.
          Elige el plan que mejor se ajuste a tu negocio.</p>`;
    }
    const upgradeBtn = data.upgradeUrl
      ? `<p style="margin:24px 0;text-align:center;">
           <a href="${data.upgradeUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Elegir un plan</a>
         </p>`
      : '';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">Hola${data.organizationName ? ' ' + data.organizationName : ''},</p>
      ${urgencyMessage}
      <p>Tienda: <strong>${data.storeName}</strong></p>
      ${data.trialEndsAt ? `<p>Fecha de fin: <strong>${data.trialEndsAt}</strong></p>` : ''}
      ${upgradeBtn}
      <p style="color:#6B7280;font-size:13px;">Si no eliges un plan, tu tienda quedará suspendida y no podrá seguir operando hasta que actives una suscripción.</p>
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text =
      `${subject}\n\n` +
      `Tienda: ${data.storeName}\n` +
      (data.trialEndsAt ? `Fecha de fin: ${data.trialEndsAt}\n` : '') +
      (data.upgradeUrl ? `\nElegir un plan: ${data.upgradeUrl}\n` : '') +
      `\n${NO_REFUND_NOTICE_TEXT}\n` +
      `\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml(title, body), text };
  },

  // -------------------------------------------------------------------------
  // STUBS for future gaps (G6/G11). Subjects + minimal body. No-refund notice
  // included where customer might confuse with refund. Mark with TODO when
  // there is no caller yet.
  // -------------------------------------------------------------------------

  /** dunning.soft.email — TODO: enqueue origin pendiente (G6 dunning) */
  dunningSoft(data: DunningData) {
    const subject = `Recordatorio de pago — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">No pudimos procesar tu pago</p>
      <p>El pago de tu suscripción al plan <strong>${data.planName}</strong> (tienda <strong>${data.storeName}</strong>) no fue procesado.</p>
      ${data.amountDue ? `<p>Monto pendiente: <strong>${data.amountDue} ${data.currency || ''}</strong>.</p>` : ''}
      <p>Reintentaremos automáticamente en las próximas horas. Si quieres adelantar el reintento, ingresa al panel.</p>
      ${data.retryUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.retryUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Reintentar pago</a></p>` : ''}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n${data.amountDue ? `Monto pendiente: ${data.amountDue} ${data.currency || ''}\n` : ''}${data.retryUrl ? `Reintentar: ${data.retryUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Recordatorio de pago', body), text };
  },

  /** dunning.hard.email — TODO: enqueue origin pendiente (G6 dunning) */
  dunningHard(data: DunningData) {
    const subject = `Acción requerida: pago vencido — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;color:#B91C1C;">Tu suscripción está en riesgo de suspensión</p>
      <p>El pago de tu plan <strong>${data.planName}</strong> (tienda <strong>${data.storeName}</strong>) sigue pendiente${data.daysOverdue ? ` desde hace <strong>${data.daysOverdue} días</strong>` : ''}.</p>
      ${data.amountDue ? `<p>Monto pendiente: <strong>${data.amountDue} ${data.currency || ''}</strong>.</p>` : ''}
      <p>Si no recibimos el pago pronto, tu tienda será suspendida y dejará de operar.</p>
      ${data.retryUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.retryUrl}" style="display:inline-block;background:#B91C1C;color:#FFFFFF;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Pagar ahora</a></p>` : ''}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n${data.amountDue ? `Monto pendiente: ${data.amountDue} ${data.currency || ''}\n` : ''}${data.retryUrl ? `Pagar ahora: ${data.retryUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return {
      subject,
      html: wrapHtml('Acción requerida: pago vencido', body),
      text,
    };
  },

  /** subscription.suspended.email — TODO: enqueue origin pendiente (G6) */
  suspended(data: SuspendedData) {
    const subject = `Tu tienda ha sido suspendida — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;color:#B91C1C;">Tu tienda fue suspendida</p>
      <p>La tienda <strong>${data.storeName}</strong> (plan <strong>${data.planName}</strong>) ha sido suspendida por falta de pago.</p>
      <p>Para reactivarla, completa el pago pendiente desde tu panel.</p>
      ${data.reactivateUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.reactivateUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Reactivar tienda</a></p>` : ''}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n${data.reactivateUrl ? `Reactivar: ${data.reactivateUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Tienda suspendida', body), text };
  },

  /** payment.failed.email — TODO: enqueue origin pendiente (G6) */
  paymentFailed(data: DunningData) {
    const subject = `Falló el cobro de tu suscripción — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">No pudimos procesar tu pago</p>
      <p>El cobro de tu plan <strong>${data.planName}</strong> (tienda <strong>${data.storeName}</strong>) no se pudo procesar.</p>
      ${data.amountDue ? `<p>Monto: <strong>${data.amountDue} ${data.currency || ''}</strong>.</p>` : ''}
      <p>Verifica tu método de pago para evitar interrupciones en el servicio.</p>
      ${data.retryUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.retryUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Actualizar método de pago</a></p>` : ''}
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n${data.amountDue ? `Monto: ${data.amountDue} ${data.currency || ''}\n` : ''}${data.retryUrl ? `Actualizar método: ${data.retryUrl}\n` : ''}\n${NO_REFUND_NOTICE_TEXT}\n\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Falló el cobro', body), text };
  },

  /** subscription.next-renewal.email — pre-renewal notice (G8: explicit no-refund disclosure) */
  nextRenewal(data: NextRenewalData) {
    const subject = `Próxima renovación de tu suscripción ${COMPANY_NAME}`;
    const manageBtn = data.manageUrl
      ? `<p style="margin:24px 0;text-align:center;">
           <a href="${data.manageUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Gestionar suscripción</a>
         </p>`
      : '';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">Recordatorio de renovación</p>
      <p>Tu suscripción al plan <strong>${data.planName}</strong> para la tienda <strong>${data.storeName}</strong> se renovará automáticamente${data.renewsAt ? ` el <strong>${data.renewsAt}</strong>` : ' próximamente'}.</p>
      ${data.amount ? `<p>Monto a cobrar: <strong>${data.amount} ${data.currency || ''}</strong>.</p>` : ''}
      <p>Si deseas cancelar la renovación automática puedes hacerlo desde tu panel antes de la fecha de cobro.</p>
      ${manageBtn}
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text =
      `${subject}\n\n` +
      `Plan: ${data.planName} — Tienda: ${data.storeName}\n` +
      (data.renewsAt ? `Renovación: ${data.renewsAt}\n` : '') +
      (data.amount ? `Monto: ${data.amount} ${data.currency || ''}\n` : '') +
      (data.manageUrl ? `\nGestionar: ${data.manageUrl}\n` : '') +
      `\n${NO_REFUND_NOTICE_TEXT}\n\n` +
      `Soporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Próxima renovación', body), text };
  },

  /** subscription.cancellation-immediate.email — TODO: enqueue origin pendiente */
  cancellationImmediate(data: CancellationData) {
    const subject = `Cancelación inmediata de tu suscripción — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">Tu suscripción ha sido cancelada de inmediato</p>
      <p>Hemos cancelado de manera inmediata tu suscripción al plan <strong>${data.planName}</strong> (tienda <strong>${data.storeName}</strong>).</p>
      <p>El acceso a la tienda ha sido revocado.</p>
      ${NO_REFUND_NOTICE_HTML}
      ${data.reactivateUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.reactivateUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Suscribirme nuevamente</a></p>` : ''}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n\n${NO_REFUND_NOTICE_TEXT}\n${data.reactivateUrl ? `\nReactivar: ${data.reactivateUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Cancelación inmediata', body), text };
  },

  /** payment-method.expiring.email — TODO: enqueue origin pendiente */
  paymentMethodExpiring(data: PaymentMethodExpiringData) {
    const subject = `Tu método de pago está por vencer — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">Tu método de pago está por vencer</p>
      <p>El método de pago registrado para <strong>${data.storeName}</strong>${data.cardLast4 ? ` (terminada en <strong>${data.cardLast4}</strong>)` : ''} ${data.expiresOn ? `vence el <strong>${data.expiresOn}</strong>` : 'vence pronto'}.</p>
      <p>Actualízalo para evitar interrupciones en tu suscripción.</p>
      ${data.updateUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.updateUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Actualizar método de pago</a></p>` : ''}
    `;
    const text = `${subject}\n\nTienda: ${data.storeName}\n${data.cardLast4 ? `Tarjeta: ****${data.cardLast4}\n` : ''}${data.expiresOn ? `Vence: ${data.expiresOn}\n` : ''}${data.updateUrl ? `Actualizar: ${data.updateUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Método de pago por vencer', body), text };
  },

  /**
   * payment-method.expired.email — fired by `PaymentMethodExpiryNotifierJob`
   * the day a tokenized card transitions to `state='invalid'` (post-expiry
   * sweep). Includes the canonical NO_REFUND_NOTICE because the customer
   * tends to confuse a missed renewal with a billing dispute.
   */
  paymentMethodExpired(data: PaymentMethodExpiredData) {
    const subject = `Tu tarjeta venció — Actualízala para evitar interrupciones`;
    const cardLine =
      data.cardBrand && data.cardLast4
        ? `${data.cardBrand.toUpperCase()} ****${data.cardLast4}`
        : data.cardLast4
          ? `****${data.cardLast4}`
          : 'tu tarjeta';
    const expiredLine = data.expiredOn
      ? `vencida el <strong>${data.expiredOn}</strong>`
      : 'vencida';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;color:#B91C1C;">Tu tarjeta venció</p>
      <p>El método de pago registrado para la tienda <strong>${data.storeName}</strong> (<strong>${cardLine}</strong>) está ${expiredLine}.</p>
      <p>Para evitar la interrupción del servicio, actualízalo lo antes posible. Mientras la tarjeta esté vencida, los próximos cobros automáticos fallarán y la suscripción podría entrar en mora.</p>
      ${data.updateUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.updateUrl}" style="display:inline-block;background:#B91C1C;color:#FFFFFF;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Actualizar método de pago</a></p>` : ''}
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text =
      `${subject}\n\n` +
      `Tienda: ${data.storeName}\n` +
      `Tarjeta: ${cardLine}\n` +
      (data.expiredOn ? `Venció el: ${data.expiredOn}\n` : '') +
      (data.updateUrl ? `\nActualizar: ${data.updateUrl}\n` : '') +
      `\n${NO_REFUND_NOTICE_TEXT}\n\n` +
      `Soporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Tarjeta vencida', body), text };
  },

  /**
   * subscription.payment-method-invalidated-failures.email — fired by
   * `SubscriptionPaymentService.bumpPaymentMethodFailure` when the saved
   * payment method reaches `MAX_CONSECUTIVE_FAILURES` consecutive failed
   * charges and is auto-marked `state='invalid'`. Includes the canonical
   * NO_REFUND_NOTICE because the customer often confuses repeated declines
   * with a billing dispute.
   */
  subscriptionPaymentMethodInvalidatedDueToFailures(
    data: PaymentMethodInvalidatedDueToFailuresData,
  ) {
    const subject = `Tu tarjeta fue desactivada por intentos fallidos`;
    const cardLine =
      data.cardBrand && data.cardLast4
        ? `${data.cardBrand.toUpperCase()} •••• ${data.cardLast4}`
        : data.cardLast4
          ? `•••• ${data.cardLast4}`
          : 'tu tarjeta';
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;color:#B91C1C;">Tu tarjeta fue desactivada</p>
      <p>Después de <strong>${data.consecutiveFailures} intentos de cobro fallidos consecutivos</strong>, hemos marcado la tarjeta <strong>${cardLine}</strong> registrada en la tienda <strong>${data.storeName}</strong> como inválida.</p>
      <p>Por favor, actualiza tu método de pago para evitar la suspensión del servicio. Mientras no exista una tarjeta válida, los próximos cobros automáticos no podrán ejecutarse y la suscripción podría entrar en mora.</p>
      ${data.updateUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.updateUrl}" style="display:inline-block;background:#B91C1C;color:#FFFFFF;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Actualizar método de pago</a></p>` : ''}
      ${NO_REFUND_NOTICE_HTML}
    `;
    const text =
      `${subject}\n\n` +
      `Tienda: ${data.storeName}\n` +
      `Tarjeta: ${cardLine}\n` +
      `Intentos fallidos consecutivos: ${data.consecutiveFailures}\n` +
      (data.updateUrl ? `\nActualizar: ${data.updateUrl}\n` : '') +
      `\n${NO_REFUND_NOTICE_TEXT}\n\n` +
      `Soporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Tarjeta desactivada', body), text };
  },

  /** retention.offer.email — TODO: enqueue origin pendiente */
  retentionOffer(data: RetentionOfferData) {
    const subject = `Una oferta especial para ti — ${COMPANY_NAME}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡No queremos que te vayas!</p>
      <p>Notamos que tienes una suscripción al plan <strong>${data.planName}</strong> (tienda <strong>${data.storeName}</strong>).</p>
      ${data.offerDescription ? `<p style="background:#ECFDF5;border-left:4px solid #2F6F4E;padding:14px 18px;margin:20px 0;border-radius:8px;">${data.offerDescription}</p>` : '<p>Tenemos una oferta especial para ti. Consulta los detalles ingresando a tu panel.</p>'}
      ${data.acceptUrl ? `<p style="text-align:center;margin:24px 0;"><a href="${data.acceptUrl}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Aceptar oferta</a></p>` : ''}
    `;
    const text = `${subject}\n\nPlan: ${data.planName} — Tienda: ${data.storeName}\n${data.offerDescription ? `\n${data.offerDescription}\n` : ''}${data.acceptUrl ? `\nAceptar: ${data.acceptUrl}\n` : ''}\nSoporte: ${SUPPORT_EMAIL}`;
    return { subject, html: wrapHtml('Oferta especial', body), text };
  },
};

// Exposed for tests.
export const __NO_REFUND_NOTICE__ = NO_REFUND_NOTICE_TEXT;
