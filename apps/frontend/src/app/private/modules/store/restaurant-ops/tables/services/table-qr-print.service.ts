import { Injectable, inject } from '@angular/core';

import { DocumentPrintService } from '../../../../../../shared/services/print';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { Table, TableQrResponse } from '../interfaces';

/**
 * Titular del cartel. Vive aquí arriba y no enterrado en el template string
 * para que cambiarlo sea una edición de una línea y no una arqueología dentro
 * de 200 líneas de HTML.
 */
const QR_HEADLINE = 'ESCANEA NUESTRO MENÚ';

/**
 * Último recurso del color de marca. Se usa SÓLO cuando ninguna de las tres
 * fuentes (settings, snapshot de `vendix_app_config`, variable CSS) entrega un
 * hex válido: un cartel sin color de fondo se lee como un defecto de impresión.
 */
const DEFAULT_PRIMARY = '#b03a2e';

/**
 * Arco del panel blanco, en coordenadas del `viewBox` 0 0 200 100.
 *
 * Sube por los laterales rectos hasta y=62 y de ahí describe el hombro
 * redondeado hasta la meseta del vértice. Los puntos de control salen casi
 * verticales del arranque y llegan casi horizontales al vértice: es lo que lo
 * hace leer como ARCO. Una primera versión con los controles tirando en
 * diagonal (`C0,36 30,30 70,10`) imprimía un pentágono con punta de casa.
 */
const ARCH_VIEWBOX = '0 0 200 100';
const ARCH_PATH =
  'M0,100 L0,62 C0,34 26,8 70,2 C80,0 90,0 100,0 C110,0 120,0 130,2 C174,8 200,34 200,62 L200,100 Z';

/**
 * Luminancia máxima que se acepta para texto de marca sobre el panel BLANCO.
 * 0.18 equivale a ~4.5:1 de contraste, el mínimo WCAG AA para texto normal —
 * y la zona ("TERRAZA") se imprime a 11pt, que es texto normal.
 */
const INK_MAX_LUMINANCE = 0.18;

/** Marca resuelta para el cartel. `primary` siempre es un hex válido. */
interface TableQrBrand {
  primary: string;
  logoUrl: string | null;
  storeName: string;
}

/**
 * Emisor ÚNICO de los carteles QR de mesa.
 *
 * Antes de este servicio había dos emisores duplicados —el botón masivo de
 * `tables-manage-page` y el botón del `table-qr-modal`— cada uno con su propio
 * `printHTML` + `escapeHtml`, imprimiendo una grilla gris sin marca y llamando
 * `print()` inmediatamente después de `doc.close()` (es decir: sin esperar al
 * logo remoto, que salía en blanco en el papel).
 *
 * Aquí se compone UN solo documento HTML con TODAS las hojas y se entrega en
 * UNA sola llamada a `DocumentPrintService.printHtmlDocument`. Imprimir mesa
 * por mesa abriría N diálogos de impresión: para un salón de 40 mesas eso son
 * 40 confirmaciones del operador.
 */
@Injectable({ providedIn: 'root' })
export class TableQrPrintService {
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly storeSettings = inject(StoreSettingsFacade);

  /** Imprime el cartel de UNA mesa (botón "Imprimir" del modal de QR). */
  async printOne(table: Table, qr: TableQrResponse): Promise<void> {
    await this.printMany([table], [qr]);
  }

  /**
   * Imprime un cartel por mesa, todos en el mismo documento.
   *
   * El emparejamiento es POSICIONAL (`tables[i]` ↔ `qrs[i]`), que es como lo
   * devuelve el `forkJoin` del llamador. Los pares sin QR se descartan en vez
   * de imprimir una hoja vacía; si no queda ninguno, no se abre el diálogo.
   */
  async printMany(
    tables: Table[],
    qrs: Array<TableQrResponse | undefined | null>,
  ): Promise<void> {
    const pairs = tables
      .map((table, index) => ({ table, qr: qrs[index] }))
      .filter(
        (pair): pair is { table: Table; qr: TableQrResponse } =>
          !!pair.qr?.qr_data_url,
      );

    if (pairs.length === 0) return;

    const brand = this.resolveBrand();
    const pages = pairs
      .map((pair) => this.buildPage(pair.table, pair.qr, brand))
      .join('');

    await this.documentPrint.printHtmlDocument(
      this.buildDocument(pages, brand),
    );
  }

  // ---------------------------------------------------------------------
  // Composición del documento
  // ---------------------------------------------------------------------

  private buildDocument(pagesHtml: string, brand: TableQrBrand): string {
    // El charset es OBLIGATORIO: el documento viaja por document.write a un
    // iframe que NO hereda de forma fiable la codificación del padre. Sin él,
    // el titular imprime "MENÃš" en vez de "MENÚ", y lo mismo cualquier nombre
    // de tienda o zona con tilde ("Salón", "Árabe").
    return `<html>
  <head>
    <meta charset="utf-8" />
    <title>QR de mesas</title>
    <style>${this.buildStyles(brand)}</style>
  </head>
  <body>${pagesHtml}</body>
</html>`;
  }

  private buildStyles(brand: TableQrBrand): string {
    const primary = brand.primary;
    const onPrimary = this.onPrimaryText(primary);
    // Tinta de marca para lo que va SOBRE el panel blanco. No es lo mismo que
    // el color primario: una marca amarilla o lima imprime un titular invisible
    // sobre blanco, así que ahí se usa el mismo matiz oscurecido hasta ser
    // legible. (Sin comillas invertidas en este comentario: dentro de un método
    // que devuelve un template literal son una fuente conocida de errores.)
    const ink = this.brandInkOnWhite(primary);

    return `
      /* Sin un @page explícito el driver elige su propio papel y descentra
         el cartel. El margen 0 es deliberado: el sangrado de color lo da la
         propia tarjeta, no el margen de la hoja. */
      @page { size: A4 portrait; margin: 0; }

      /* print-color-adjust: exact NO es cosmético. Sin él Chrome descarta los
         fondos de color al imprimir "para ahorrar tinta" y la tarjeta sale
         blanca con texto blanco encima: ilegible. */
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .qr-page {
        width: 210mm;
        height: 297mm;
        box-sizing: border-box;
        padding: 10mm;
        overflow: hidden;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        page-break-inside: avoid;
        /* Stack de sistema a propósito: el iframe de impresión no debe
           depender de la red para renderizar el titular. */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      }

      /* La última hoja NO fuerza salto: si no, un lote de 40 mesas escupe una
         hoja 41 en blanco, que es un defecto real y no una sutileza. */
      .qr-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }

      .qr-card {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 10mm 0 12mm;
        border-radius: 10mm;
        background: ${primary};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .qr-panel { width: 78%; }

      /* display:block elimina el hueco de baseline que deja un <svg> inline y
         que abriría una franja de color entre el arco y el cuerpo blanco. */
      .qr-arch {
        display: block;
        width: 100%;
        height: auto;
      }

      .qr-panel-body {
        background: #ffffff;
        /* El solape de 1px tapa la costura que deja el antialiasing entre el
           borde inferior del SVG y el inicio del div. */
        margin-top: -1px;
        border-radius: 0 0 6mm 6mm;
        /* El padding-top de 1px existe para CORTAR el colapso de márgenes:
           sin él, el margen negativo del logo colapsaría con el del padre y
           subiría el panel entero en vez del logo. */
        padding: 1px 8mm 10mm;
        text-align: center;
      }

      /* El margen superior negativo mete el logo DENTRO del arco; el ancho
         máximo lo mantiene lejos de los laterales curvos. */
      .qr-logo {
        display: block;
        margin: -42mm auto 8mm;
        max-height: 24mm;
        max-width: 55%;
        object-fit: contain;
      }

      .qr-wordmark {
        margin: -38mm 0 8mm;
        font-size: 15pt;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: ${ink};
      }

      .qr-headline {
        margin: 0 0 8mm;
        font-size: 30pt;
        font-weight: 800;
        line-height: 1.05;
        letter-spacing: 0.5px;
        /* Reparte las dos líneas en vez de dejar una viuda de una palabra. */
        text-wrap: balance;
        color: ${ink};
      }

      /* Tienda sin logo Y sin nombre: nadie ocupa el arco, así que el titular
         sube a llenarlo. Sin esto la hoja imprime media cuartilla blanca. */
      .qr-panel-body--bare .qr-headline { margin-top: -24mm; }

      /* El QR va SIN borde ni fondo de color: la zona blanca de silencio a su
         alrededor es parte del símbolo y sin ella el lector falla. */
      .qr-code {
        width: 80mm;
        height: 80mm;
        display: block;
        margin: 0 auto;
      }

      .qr-badge {
        display: inline-block;
        margin-top: 8mm;
        padding: 3mm 9mm;
        border-radius: 999px;
        background: ${primary};
        color: ${onPrimary};
        font-size: 15pt;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .qr-zone {
        margin: 4mm 0 0;
        font-size: 11pt;
        font-weight: 600;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${ink};
      }

      .qr-url {
        margin: 8mm 10mm 0;
        font-size: 8pt;
        text-align: center;
        word-break: break-all;
        color: ${onPrimary};
        opacity: 0.75;
      }
    `;
  }

  private buildPage(
    table: Table,
    qr: TableQrResponse,
    brand: TableQrBrand,
  ): string {
    const zone = (table.zone ?? '').trim();

    // Identidad dentro del arco: el logo si existe, si no el nombre de la
    // tienda como wordmark, y si no hay ninguno el hueco simplemente no se abre.
    let identity = '';
    if (brand.logoUrl) {
      identity = `<img class="qr-logo" src="${this.escapeHtml(brand.logoUrl)}" alt="" />`;
    } else if (brand.storeName) {
      identity = `<div class="qr-wordmark">${this.escapeHtml(brand.storeName)}</div>`;
    }

    const zoneHtml = zone
      ? `<div class="qr-zone">${this.escapeHtml(zone)}</div>`
      : '';

    // Sin identidad el arco quedaría vacío; la clase sube el titular.
    const bodyClass = identity ? 'qr-panel-body' : 'qr-panel-body qr-panel-body--bare';

    return `
      <div class="qr-page">
        <div class="qr-card">
          <div class="qr-panel">
            <svg class="qr-arch" viewBox="${ARCH_VIEWBOX}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
              <path d="${ARCH_PATH}" fill="#ffffff"></path>
            </svg>
            <div class="${bodyClass}">
              ${identity}
              <div class="qr-headline">${this.escapeHtml(QR_HEADLINE)}</div>
              <img class="qr-code" src="${qr.qr_data_url}" alt="" />
              <div><span class="qr-badge">${this.escapeHtml(table.name ?? '')}</span></div>
              ${zoneHtml}
            </div>
          </div>
          <div class="qr-url">${this.escapeHtml(qr.public_url ?? '')}</div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Marca
  // ---------------------------------------------------------------------

  /**
   * Resuelve color primario, logo y nombre de tienda por precedencia:
   *
   * 1. `store_settings.branding` vía facade — la fuente viva.
   * 2. El snapshot `vendix_app_config` de localStorage, que sobrevive a un
   *    refresco antes de que NgRx rehidrate los settings.
   * 3. La variable CSS `--color-primary` que ya pintó `ThemeService`.
   * 4. `DEFAULT_PRIMARY`.
   *
   * `storeName` NO cae a "Vendix": el cartel es de la tienda del cliente, y
   * estampar la marca de la plataforma sería peor que no estampar nada.
   */
  private resolveBrand(): TableQrBrand {
    let primary: string | null = null;
    let logoUrl: string | null = null;
    let storeName = '';

    // 1. Settings del store (fuente de verdad de la marca).
    const branding = this.storeSettings.branding();
    if (branding) {
      primary = primary ?? this.normalizeHex(branding['primary_color']);
      logoUrl = logoUrl ?? this.readString(branding['logo_url']);
      storeName = storeName || (this.readString(branding['name']) ?? '');
    }

    // 2. Snapshot de `vendix_app_config`. Conviven DOS formas en el mismo JSON:
    //    `branding` ya transformado por `ThemeService.transformBrandingFromApi`
    //    (`branding.logo.url`, `branding.colors.primary`) y la forma cruda de la
    //    API bajo `domainConfig.customConfig.branding` (`logo_url`,
    //    `primary_color`). Se leen ambas, defensivamente, dentro del try.
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('vendix_app_config')
          : null;
      if (raw) {
        const parsed = JSON.parse(raw) as any;
        const transformed = parsed?.branding;
        const apiBranding = parsed?.domainConfig?.customConfig?.branding;

        primary =
          primary ??
          this.normalizeHex(transformed?.colors?.primary) ??
          this.normalizeHex(transformed?.primary_color) ??
          this.normalizeHex(apiBranding?.primary_color);

        logoUrl =
          logoUrl ??
          this.readString(transformed?.logo?.url) ??
          this.readString(transformed?.logo_url) ??
          this.readString(apiBranding?.logo_url) ??
          this.readString(parsed?.domainConfig?.store_logo_url);

        storeName =
          storeName ||
          (this.readString(apiBranding?.name) ??
            this.readString(transformed?.logo?.alt) ??
            this.readString(parsed?.domainConfig?.store_name) ??
            '');
      }
    } catch {
      // Un localStorage bloqueado o un JSON corrupto degradan a la variable CSS;
      // nunca deben impedir imprimir.
    }

    // 3. Variable CSS ya aplicada al documento. Puede venir vacía o no ser hex
    //    (color-mix, rgb(...)), por eso pasa igual por normalizeHex.
    if (!primary) {
      try {
        primary = this.normalizeHex(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--color-primary',
          ),
        );
      } catch {
        primary = null;
      }
    }

    return {
      primary: primary ?? DEFAULT_PRIMARY,
      logoUrl,
      storeName,
    };
  }

  // ---------------------------------------------------------------------
  // Color
  // ---------------------------------------------------------------------

  /**
   * Normaliza `#RGB` / `#RRGGBB` (con o sin `#`) a `#rrggbb` en minúsculas.
   * Devuelve `null` ante cualquier otra cosa — y eso es lo que impide que un
   * valor de settings acabe inyectado crudo dentro del `<style>`.
   */
  private normalizeHex(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const raw = value.trim().replace(/^#/, '').toLowerCase();

    if (/^[0-9a-f]{3}$/.test(raw)) {
      return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    if (/^[0-9a-f]{6}$/.test(raw)) {
      return `#${raw}`;
    }
    return null;
  }

  /** Luminancia relativa WCAG de un hex ya normalizado (0 = negro, 1 = blanco). */
  private relativeLuminance(hex: string): number {
    const channel = (start: number): number => {
      const c = parseInt(hex.slice(start, start + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    const r = channel(1);
    const g = channel(3);
    const b = channel(5);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Texto legible sobre el color de marca.
   *
   * No es adorno: una tienda con marca amarilla o lima y texto blanco encima
   * imprime un badge ilegible. El umbral 0.6 elige negro apenas el fondo es
   * claro, que es el caso que rompe en papel.
   */
  private onPrimaryText(hex: string): string {
    return this.relativeLuminance(hex) < 0.6 ? '#ffffff' : '#111111';
  }

  /**
   * Versión del color de marca legible SOBRE BLANCO.
   *
   * El titular, el wordmark y la zona viven sobre el panel blanco, no sobre el
   * fondo de color, así que `onPrimaryText` no los cubre: una tienda amarilla
   * imprimía "ESCANEA NUESTRO MENÚ" en amarillo sobre blanco, invisible en
   * papel. Se oscurece el MISMO matiz —escalando los tres canales— en vez de
   * caer a negro, para que el cartel siga siendo de la marca.
   */
  private brandInkOnWhite(hex: string): string {
    let ink = hex;
    for (
      let i = 0;
      i < 24 && this.relativeLuminance(ink) > INK_MAX_LUMINANCE;
      i++
    ) {
      ink = this.scaleHex(ink, 0.9);
    }
    return ink;
  }

  /** Multiplica los tres canales por `factor`, acotando a 0..255. */
  private scaleHex(hex: string, factor: number): string {
    const channel = (start: number): string => {
      const value = Math.round(
        parseInt(hex.slice(start, start + 2), 16) * factor,
      );
      return Math.max(0, Math.min(255, value))
        .toString(16)
        .padStart(2, '0');
    };

    return `#${channel(1)}${channel(3)}${channel(5)}`;
  }

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
