/**
 * Membership access credential email templates (Anotación 2b — auto-gen + email).
 *
 * Pattern (knowledge gap, see plan section 6): three variants by credential
 * type, all sharing the canonical Vendix green gradient (`#7ED7A5 → #2F6F4E`)
 * and the standard `wrapHtml` shell from `subscription-emails.ts`. Copy is
 * Spanish (es-CO) and inline — no i18n keys by design.
 *
 *   - `credentialQrCreated`            → attaches the QR PNG as
 *     `credencial-qr.png` and shows a styled placeholder in the HTML. The
 *     template is provider-agnostic: it does NOT depend on inline `cid:`
 *     rendering (only SES/SMTP propagates Content-IDs; Resend/SendGrid
 *     currently ignore them — using inline cid there would render a broken
 *     image). The actual QR data is in the attached PNG, ALWAYS visible.
 *   - `credentialPinCreated`           → PIN in the body. Always includes the
 *     "no lo compartas" security note.
 *   - `credentialFingerprintEnrolled`  → enrollment notice ONLY. The biometric
 *     reference (`external_ref`) is an opaque device-side id; the template
 *     NEVER displays it. Ley 1581/2012 (Habeas Data) compliance.
 *
 * Auto-generation policy (Anotación 2b): QR uses `crypto.randomBytes(16)` →
 * 32-char hex; PIN uses `crypto.randomInt(0, 1_000_000)` → 6-digit zero-padded.
 * Uniqueness is verified at write time against the partial unique index
 * `membership_access_cred_active_uq` (Anotación 2a).
 */

const COMPANY_NAME = 'Vendix';
const SUPPORT_EMAIL = 'soporte@vendix.com';

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

export interface CredentialQrData {
  customerName: string;
  storeName: string;
  qrCid: string; // content-id used as <img src="cid:${qrCid}"> in the HTML body
}

export interface CredentialPinData {
  customerName: string;
  storeName: string;
  pin: string; // 6-digit zero-padded
}

export interface CredentialFingerprintData {
  customerName: string;
  storeName: string;
}

export const MembershipAccessEmailTemplates = {
  /**
   * QR credential email. The PNG is attached as `credencial-qr.png` so the
   * member can save/print it. The HTML also embeds a stylized QR-placeholder
   * block (NOT a real QR — clients that strip inline `cid:` would otherwise
   * show a broken image; the real code lives in the attachment).
   *
   * Note: the `qrCid` parameter is kept for forward compatibility with the
   * SES/SMTP path that DOES propagate inline Content-IDs. When the active
   * provider supports it, the inline `<img>` renders; otherwise the styled
   * placeholder is the fallback. Either way the PNG is attached.
   */
  credentialQrCreated(data: CredentialQrData) {
    const subject = `Tu nueva credencial QR — ${data.storeName}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Hola${data.customerName ? ' ' + data.customerName : ''}!</p>
      <p>Hemos creado tu <strong>credencial QR</strong> de acceso para la tienda <strong>${data.storeName}</strong>.</p>
      <p>Presenta el código adjunto (<strong>credencial-qr.png</strong>) en el lector de la entrada para registrar tu acceso.</p>
      <p style="text-align:center;margin:28px 0;">
        <span style="display:inline-block;width:240px;height:240px;border:1px solid #E5E7EB;border-radius:8px;padding:8px;background:#F8FAFC;line-height:224px;color:#6B7280;font-size:13px;">Adjunto: credencial-qr.png</span>
      </p>
      <p style="color:#6B7280;font-size:13px;">Si tu cliente de correo no muestra la imagen adjunta, abre o descarga el archivo <strong>credencial-qr.png</strong> para ver tu código.</p>
      <p>Si no reconoces este registro, escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:#2F6F4E;">${SUPPORT_EMAIL}</a>.</p>
    `;
    const text =
      `¡Hola${data.customerName ? ' ' + data.customerName : ''}!\n\n` +
      `Hemos creado tu credencial QR de acceso para la tienda ${data.storeName}.\n` +
      `Presenta el código adjunto (credencial-qr.png) en el lector de la entrada.\n\n` +
      `Si no reconoces este registro, escríbenos a ${SUPPORT_EMAIL}.`;
    return { subject, html: wrapHtml('Tu credencial QR', body), text };
  },

  /**
   * PIN credential email. The PIN is displayed prominently and the security
   * advisory is always present — we never want a member to share the PIN
   * thinking it is a one-time link.
   */
  credentialPinCreated(data: CredentialPinData) {
    const subject = `Tu nuevo PIN de acceso — ${data.storeName}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Hola${data.customerName ? ' ' + data.customerName : ''}!</p>
      <p>Hemos creado tu <strong>PIN de acceso</strong> para la tienda <strong>${data.storeName}</strong>.</p>
      <p style="background-color:#ECFDF5;border:2px dashed #2F6F4E;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
        <span style="display:block;color:#6B7280;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Tu PIN</span>
        <span style="display:inline-block;background:#FFFFFF;border:1px solid #D1D5DB;border-radius:8px;padding:14px 28px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.4em;color:#1F2937;">${data.pin}</span>
      </p>
      <div style="background-color:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 18px;margin:20px 0;border-radius:8px;color:#78350F;font-size:14px;line-height:1.6;">
        <strong>Importante:</strong> No compartas este PIN con nadie. El personal de la tienda nunca te lo solicitará.
      </div>
      <p>Si no reconoces este registro, escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:#2F6F4E;">${SUPPORT_EMAIL}</a>.</p>
    `;
    const text =
      `¡Hola${data.customerName ? ' ' + data.customerName : ''}!\n\n` +
      `Tu PIN de acceso para la tienda ${data.storeName} es:\n\n` +
      `  ${data.pin}\n\n` +
      `Importante: No compartas este PIN con nadie. El personal de la tienda nunca te lo solicitará.\n\n` +
      `Si no reconoces este registro, escríbenos a ${SUPPORT_EMAIL}.`;
    return { subject, html: wrapHtml('Tu PIN de acceso', body), text };
  },

  /**
   * Fingerprint (`external_ref`) enrollment notice.
   *
   * The biometric TEMPLATE is processed inside the SDK at the device; only an
   * opaque reference id is stored by Vendix. The template itself is NEVER
   * transmitted in the email — and not even the reference is shown here, since
   * it has no meaning to the member. Ley 1581/2012 (Habeas Data).
   */
  credentialFingerprintEnrolled(data: CredentialFingerprintData) {
    const subject = `Registro de tu huella — ${data.storeName}`;
    const body = `
      <p style="font-size:18px;font-weight:600;margin-top:0;">¡Hola${data.customerName ? ' ' + data.customerName : ''}!</p>
      <p>Hemos registrado exitosamente tu <strong>huella dactilar</strong> como método de acceso en <strong>${data.storeName}</strong>.</p>
      <p>Ya puedes ingresar al recinto usando el lector biométrico del acceso.</p>
      <p style="color:#6B7280;font-size:13px;">Por seguridad, Vendix no almacena tu huella. El equipo del gimnasio (dispositivo) la procesa internamente y solo conserva una referencia opaca que no permite reconstruir tu huella.</p>
      <p>Si no reconoces este registro, escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:#2F6F4E;">${SUPPORT_EMAIL}</a>.</p>
    `;
    const text =
      `¡Hola${data.customerName ? ' ' + data.customerName : ''}!\n\n` +
      `Hemos registrado exitosamente tu huella dactilar como método de acceso en ${data.storeName}.\n` +
      `Ya puedes ingresar al recinto usando el lector biométrico del acceso.\n\n` +
      `Por seguridad, Vendix no almacena tu huella. Si no reconoces este registro, escríbenos a ${SUPPORT_EMAIL}.`;
    return {
      subject,
      html: wrapHtml('Registro de huella exitoso', body),
      text,
    };
  },
};
