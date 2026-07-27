import { Injectable, Inject, DOCUMENT, PLATFORM_ID, signal, DestroyRef, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { BrandingConfig, ThemeConfig, ThemeMode, ThemePreset } from '../models/tenant-config.interface';
import { AppConfig } from './app-config.service';
import { ColorUtils } from '../utils/color.utils';

export type { ThemeMode, ThemePreset };

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  /**
   * Monocromo en modo CLARO: peso hacia blanco del "escalón interior" —bandas de
   * panel, cabecera y pie de modal, `thead`, bordes—. No sale de la escala porque
   * el paso que le correspondía (300) pasó a ser el `--color-surface`; si ambos
   * compartieran valor la jerarquía se aplanaría. Lo consumen dos sitios
   * (applyStylePreset y applyMonocromoScale) y tienen que coincidir, de ahí la
   * constante.
   */
  private static readonly MONO_LIGHT_INSET = 0.38;

  /**
   * Paletas DECORATIVAS de Tailwind que el remapeo de tailwind.config.js no
   * cubre: no tienen token semántico equivalente (¿qué es un "morado" en la
   * escala info/success/warning/error?) y por eso quedaron como hex estáticos.
   *
   * Son 460 usos —`bg-purple-100` del mosaico de "Ingresos", `bg-indigo-50` de
   * los chips de canal, `bg-yellow-100`, `bg-sky-50`— y en sus pasos claros valen
   * casi blanco (#f3e8ff, #eef2ff, #fef9c3). Como no son tokens, NADA los mueve:
   * se ven igual de blancos en monocromo que en oscuro.
   *
   * Aquí solo se guarda el hue de referencia (el paso 500 de Tailwind); el nivel
   * lo recalcula buildMonoSemanticTints contra la superficie del preset. En el
   * tema base estos tokens no existen y tailwind.config.js cae al hex original,
   * así que default no cambia.
   */
  private static readonly DECORATIVE_HUES: { [family: string]: string } = {
    purple: '#A855F7',
    violet: '#8B5CF6',
    indigo: '#6366F1',
    pink: '#EC4899',
    rose: '#F43F5E',
    orange: '#F97316',
    teal: '#14B8A6',
    cyan: '#06B6D4',
    sky: '#0EA5E9',
    yellow: '#EAB308',
  };

  /**
   * Cuánto se acerca cada hue a la superficie ANTES de corregirle el nivel.
   *
   * Igualar solo la luminancia reproduce el *valor* que el tinte tiene en el tema
   * base pero no su *croma*: sobre blanco, un `purple-100` (#f3e8ff) está tan
   * desaturado como su fondo y se lee como un susurro; el mismo cálculo sobre la
   * superficie verde devolvía un lavanda saturado (#E0C2FC) que, a igual nivel,
   * grita por distancia de tono. Este peso sangra el croma hacia la superficie
   * para recuperar esa cohesión, y como el nivel se restituye después por
   * bisección, el sangrado no puede oscurecer ni aclarar el tinte.
   *
   * 0.4 es el techo útil: por encima, error y warning vuelven a converger al mismo
   * oliva (el fallo del primer intento, que mezclaba a peso ~1).
   */
  private static readonly MONO_HUE_BLEED = 0.4;

  /**
   * Las familias decorativas admiten bastante más sangrado que las semánticas.
   *
   * Un `purple-50` con la luminancia igualada a la tarjeta AÚN se lee como un chip
   * lavanda encendido: el efecto Helmholtz–Kohlrausch hace que un tono saturado y
   * frío aparente más claridad de la que mide, así que igualar luminancia no basta
   * para que se funda. Con las semánticas hay que aguantarse —rojo tiene que
   * seguir leyéndose como rojo— pero purple/indigo/pink/teal… no significan nada:
   * el color que informa es el del glifo (paso 600, intacto), no el del relleno.
   */
  private static readonly MONO_HUE_BLEED_DECORATIVE = 0.62;

  readonly currentTheme = signal<ThemeConfig | null>(null);
  public currentTheme$ = toObservable(this.currentTheme);

  private loadedFonts = new Set<string>();
  private injectedStyleElements = new Map<string, HTMLStyleElement>();
  private currentBranding: BrandingConfig | null = null;

  /* ── Dos ejes ──
     activeMode: light | dark | system (system sigue prefers-color-scheme).
     activePreset: default | aura | monocromo | glass. */
  private activeMode: ThemeMode = 'light';
  private activePreset: ThemePreset = 'default';

  /* Snapshot para revert de preview en el modal de Configuración:
     al abrir se captura el (mode, preset) persistido; al cancelar se restaura. */
  private snapshot: { mode: ThemeMode; preset: ThemePreset } | null = null;

  /* Listener vivo para modo "system" (matchMedia). Se remueve al cambiar de
     modo o al destruir el servicio. */
  private mediaQueryList: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  private isBrowser: boolean;
  private destroyRef = inject(DestroyRef);

  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    // Limpieza del listener de sistema al destruir el servicio.
    this.destroyRef.onDestroy(() => this.detachSystemListener());
    // Restaura las preferencias persistidas en el arranque. NO se puede depender
    // solo de applyThemeEffect$: el estado de auth se hidrata con
    // provideState('auth', ..., { initialState: hydrateAuthState() }), sin
    // despachar restoreAuthState, así que en una recarga ninguna acción llega al
    // effect y el tema guardado se perdía (volvía a light/default).
    this.initFromPersistedPreferences();
  }

  /**
   * Lee config.preferences.{theme_mode, theme} del estado de auth persistido y
   * aplica ambos ejes. Idempotente y tolerante a un localStorage ausente o
   * corrupto (sesión anónima, primer arranque): en ese caso deja los defaults.
   */
  private initFromPersistedPreferences(): void {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem('vendix_auth_state');
      if (!raw) return;
      const prefs = JSON.parse(raw)?.user_settings?.config?.preferences;
      if (!prefs) return;
      const mode: ThemeMode =
        prefs.theme_mode === 'dark' || prefs.theme_mode === 'system'
          ? prefs.theme_mode
          : 'light';
      void this.applyThemePreferences(mode, prefs.theme ?? 'default');
    } catch {
      // Estado ilegible: se conservan los defaults (light/default).
    }
  }

  /* ════════════════════════════════════════════════════════════
   * EJE MODO
   * ════════════════════════════════════════════════════════════ */

  /**
   * Aplica el modo (claro/oscuro/sistema). "system" sigue prefers-color-scheme
   * con un listener vivo que repinta al cambiar el OS. En SSR no hace nada.
   */
  applyMode(mode: ThemeMode, reapplyPreset = true): void {
    this.activeMode = mode;
    if (!this.isBrowser) return;

    this.detachSystemListener();

    if (mode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQueryList = mql;
      this.applyResolvedMode(mql.matches);
      // Listener vivo: repinta cuando el OS cambia de scheme. Re-aplica el preset
      // completo, no solo la escala: el preset deriva sus mezclas del surface del
      // modo activo y decide qué variables pinear inline según claro/oscuro.
      this.mediaListener = () => {
        void this.applyStylePreset(this.activePreset);
      };
      mql.addEventListener('change', this.mediaListener);
    } else {
      this.applyResolvedMode(mode === 'dark');
    }

    // Cambiar de modo invalida los overrides inline del preset (se derivaron del
    // surface del modo anterior). Sin esto, pasar a oscuro dejaba el surface claro
    // pineado inline y el modo no se veía. `reapplyPreset=false` lo omite cuando
    // el llamador va a aplicar el preset a continuación (applyThemePreferences).
    if (reapplyPreset) {
      void this.applyStylePreset(this.activePreset);
    }
  }

  /** Resuelve el atributo data-theme al modo efectivo (light/dark). */
  private applyResolvedMode(isDark: boolean): void {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  /** Devuelve true si el modo efectivo actual es dark. */
  isDarkMode(): boolean {
    if (!this.isBrowser) return this.activeMode === 'dark';
    if (this.activeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return this.activeMode === 'dark';
  }

  private detachSystemListener(): void {
    if (this.mediaQueryList && this.mediaListener) {
      this.mediaQueryList.removeEventListener('change', this.mediaListener);
    }
    this.mediaQueryList = null;
    this.mediaListener = null;
  }

  /* ════════════════════════════════════════════════════════════
   * EJE ESTILO (preset)
   * ════════════════════════════════════════════════════════════ */

  /**
   * Aplica un preset de estilo (default/aura/glass/monocromo). Deriva SIEMPRE
   * del primario del comercio (nada de morado/rosa fijo). Limpia overrides del
   * preset anterior (incluida la escala neutral de monocromo) antes de aplicar.
   */
  async applyStylePreset(preset: ThemePreset | string): Promise<void> {
    const normalized = this.normalizePreset(preset);
    this.activePreset = normalized;
    // SSR: skip DOM-heavy theme operations (getComputedStyle, body.style, etc.)
    if (!this.isBrowser) return;

    const root = this.document.documentElement;
    const body = this.document.body;

    // 1) Limpiar overrides del preset anterior ANTES de leer las bases. Si se
    //    leyera primero, getComputedStyle devolvería el surface ya teñido por el
    //    preset previo y el tinte se acumularía (aura sobre aura sobre aura).
    body.style.removeProperty('background-image');
    body.style.removeProperty('background-attachment');
    body.style.removeProperty('background-color');
    this.resetThemeOverrides();

    const isDark = this.isDarkMode();

    // 2) Branding del comercio. Los colores de MARCA (primary/secondary/accent)
    //    se pinean inline en ambos modos: el primario siempre sigue al comercio.
    //    Los de SUPERFICIE y TEXTO solo en claro — en oscuro los define el bloque
    //    [data-theme="dark"] de styles.scss, y un inline en <html> le gana en
    //    especificidad, lo que dejaba el modo oscuro sin ningún efecto visible.
    const brandColors = this.currentBranding?.colors;
    if (brandColors) {
      // En dark un primario oscuro (azul marino, vino) se pierde sobre superficies
      // oscuras: se sube la luminosidad conservando el hue del comercio.
      const primary = isDark
        ? this.adaptPrimaryForDark(brandColors.primary)
        : brandColors.primary;
      const brandVars: { [key: string]: string | undefined } = {
        '--color-primary': primary,
        '--color-secondary': brandColors.secondary,
        '--color-accent': brandColors.accent,
        '--color-primary-rgb': this.hexToRgbString(primary),
        '--color-secondary-rgb': this.hexToRgbString(brandColors.secondary),
        '--color-accent-rgb': this.hexToRgbString(brandColors.accent),
      };
      if (!isDark) {
        Object.assign(brandVars, {
          '--color-background': brandColors.background,
          '--color-surface': brandColors.surface,
          '--color-text-primary': brandColors.text?.primary,
          '--color-text-secondary': brandColors.text?.secondary,
          '--color-text-muted': brandColors.text?.muted,
          '--color-background-rgb': this.hexToRgbString(brandColors.background),
          '--color-surface-rgb': this.hexToRgbString(brandColors.surface),
        });
      }
      this.setCssVariables(brandVars);
    }

    // 3) Base para derivar el preset: el primario ya refleja modo (bloque dark
    //    + adaptPrimaryForDark) y marca. Se lee del computado, no del branding
    //    crudo, para no perder la adaptación de luminosidad en oscuro.
    const computed = getComputedStyle(root);
    const basePrimary =
      this.asHex(computed.getPropertyValue('--color-primary')) || '#2ecc71';

    let overrides: { [key: string]: string | undefined } = {};

    switch (normalized) {
      case 'aura': {
        // Aura NO toca los fondos: background, surface y textos quedan idénticos
        // al default. El preset consiste EXCLUSIVAMENTE en la flama animada que
        // el bloque CSS `[data-theme-preset="aura"]` pinta DENTRO de cada
        // superficie surface (vía background-image sobre el color base).
        // Teñir el token aquí achataba el efecto: la flama competía contra un
        // surface ya teñido y el resultado era un manchón plano.
        break;
      }

      case 'monocromo': {
        // Monocromo: un ÚNICO tono —el hue del primario del comercio— en dos
        // niveles sólidos, sin degradados ni animación (ahí está la diferencia
        // con aura, que usa el mismo tinte pero en movimiento):
        //   · background = variante OSCURA  del primario
        //   · surface    = variante CLARA   del primario
        //
        // La escala la construye buildMonoScale y NO generateScale: generateScale
        // amortigua la saturación en los extremos (l>85 → ×0.55), así que el
        // extremo claro salía casi blanco (#F3F7F2 con un primario verde) y el
        // preset se veía como "lienzo verde + tarjetas blancas" en vez de una
        // mezcla monocromática. buildMonoScale mezcla contra #FFF/#000 en pasos
        // fijos, que conserva el tinte a la vista en TODA la escala.
        //
        // En light: lienzo verde profundo con superficies verde claro teñido.
        // En dark: lienzo casi negro teñido con superficies un paso más arriba,
        // también teñidas. En ambos el escalón background→surface se lee sin
        // meter un gris neutro que rompería el monocromo.
        const monoScale = this.buildMonoScale(basePrimary, isDark);
        // El lienzo claro no sale de un paso de la escala sino de un peso propio,
        // para poder afinarlo sin mover la escala que usan textos y bordes. 0.33
        // hacia negro queda entre el paso 600 (0.383) y el 500 (0.27).
        // Techo de legibilidad: el rótulo del cromo es `--mono-50` (lum ≈ 0.94) y a
        // peso 0.383 daba 5.0:1; a 0.33 da ≈4.1:1 y a 0.27 baja a 3.4:1. Aclarar más
        // entra en la trampa del tono medio, donde ni el extremo claro ni el oscuro
        // llegan a 4.5:1 sobre el lienzo.
        const monoBackground = isDark
          ? monoScale['50']
          : ColorUtils.mixColors(basePrimary, '#000000', 0.33);
        // Light toma el paso 300 (52% blanco): es literalmente el tono que tenía
        // la cabecera de las tablas, el punto donde el verde se lee como color y
        // no como un blanco sucio. Los pasos más claros (200 = 70%, o el 63% que
        // se probó antes) dejaban el tinte solo insinuado.
        // Dark se queda en el 200 de su orden invertido: subir un paso más aclara
        // la superficie y hunde los tintes semánticos (el rojo de error cae a 1.9).
        const monoSurface = isDark ? monoScale['200'] : monoScale['300'];
        // Superficie secundaria: un escalón HACIA el lienzo desde el surface, para
        // que las bandas (encabezados y pies de modales y paneles) se lean como
        // jerarquía y no como otro color. Sin teñirla, los componentes que la usan
        // —y los alias huérfanos que apuntan a ella— metían un gris azulado
        // ajeno al tono y el monocromo se rompía en manchas.
        //
        // En claro ya NO puede ser el paso 300: ese tono se lo acaba de quedar el
        // surface y la banda desaparecería dentro de la tarjeta (el <thead> se
        // fundiría con el cuerpo de la tabla). Baja al peso MONO_LIGHT_INSET, que
        // reproduce la MISMA relación que el tema base entre tarjeta y banda
        // (~1.11:1 de luminancia) un escalón más abajo en la familia.
        const monoSurfaceAlt = isDark
          ? monoScale['100']
          : ColorUtils.mixColors(basePrimary, '#FFFFFF', ThemeService.MONO_LIGHT_INSET);
        // Texto que vive DIRECTAMENTE sobre el lienzo (fuera de toda superficie).
        // En light el fondo es oscuro y el texto primario es oscuro: sin este
        // token, cualquier rótulo suelto sobre el lienzo queda ilegible.
        const monoTextOnBackground = isDark ? monoScale['900'] : monoScale['50'];
        // El SECUNDARIO del comercio (un azul saturado en Roku) era el único
        // acento que seguía rompiendo la mezcla: monocromo tiene UN solo hue, y
        // 112 usos —el botón "Cerrar" de cada modal, pasos de wizard, tooltips—
        // lo pintaban azul en medio del verde. Se sustituye por un paso propio de
        // la familia elegido por PROMINENCIA relativa al primario, no por
        // posición en la escala: la escala se invierte en dark y el paso
        // equivalente allí quedaría MÁS claro que el primario, es decir más
        // llamativo que la acción principal.
        //   · claro: paso 500 (27% negro) — subordinado al primario, que es el 700.
        //   · oscuro: 35% negro sobre el primario crudo — se despega del lienzo
        //     sin acercarse al brillo del primario.
        const monoSecondary = isDark
          ? ColorUtils.mixColors(basePrimary, '#000000', 0.35)
          : monoScale['500'];
        // Relleno INVERSO: el texto de los botones sólidos sale de
        // `--color-text-on-primary`, clavado a blanco en :root. En claro el
        // primario baja al paso 700 y el blanco funciona; en OSCURO el primario es
        // el verde CLARO del comercio y el blanco cae a 2.03:1 —"Editar Perfil"
        // ilegible en el pie del modal—. Se elige por contraste entre los dos
        // extremos de la escala monocroma (no blanco/#0F172A como pickForeground,
        // que metería un azul-gris ajeno a la familia).
        const monoPrimary = isDark ? basePrimary : monoScale['700'];
        const monoOnPrimary =
          ColorUtils.contrastRatio(monoPrimary, monoScale['50']) >=
          ColorUtils.contrastRatio(monoPrimary, monoScale['900'])
            ? monoScale['50']
            : monoScale['900'];
        overrides = {
          '--color-secondary': monoSecondary,
          '--color-secondary-rgb': this.hexToRgbString(monoSecondary),
          '--color-text-on-primary': monoOnPrimary,
          // El LIENZO no viaja en `--color-background`. Ese token se usa en ~150
          // sitios del código NO como "fondo de página" sino como "un escalón por
          // DENTRO de la superficie": encabezados y pies de paneles, hovers de
          // fila, mosaicos dentro de una card, el <thead> de app-table. En el tema
          // base los dos significados coinciden (el lienzo es un gris apenas por
          // debajo del blanco del surface), pero en monocromo divergen: el lienzo
          // es verde PROFUNDO. Publicarlo aquí metía una franja oscura con texto
          // oscuro dentro de cada panel claro (medido: los rótulos del <thead> de
          // órdenes a 1.67 y el correo del user-dropdown a 1.62).
          //
          // Así que el token conserva su significado mayoritario —el escalón
          // interior— y el lienzo se publica aparte en `--mono-canvas`, que
          // consumen las reglas de styles.scss para body/main/layouts y para el
          // cromo (donde el escalón SÍ es el lienzo).
          '--mono-canvas': monoBackground,
          '--mono-canvas-rgb': this.hexToRgbString(monoBackground),
          // Primario crudo del comercio, guardado antes de oscurecerlo: lo vuelve
          // a poner el CSS del cromo, donde el fondo ES el lienzo oscuro y el
          // primario claro es exactamente lo que se quiere ver.
          '--mono-brand': basePrimary,
          '--mono-brand-rgb': this.hexToRgbString(basePrimary),
          '--color-background': monoSurfaceAlt,
          '--color-background-rgb': this.hexToRgbString(monoSurfaceAlt),
          '--color-surface': monoSurface,
          '--color-surface-secondary': monoSurfaceAlt,
          '--color-surface-rgb': this.hexToRgbString(monoSurface),
          '--color-text-on-background': monoTextOnBackground,
          // Alias que consumen los <main> con background inline en los layouts y
          // las máscaras sticky móviles (`bg-background`): esas SÍ quieren el
          // lienzo, porque tapan contenido que scrollea por debajo.
          '--background': monoBackground,
        };
        // En CLARO el primario del comercio se oscurece un paso dentro de su
        // propia familia. Los precios, importes y botones de texto pintan con
        // `var(--color-primary)` sobre la superficie CLARA, y un primario claro
        // sobre superficie clara es ilegible: medido 1.68:1 en el total de la
        // orden y en "Por enviar". Bajarlo al paso 700 mantiene el hue —sigue
        // siendo monocromo— y de paso arregla el relleno inverso (blanco sobre
        // primario pasa de 2.06 a ~7:1).
        // En OSCURO no se toca: ahí el primario claro es justo lo que contrasta.
        if (!isDark) {
          overrides['--color-primary'] = monoScale['700'];
          overrides['--color-primary-rgb'] = this.hexToRgbString(monoScale['700']);
          overrides['--color-primary-light'] = monoScale['200'];
        }
        break;
      }

      case 'glass': {
        // Glass: NO se tiñe --color-surface. La translucidez la aplica el bloque
        // [data-theme-preset="glass"] de styles.scss solo al "chrome" (cards,
        // header, sidebar, modales) sobre los blobs de body::before. Teñir el
        // token global mezclaba el primario con TODA superficie (inputs, tablas,
        // celdas) y producía el velo lechoso verdoso.
        overrides = {
          // El alias --background lo consumen contenedores con inline style; si
          // queda opaco tapa el blur. Translúcido y derivado de surface-rgb para
          // que en dark siga siendo oscuro.
          '--background': 'rgba(var(--color-surface-rgb), 0.25)',
          // El texto atenuado se endurece SOLO en glass. Va aquí y no en el
          // bloque CSS del preset porque estos tokens se escriben como estilo
          // INLINE en <html>, y el inline gana a cualquier regla de la hoja:
          // declararlo en styles.scss era un no-op silencioso (verificado).
          // Motivo del ajuste: el #858F9D base rinde 3.27:1 sobre blanco y sobre
          // el panel translúcido baja a ~2.96:1 — "No registrado" o el label
          // "CUENTA" se leían lavados. Estos valores recuperan ~4.6:1 sin
          // igualar al texto primario, así que la jerarquía se conserva.
          '--color-text-muted': isDark ? '#B6C0CF' : '#5C6672',
          '--color-text-tertiary': isDark ? '#B6C0CF' : '#5C6672',
        };
        break;
      }

      case 'default':
      default:
        // Default: se queda con la configuración de branding restaurada arriba.
        break;
    }

    if (Object.keys(overrides).length > 0) {
      this.setCssVariables(overrides);
    }

    // Escala neutral monocroma (después de los overrides de surface/background).
    if (normalized === 'monocromo') {
      this.applyMonocromoScale();
    }

    root.setAttribute('data-theme-preset', normalized);
  }

  /**
   * Reemplaza la escala neutral (--color-neutral-50..900 + rgb) por una derivada
   * del primario del comercio, invertida si el modo efectivo es dark.
   */
  private applyMonocromoScale(): void {
    if (!this.isBrowser) return;
    const root = this.document.documentElement;
    const primary =
      this.currentBranding?.colors?.primary ||
      getComputedStyle(root).getPropertyValue('--color-primary').trim() ||
      '#2ecc71';
    const isDark = this.isDarkMode();
    const scale = this.buildMonoScale(primary, isDark);
    // ── Tramo claro COMPRIMIDO, solo en modo claro ──
    // `bg-gray-50/100/200` y `border-gray-200/300` son "un matiz por encima de la
    // tarjeta", no un bloque de otro color: en el tema base gray-50 está a 1.04:1
    // del blanco del surface. Con la escala cruda ese mismo paso quedaba a 1.24:1
    // de la superficie teñida —ocho veces el salto previsto— y los 385 usos de
    // esas clases se leían como parches BLANCOS sobre el verde. Aquí se recalculan
    // los cuatro pasos para reproducir las distancias del tema base (1.04 / 1.11 /
    // 1.27 / 1.62) medidas contra el surface de monocromo.
    //
    // Van SOLO a `--color-neutral-*`, no a `--mono-*`: la copia cruda la consume el
    // espejo del cromo, donde el 50 es el RÓTULO sobre el lienzo y tiene que seguir
    // siendo el extremo claro. Comprimirla allí hundiría el texto del sidebar.
    // Se publican además como `--mono-tile-*` para que el CSS que deshace el espejo
    // dentro de las islas del cromo pueda recuperarlas.
    const tileWeights: { [key: string]: number } = {
      '50': 0.47,
      '100': 0.38,
      '200': 0.2,
      '300': -0.05,
    };
    const tiles: { [key: string]: string } = {};
    if (!isDark) {
      for (const shade of Object.keys(tileWeights)) {
        const w = tileWeights[shade];
        tiles[shade] = ColorUtils.mixColors(primary, w >= 0 ? '#FFFFFF' : '#000000', Math.abs(w));
      }
    }
    const vars: { [key: string]: string | undefined } = {};
    for (const shade of Object.keys(scale)) {
      vars[`--color-neutral-${shade}`] = tiles[shade] ?? scale[shade];
      // Copia cruda de la escala bajo otro nombre. La necesita el CSS del chrome
      // (sidebar/header) para ESPEJAR la escala en modo claro sin ciclos: escribir
      // `--color-neutral-900: var(--color-neutral-50)` dentro del mismo bloque que
      // redefine el 50 crea una dependencia circular y CSS invalida ambas. Con
      // `--mono-*` como fuente inmutable, el espejo es una asignación limpia.
      vars[`--mono-${shade}`] = scale[shade];
      const rgb = ColorUtils.hexToRgb(scale[shade]);
      if (rgb) vars[`--mono-${shade}-rgb`] = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      // El gemelo rgb tiene que salir del MISMO color que se publicó arriba: si el
      // paso está comprimido y el rgb sigue el crudo, `bg-gray-100/80` (que pinta
      // por la vía rgba) se despega de `bg-gray-100`.
      const rgbTile = ColorUtils.hexToRgb(tiles[shade] ?? scale[shade]);
      if (rgbTile) vars[`--color-neutral-${shade}-rgb`] = `${rgbTile.r}, ${rgbTile.g}, ${rgbTile.b}`;
      if (tiles[shade]) {
        vars[`--mono-tile-${shade}`] = tiles[shade];
        if (rgbTile) vars[`--mono-tile-${shade}-rgb`] = `${rgbTile.r}, ${rgbTile.g}, ${rgbTile.b}`;
      }
    }
    // Textos y bordes también en la escala monocroma. Sin esto el preset apenas
    // se distingue de default: la mayoría de los componentes pintan con
    // var(--color-text-*) (del branding, gris neutro) y no con text-gray-*, así
    // que reemplazar solo la escala de Tailwind dejaba toda la tipografía gris.
    // buildMonoScale invierte el orden en dark, de modo que 900 es el extremo
    // legible contra la superficie en ambos modos.
    // El reparto 900/700/600 copia el del tema base (lum ≈ 0.02 / 0.11 / 0.19):
    // con los pesos recalibrados el 800 ya es el LIENZO, así que usarlo de texto
    // secundario aplastaba la jerarquía en tres tonos casi idénticos.
    //
    // En CLARO ese reparto se corre un paso hacia abajo. La superficie dejó de ser
    // casi blanca (paso 200, lum 0.81) y ahora es el verde de la cabecera de tabla
    // (paso 300, lum 0.70): sobre ella el 600 se queda en 3.5:1 y el secundario en
    // 4.0, por debajo de AA. Con 800/700 la jerarquía vuelve a leerse —medido
    // 9.2 / 6.7 / 4.9— sin salir de la familia monocroma.
    // En OSCURO no se toca: allí la superficie es oscura y el reparto original ya
    // está calibrado contra ella.
    const textPrimary = scale['900'];
    const textSecondary = isDark ? scale['700'] : scale['800'];
    const textMuted = isDark ? scale['600'] : scale['700'];
    // El borde seguía el paso 300, que en claro AHORA es el propio surface: los
    // bordes se volvían invisibles. Baja al mismo escalón interior que las bandas.
    const border = isDark
      ? scale['300']
      : ColorUtils.mixColors(primary, '#FFFFFF', ThemeService.MONO_LIGHT_INSET);
    vars['--color-text-primary'] = textPrimary;
    vars['--color-text-secondary'] = textSecondary;
    vars['--color-text-muted'] = textMuted;
    vars['--color-border'] = border;
    const rgb900 = ColorUtils.hexToRgb(textPrimary);
    const rgbSecondary = ColorUtils.hexToRgb(textSecondary);
    const rgbMuted = ColorUtils.hexToRgb(textMuted);
    if (rgb900) vars['--color-text-primary-rgb'] = `${rgb900.r}, ${rgb900.g}, ${rgb900.b}`;
    if (rgbSecondary)
      vars['--color-text-secondary-rgb'] = `${rgbSecondary.r}, ${rgbSecondary.g}, ${rgbSecondary.b}`;
    if (rgbMuted) vars['--color-text-muted-rgb'] = `${rgbMuted.r}, ${rgbMuted.g}, ${rgbMuted.b}`;
    Object.assign(vars, this.buildMonoSemanticTints(root, isDark ? scale['200'] : scale['300']));
    this.setCssVariables(vars);
  }

  /**
   * Re-ancla los tramos CLAROS de las escalas semánticas (info/success/warning/
   * error, pasos 50/100/200) a la superficie de monocromo.
   *
   * Son 1.165 usos —`bg-blue-100` de un icono en mosaico, `bg-amber-50` de un
   * aviso, el relleno de casi todos los badges de tabla— y en el tema base valen
   * casi blanco (#eff6ff, #d1fae5, #fef3c7, #fef2f2). Sobre una superficie teñida
   * eso NO se lee como "azul muy claro": se lee como un parche blanco flotando, y
   * era la mayor fuente de blancos que quedaba tras barrer `bg-white` y los
   * literales `#fff`.
   *
   * El arreglo mantiene el HUE —un badge de error tiene que seguir leyéndose como
   * error; monocromo tiñe el chasis, no la semántica— y corrige solo el NIVEL: el
   * tinte se diluye contra blanco (o contra negro en dark, como hace la paleta
   * base) hasta caer en la MISMA relación de luminancia con la superficie que
   * tenía en el tema base (1.04 / 1.14 / 1.35). Así deja de glarear como parche
   * blanco sin volverse un bloque de color.
   *
   * Diluir contra la superficie en vez de contra blanco —el primer intento— no
   * sirve: a un peso capaz de bajar el nivel, el verde de la superficie se come el
   * hue y error (#C7CEAA) y warning (#C7DAA2) acaban siendo el mismo oliva.
   *
   * Se calcula en TS y no con `color-mix()` en el SCSS por dos razones: Tailwind
   * consume estas escalas por el gemelo `-rgb` (`rgba(var(--color-info-100-rgb), α)`)
   * para soportar `bg-blue-100/80`, y una terna `r, g, b` no se puede derivar de un
   * `color-mix()`; y el peso de dilución depende de la luminancia del primario del
   * comercio, que solo se conoce en runtime.
   */
  private buildMonoSemanticTints(
    root: HTMLElement,
    surface: string,
  ): { [key: string]: string } {
    // Relación de luminancia tinte↔superficie en el tema base (superficie blanca):
    // #eff6ff→1.04, #dbeafe→1.14, #bfdbfe→1.35.
    const targetRatios: { [shade: string]: number } = { '50': 1.04, '100': 1.14, '200': 1.35 };
    const isDark = this.isDarkMode();
    const surfaceL = ColorUtils.relativeLuminance(surface);
    const computed = getComputedStyle(root);
    const out: { [key: string]: string } = {};
    const seeds: { [family: string]: string } = {};
    for (const family of ['info', 'success', 'warning', 'error']) {
      // El 500 es el hue "puro" de la familia y ya viene invertido por modo desde
      // el bloque [data-theme="dark"] de styles.scss, así que sirve de semilla en
      // los dos modos sin duplicar tablas de color aquí.
      seeds[family] = computed.getPropertyValue(`--color-${family}-500`).trim();
    }
    Object.assign(seeds, ThemeService.DECORATIVE_HUES);
    for (const family of Object.keys(seeds)) {
      const hue = seeds[family];
      if (!hue.startsWith('#')) continue;
      // Dos operaciones separadas y en este orden: primero croma (acercar el tono
      // a la superficie), después nivel (bisección hacia el ancla). Fundirlas en
      // una sola mezcla es lo que mataba el hue: la misma mezcla tenía que bajar
      // el nivel Y cohesionar, y para lo primero hacía falta un peso que arrasaba
      // con lo segundo.
      const bleed =
        family in ThemeService.DECORATIVE_HUES
          ? ThemeService.MONO_HUE_BLEED_DECORATIVE
          : ThemeService.MONO_HUE_BLEED;
      const bled = ColorUtils.mixColors(hue, surface, bleed);
      const bledL = ColorUtils.relativeLuminance(bled);
      for (const shade of Object.keys(targetRatios)) {
        const ratio = targetRatios[shade];
        // En claro el tinte queda por DEBAJO de la superficie (sin llegar al nivel
        // de la tarjeta); en oscuro, por ENCIMA, que es como se comporta la paleta
        // base allí (#172554 sobre #0f1724).
        const targetL = isDark
          ? ratio * (surfaceL + 0.05) - 0.05
          : (surfaceL + 0.05) / ratio - 0.05;
        // El ancla se elige por dirección, no por modo: tras el sangrado un hue
        // puede quedar del lado equivocado del objetivo (el amarillo sangrado ya
        // es más oscuro que el paso 200 en claro) y con un ancla fija la bisección
        // no tendría hacia dónde converger — devolvería el color sin corregir.
        const anchor = targetL > bledL ? '#FFFFFF' : '#000000';
        out[`--color-${family}-${shade}`] = this.mixToLuminance(bled, anchor, targetL);
        const rgb = ColorUtils.hexToRgb(out[`--color-${family}-${shade}`]);
        if (rgb) out[`--color-${family}-${shade}-rgb`] = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      }
    }
    return out;
  }

  /**
   * Busca por bisección el peso de mezcla `base → anchor` cuya luminancia relativa
   * es la más cercana a `targetL`. La luminancia es monótona en el peso, así que
   * 20 iteraciones bastan y evitan asumir una relación analítica entre el peso en
   * espacio gamma y la luminancia lineal.
   */
  private mixToLuminance(base: string, anchor: string, targetL: number): string {
    let lo = 0;
    let hi = 1;
    let best = base;
    const anchorIsLighter =
      ColorUtils.relativeLuminance(anchor) >= ColorUtils.relativeLuminance(base);
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      best = ColorUtils.mixColors(base, anchor, mid);
      const l = ColorUtils.relativeLuminance(best);
      if (l < targetL === anchorIsLighter) lo = mid;
      else hi = mid;
    }
    return best;
  }

  /**
   * Escala monocroma teñida: 10 pasos que salen del primario del comercio
   * mezclando contra blanco y negro en pesos fijos, con el orden invertido en
   * dark ('50' es el extremo oscuro allí, igual que la escala neutral del tema).
   *
   * Por qué no `ColorUtils.generateScale`: esa trabaja en HSL y amortigua la
   * saturación en los extremos (l>85 → ×0.55, l<20 → ×0.7) para que las escalas
   * neutrales no queden chillonas. Aquí ese amortiguado es justo lo que sobra: el
   * paso claro terminaba en un blanco-gris (#F3F7F2 con un primario verde) y el
   * preset dejaba de ser monocromático — lienzo teñido con tarjetas blancas.
   * Mezclar en sRGB baja la saturación al acercarse al blanco, pero el tinte
   * sigue siendo visible, que es la premisa del preset.
   */
  private buildMonoScale(primary: string, isDark: boolean): { [key: string]: string } {
    const WHITE = '#FFFFFF';
    const BLACK = '#000000';
    // Peso de la mezcla por paso, medido desde el primario. Positivo = hacia
    // blanco, negativo = hacia negro.
    //
    // Los pesos NO están repartidos alrededor del primario: están calibrados para
    // reproducir el PERFIL DE LUMINOSIDAD de la escala neutral del tema base
    // (gray-50 ≈ 0.95 … gray-400 ≈ 0.36 … gray-900 ≈ 0.03). Es lo que exige el
    // código que consume la escala: `text-gray-400` es un rótulo apagado y
    // `bg-gray-100` es una superficie, y esos roles dependen de DÓNDE cae cada
    // paso en luminosidad, no de su distancia al primario.
    //
    // Versión anterior: el 500 era el primario crudo y los pasos se abrían a
    // ambos lados. Con un primario claro (el verde #7CC672 de la marca, lum 0.51)
    // eso empujaba TODO el tramo 400↓ por encima de su luminosidad esperada y
    // `text-gray-400` salía verde pálido sobre la superficie clara: 1.32:1 medido
    // en el detalle de orden (SKU, fechas). Ahora el 400 ya cruza hacia el negro,
    // así que la escala es monótona y cada paso vuelve a su papel.
    //
    // El primario crudo deja de vivir en la escala: se publica aparte como
    // `--mono-brand` para quien lo necesite tal cual (el cromo).
    const steps: { [key: string]: number } = {
      '50': 0.9,
      '100': 0.82,
      '200': 0.7, // superficie
      '300': 0.52, // borde / escalón interior
      '400': -0.135,
      '500': -0.27,
      '600': -0.383, // texto apagado
      '700': -0.493, // texto secundario
      '800': -0.605, // lienzo
      '900': -0.72, // texto principal
    };
    const scale: { [key: string]: string } = {};
    for (const shade of Object.keys(steps)) {
      // En dark el orden se invierte: el paso que en light tira a blanco tira a
      // negro y al revés, así '50' sigue siendo "el extremo del fondo" y '900'
      // "el extremo del texto" en los dos modos, y quien lee la escala no tiene
      // que ramificar por modo.
      const weight = isDark ? -steps[shade] : steps[shade];
      scale[shade] =
        weight === 0
          ? primary
          : ColorUtils.mixColors(primary, weight > 0 ? WHITE : BLACK, Math.abs(weight));
    }
    return scale;
  }

  /**
   * Devuelve el valor solo si es un HEX de 3/6 dígitos, o null. ColorUtils.mixColors
   * exige HEX: con `rgb(...)`, `oklch(...)` o un nombre de color devolvería el
   * color1 sin mezclar, pintando la superficie con el primario a full.
   */
  private asHex(value: string | null | undefined): string | null {
    const v = (value ?? '').trim();
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null;
  }

  /**
   * Sube la luminosidad del primario del comercio para modo oscuro conservando su
   * hue. Un primario oscuro (azul marino, vino, verde bosque) sobre superficies
   * #0F1724 queda ilegible; se garantiza ~4.5:1 contra la superficie oscura sin
   * cambiar la identidad de marca.
   */
  private adaptPrimaryForDark(hex: string): string {
    const hsl = ColorUtils.hexToHsl(hex);
    if (!hsl) return hex;
    // 62% de luminosidad es el punto donde cualquier hue supera 4.5:1 sobre #0F1724.
    if (hsl.l >= 62) return hex;
    // Saturación tope 80%: los colores muy saturados y claros vibran sobre negro.
    return ColorUtils.hslToHex(hsl.h, Math.min(hsl.s, 80), 62);
  }

  /** Normaliza un valor de preset (acepta strings/legacy) a un ThemePreset válido. */
  private normalizePreset(preset: string): ThemePreset {
    const valid: ThemePreset[] = ['default', 'aura', 'monocromo', 'glass'];
    return (valid as string[]).includes(preset) ? (preset as ThemePreset) : 'default';
  }

  /* ════════════════════════════════════════════════════════════
   * API legacy / conveniencia
   * ════════════════════════════════════════════════════════════ */

  /**
   * Aplica modo + preset de una vez (conveniencia para el effect que lee
   * config.preferences.{theme_mode, theme}).
   */
  async applyThemePreferences(mode: ThemeMode, preset: ThemePreset | string): Promise<void> {
    // reapplyPreset=false: el preset se aplica en la línea siguiente; dejar que
    // applyMode lo aplique además duplicaría el trabajo con el preset anterior.
    this.applyMode(mode, false);
    await this.applyStylePreset(preset);
  }

  /**
   * Alias legacy de applyStylePreset. Mantiene compatibilidad con llamadores
   * que solo conocían el eje estilo (settings-modal, effects antiguos).
   * @deprecated usar applyThemePreferences / applyStylePreset.
   */
  async applyUserTheme(theme: 'default' | 'aura' | 'monocromo' | 'glass' | string): Promise<void> {
    await this.applyStylePreset(theme);
  }

  /* ── Snapshot / restore para revert de preview ── */

  /** Captura el (mode, preset) actual para restaurar al cancelar un preview. */
  snapshotTheme(): void {
    this.snapshot = { mode: this.activeMode, preset: this.activePreset };
  }

  /** Restaura el (mode, preset) capturado por snapshotTheme. No-op si no hay snapshot. */
  async restoreTheme(): Promise<void> {
    if (!this.snapshot) return;
    const { mode, preset } = this.snapshot;
    this.snapshot = null;
    await this.applyThemePreferences(mode, preset);
  }

  /** Descarta el snapshot sin restaurar. Útil tras un guardado exitoso: evita
   *  que el cierre del modal llame a restoreTheme y revierta el cambio recién
   *  persistido (el effect de auth ya re-aplicó el tema nuevo). */
  clearThemeSnapshot(): void {
    this.snapshot = null;
  }

  /* ════════════════════════════════════════════════════════════
   * Overrides / reset
   * ════════════════════════════════════════════════════════════ */

  /**
   * Resetea solo los overrides de preset, permitiendo que el branding base o
   * el CSS global vuelva a actuar. Incluye la escala neutral de monocromo.
   */
  private resetThemeOverrides(): void {
    const root = this.document.documentElement;
    root.removeAttribute('data-theme-preset');

    // Debe remover TODA variable que este servicio pueda pinear inline en
    // <html>. Una que sobreviva le gana al bloque [data-theme="dark"] (inline >
    // selector de atributo) y deja el modo oscuro parcialmente sin efecto —
    // exactamente el bug de "dark no hace nada".
    const variablesToRemove = [
      '--color-primary',
      '--color-primary-rgb',
      '--color-secondary',
      '--color-secondary-rgb',
      '--color-accent',
      '--color-accent-rgb',
      '--color-ring',
      '--color-primary-light',
      '--color-background',
      '--color-background-rgb',
      '--color-surface',
      '--color-surface-rgb',
      '--color-text-primary',
      '--color-text-primary-rgb',
      '--color-text-secondary',
      '--color-text-secondary-rgb',
      '--color-text-muted',
      '--color-text-muted-rgb',
      '--color-text-on-primary', // monocromo: relleno inverso por luminancia
      '--color-border', // monocromo tiñe el borde con la escala
      '--color-surface-secondary', // monocromo tiñe la superficie secundaria
      '--color-text-on-background', // monocromo: texto sobre el lienzo oscuro
      '--mono-canvas', // monocromo: lienzo, separado de --color-background
      '--mono-canvas-rgb',
      '--mono-brand', // monocromo: primario crudo antes de oscurecerlo en claro
      '--mono-brand-rgb',
      '--background', // glass override
    ];
    // Escala neutral que monocromo pudo haber sobreescrito, más su copia cruda.
    for (const shade of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']) {
      variablesToRemove.push(
        `--color-neutral-${shade}`,
        `--color-neutral-${shade}-rgb`,
        `--mono-${shade}`,
        `--mono-${shade}-rgb`,
        // Tramo claro comprimido (solo existe en monocromo claro, pasos 50-300).
        `--mono-tile-${shade}`,
        `--mono-tile-${shade}-rgb`,
      );
    }
    // Tramo claro de las escalas semánticas y decorativas, re-anclado a la
    // superficie por monocromo (ver buildMonoSemanticTints).
    for (const family of [
      'info',
      'success',
      'warning',
      'error',
      ...Object.keys(ThemeService.DECORATIVE_HUES),
    ]) {
      for (const shade of ['50', '100', '200']) {
        variablesToRemove.push(`--color-${family}-${shade}`, `--color-${family}-${shade}-rgb`);
      }
    }
    variablesToRemove.forEach((varName) => root.style.removeProperty(varName));
  }

  /* ════════════════════════════════════════════════════════════
   * App config / branding
   * ════════════════════════════════════════════════════════════ */

  /**
   * Aplica la configuración completa de la app (theme, branding, seo)
   */
  async applyAppConfiguration(appConfig: AppConfig): Promise<void> {
    try {
      if (appConfig.branding) {
        await this.applyBranding(appConfig.branding);
      }
    } catch (error) {
      console.error('Error applying app configuration:', error);
      throw error;
    }
  }

  /**
   * Aplica el tema CSS.
   * @deprecated El branding ahora maneja todos los aspectos visuales.
   */
  async applyTheme(themeConfig: ThemeConfig): Promise<void> {
    const themeStyles: { [key: string]: string | undefined } = {
      '--color-primary': themeConfig.primaryColor,
      '--color-secondary': themeConfig.secondaryColor,
      '--color-accent': themeConfig.accentColor,
      '--color-background': themeConfig.backgroundColor,
      '--color-text-primary': themeConfig.textColor,
      '--border-radius': themeConfig.borderRadius,
      '--font-base': themeConfig.fontFamily,
    };

    this.setCssVariables(themeStyles);
    if (themeConfig.spacing) {
      this.setCssVariables(this.flattenObject(themeConfig.spacing, 'spacing'));
    }
    if (themeConfig.shadows) {
      this.setCssVariables(this.flattenObject(themeConfig.shadows, 'shadow'));
    }

    if (themeConfig.fontFamily) {
      await this.loadFont(themeConfig.fontFamily);
    }
    this.currentTheme.set(themeConfig);
  }

  /**
   * Aplica la configuración de branding, sobreescribiendo los valores por defecto del CSS.
   * Re-aplica modo + preset sobre el nuevo branding para evitar condiciones de carrera
   * (applyBranding sobreescribe variables que applyStylePreset había ajustado).
   */
  async applyBranding(brandingConfig: BrandingConfig): Promise<void> {
    this.currentBranding = brandingConfig;
    // Los colores NO se pinean aquí: applyStylePreset (al final de este método) es
    // el único punto que escribe variables de color en <html>, y lo hace según el
    // modo activo. Escribirlas aquí además provocaba un flash de superficies claras
    // en modo oscuro y duplicaba la lógica de qué variable es segura pinear.

    if (brandingConfig.fonts) {
      const fontStyles: { [key: string]: string | undefined } = {
        '--font-primary': brandingConfig.fonts.primary,
        '--font-secondary': brandingConfig.fonts.secondary,
        '--font-headings': brandingConfig.fonts.headings,
      };
      this.setCssVariables(fontStyles);

      for (const font of Object.values(fontStyles)) {
        if (font) await this.loadFont(font);
      }
    }

    if (brandingConfig.customCSS) {
      this.injectCustomCSS(brandingConfig.customCSS, 'custom-branding');
    }

    if (brandingConfig.favicon) {
      this.updateFavicon(brandingConfig.favicon);
    }

    // Re-aplicar modo + preset sobre el nuevo branding (anti-race).
    await this.applyThemePreferences(this.activeMode, this.activePreset);
  }

  /* ════════════════════════════════════════════════════════════
   * Helpers
   * ════════════════════════════════════════════════════════════ */

  /**
   * Convierte un color HEX a string RGB para uso en CSS variables.
   */
  private hexToRgbString(hex: string | undefined): string | undefined {
    if (!hex) return undefined;
    const rgb = ColorUtils.hexToRgb(hex);
    if (!rgb) return undefined;
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  }

  /**
   * Establece un conjunto de variables CSS en el elemento raíz.
   */
  private setCssVariables(variables: { [key: string]: string | undefined }): void {
    const root = this.document.documentElement;
    Object.entries(variables).forEach(([key, value]) => {
      if (value) {
        root.style.setProperty(key, value);
      }
    });
  }

  /**
   * Aplana un objeto anidado para usarlo como variables CSS.
   */
  private flattenObject(obj: object, prefix: string): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    Object.entries(obj).forEach(([key, value]) => {
      result[`--${prefix}-${key}`] = value;
    });
    return result;
  }

  /**
   * Carga una fuente externa
   */
  async loadFont(fontFamily: string): Promise<void> {
    if (!fontFamily || this.loadedFonts.has(fontFamily)) {
      return;
    }

    try {
      const fontName = this.extractFontName(fontFamily);
      if (this.isGoogleFont(fontName)) {
        await this.loadGoogleFont(fontName);
      }
      this.loadedFonts.add(fontFamily);
    } catch (error) {
      console.error(`Failed to load font: ${fontFamily}`, error);
    }
  }

  private isGoogleFont(fontName: string): boolean {
    const googleFonts = [
      'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
      'Poppins', 'Nunito', 'Ubuntu', 'Raleway', 'Work Sans',
    ];
    return googleFonts.includes(fontName);
  }

  private extractFontName(fontFamily: string): string {
    return fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  }

  private async loadGoogleFont(fontName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const linkId = `google-font-${fontName.toLowerCase().replace(' ', '-')}`;
      if (this.document.getElementById(linkId)) {
        resolve();
        return;
      }

      const link = this.document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(' ', '+')}:wght@300;400;500;600;700&display=swap`;

      link.onload = () => resolve();
      link.onerror = () =>
        reject(new Error(`Failed to load Google Font: ${fontName}`));

      this.document.head.appendChild(link);
    });
  }

  injectCustomCSS(css: string, id: string = 'custom-css'): void {
    if (this.injectedStyleElements.has(id)) {
      const oldElement = this.injectedStyleElements.get(id)!;
      oldElement.remove();
    }

    const styleElement = this.document.createElement('style');
    styleElement.id = id;
    styleElement.textContent = css;

    this.document.head.appendChild(styleElement);
    this.injectedStyleElements.set(id, styleElement);
  }

  updateFavicon(faviconUrl: string): void {
    try {
      let favicon = this.document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (!favicon) {
        favicon = this.document.createElement('link');
        favicon.rel = 'icon';
        this.document.head.appendChild(favicon);
      }
      favicon.href = faviconUrl;
    } catch (error) {
      console.error('Failed to update favicon:', error);
    }
  }

  /**
   * Resetea el tema a los valores por defecto del CSS.
   */
  resetTheme(): void {
    const root = this.document.documentElement;
    root.removeAttribute('style');
    root.removeAttribute('data-theme');
    root.removeAttribute('data-theme-preset');

    this.injectedStyleElements.forEach((element) => element.remove());
    this.injectedStyleElements.clear();
    this.loadedFonts.clear();

    this.detachSystemListener();
    this.currentTheme.set(null);
  }

  /**
   * Transforma el branding desde el formato de API al formato interno.
   */
  transformBrandingFromApi(apiBranding: any): BrandingConfig {
    return {
      colors: {
        primary: apiBranding.primary_color,
        secondary: apiBranding.secondary_color,
        accent: apiBranding.accent_color,
        background: apiBranding.background_color,
        surface: apiBranding.surface_color,
        text: {
          primary: apiBranding.text_color,
          secondary: apiBranding.text_secondary_color,
          muted: apiBranding.text_muted_color,
        },
      },
      fonts: {
        primary: apiBranding.font_primary,
        secondary: apiBranding.font_secondary,
        headings: apiBranding.font_headings,
      },
      logo: {
        url: apiBranding.logo_url,
        alt: apiBranding.name,
      },
      favicon: apiBranding.favicon_url,
      customCSS: apiBranding.custom_css,
    };
  }

  /**
   * Transforma el tema desde el formato de API al formato interno.
   * @deprecated Usar `transformBrandingFromApi` en su lugar.
   */
  transformThemeFromApi(apiTheme: any): ThemeConfig {
    return {
      name: apiTheme.name,
      primaryColor: apiTheme.primary_color || apiTheme.primaryColor,
      secondaryColor: apiTheme.secondary_color || apiTheme.secondaryColor,
      accentColor: apiTheme.accent_color || apiTheme.accentColor,
      backgroundColor: apiTheme.background_color || apiTheme.backgroundColor,
      textColor: apiTheme.text_color || apiTheme.textColor,
      borderRadius: apiTheme.border_radius || apiTheme.borderRadius,
      fontFamily: apiTheme.font_family || apiTheme.fontFamily,
      spacing: apiTheme.spacing,
      shadows: apiTheme.shadows,
    };
  }
}