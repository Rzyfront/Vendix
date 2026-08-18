import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    // Dashboard HTML en /api/ (legacy). Se conserva como estaba antes del
    // cambio de JSON en /, porque la raíz `/` se atiende por adapter Express
    // (ver main.ts) y este método queda disponible si alguien lo quiere
    // reexponer en otra ruta NestJS.
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const colombiaDate = new Date(utc - 5 * 60 * 60000);
    const version = process.env.npm_package_version || '1.0.0';
    return `
      <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f8fafc 60%,#e0e7ef 100%);">
        <div style="max-width:340px;width:100%;padding:18px 20px 16px 20px;border-radius:18px;box-shadow:0 0 32px 4px rgba(0,255,100,0.18),0 2px 16px rgba(0,0,0,0.10);background:#fff;font-family:sans-serif;text-align:center;">
          <h2 style="color:#16a34a;margin-bottom:6px;font-size:1.3em;letter-spacing:0.5px;">🚀 Vendix Backend</h2>
          <p style="font-size:1em;margin-bottom:12px;color:#222;">System operational and healthy <span style='color:#16ff6a;text-shadow:0 0 8px #16ff6a77;'>●</span></p>
          <div style="margin-bottom:6px;font-size:0.98em;">🕒 <b>Colombia Time:</b> ${colombiaDate.toLocaleString('en-US', { hour12: false })}</div>
          <div style="margin-bottom:6px;font-size:0.98em;">📦 <b>Version:</b> ${version}</div>
          <div style="margin-bottom:6px;font-size:0.98em;">💻 <b>Node:</b> ${process.version}</div>
          <div style="margin-bottom:6px;font-size:0.98em;">⏱️ <b>Uptime:</b> ${Math.floor(process.uptime())}s</div>
        </div>
      </div>
    `;
  }

  getStatus(): Record<string, unknown> {
    // Status JSON consumido por `/` (raíz). Diferencia con /api/health: este
    // endpoint es estático, no toca memoria ni heap, y es el que sirven
    // uptime-checks externos que solo quieren "ok/vivo".
    const version = process.env.npm_package_version || '1.0.0';
    return {
      status: 'ok',
      service: 'Vendix API',
      version,
      node: process.version,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}