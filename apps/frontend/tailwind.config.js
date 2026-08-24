/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  // Dark mode por selector: el eje "modo" se activa con data-theme="dark" en <html>.
  // Esto habilita variantes dark: sin depender de prefers-color-scheme y permite
  // que las clases gray-*/blue-* etc. remapeadas a tokens reaccionen al modo.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    screens: {
      'xs': '375px',   // Extra small devices (iPhone SE, small Androids)
      'sm': '640px',   // Small devices
      'md': '768px',   // Medium devices (tablets)
      'lg': '1024px',  // Large devices (desktops)
      'xl': '1280px',  // Extra large devices
      '2xl': '1536px', // 2X large devices
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
      colors: {
        /* ── Paleta primaria derivada del token --color-primary ──
           DEFAULT/600 son rgba(var(--color-primary-rgb), <alpha-value>) para
           que bg-primary/10, border-primary/20, ring-primary/30 etc. funcionen
           (117+ usos de bg-primary/10). Los shades 50-500/700-900 usan color-mix
           (tinte del primario); la opacidad sobre shades es rara y se asume sin
           alpha. El primario sigue al comercio en runtime (incluido dark).

           El ANCLA del tinte (50-500) no es `white` literal sino
           --color-primary-tint-base, que por defecto ES blanco: en el tema base
           claro nada cambia. El token existe porque estos shades son "el
           primario diluido en la superficie", y cuando la superficie deja de ser
           blanca (monocromo la tiñe de verde, dark la vuelve #0f1724) diluir
           contra blanco produce una mancha casi blanca flotando: medido
           bg-primary-100 = rgb(226,232,226) sobre un surface rgb(192,228,187).
           Son ~215 usos de shades claros, la mayor fuente de "componentes con
           superficie blanca" que quedaba. */
        primary: {
          50: 'color-mix(in srgb, var(--color-primary) 8%, var(--color-primary-tint-base, white))',
          100: 'color-mix(in srgb, var(--color-primary) 15%, var(--color-primary-tint-base, white))',
          200: 'color-mix(in srgb, var(--color-primary) 25%, var(--color-primary-tint-base, white))',
          300: 'color-mix(in srgb, var(--color-primary) 40%, var(--color-primary-tint-base, white))',
          400: 'color-mix(in srgb, var(--color-primary) 65%, var(--color-primary-tint-base, white))',
          500: 'color-mix(in srgb, var(--color-primary) 85%, var(--color-primary-tint-base, white))',
          600: 'rgba(var(--color-primary-rgb), <alpha-value>)',
          700: 'color-mix(in srgb, var(--color-primary) 82%, black)',
          800: 'color-mix(in srgb, var(--color-primary) 65%, black)',
          900: 'color-mix(in srgb, var(--color-primary) 50%, black)',
          DEFAULT: 'rgba(var(--color-primary-rgb), <alpha-value>)',
        },
        /* ── Remapeo de paleta estática → tokens de escala (con alpha) ──
           gray/slate → neutral, blue → info, emerald/green → success,
           amber → warning, red → error. Cada shade se define como
           rgba(var(--color-*-rgb), <alpha-value>) para que bg-gray-200/80,
           bg-blue-500/10 etc. funcionen. En dark el bloque [data-theme="dark"]
           invierte la luminosidad de la escala, así bg-gray-100 se vuelve
           superficie oscura y text-gray-900 texto claro SIN editar los 488
           archivos. 950 mapea a 900 (no hay token 950). white NO se remapea:
           text-white sobre botones primarios debe seguir blanco en dark. */
        gray: {
          50: 'rgba(var(--color-neutral-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-neutral-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-neutral-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-neutral-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-neutral-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-neutral-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-neutral-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-neutral-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-neutral-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-neutral-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-neutral-900-rgb), <alpha-value>)',
        },
        slate: {
          50: 'rgba(var(--color-neutral-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-neutral-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-neutral-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-neutral-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-neutral-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-neutral-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-neutral-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-neutral-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-neutral-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-neutral-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-neutral-900-rgb), <alpha-value>)',
        },
        blue: {
          50: 'rgba(var(--color-info-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-info-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-info-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-info-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-info-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-info-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-info-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-info-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-info-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-info-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-info-900-rgb), <alpha-value>)',
        },
        red: {
          50: 'rgba(var(--color-error-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-error-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-error-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-error-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-error-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-error-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-error-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-error-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-error-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-error-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-error-900-rgb), <alpha-value>)',
        },
        amber: {
          50: 'rgba(var(--color-warning-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-warning-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-warning-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-warning-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-warning-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-warning-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-warning-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-warning-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-warning-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-warning-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-warning-900-rgb), <alpha-value>)',
        },
        emerald: {
          50: 'rgba(var(--color-success-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-success-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-success-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-success-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-success-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-success-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-success-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-success-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-success-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-success-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-success-900-rgb), <alpha-value>)',
        },
        green: {
          50: 'rgba(var(--color-success-50-rgb), <alpha-value>)',
          100: 'rgba(var(--color-success-100-rgb), <alpha-value>)',
          200: 'rgba(var(--color-success-200-rgb), <alpha-value>)',
          300: 'rgba(var(--color-success-300-rgb), <alpha-value>)',
          400: 'rgba(var(--color-success-400-rgb), <alpha-value>)',
          500: 'rgba(var(--color-success-500-rgb), <alpha-value>)',
          600: 'rgba(var(--color-success-600-rgb), <alpha-value>)',
          700: 'rgba(var(--color-success-700-rgb), <alpha-value>)',
          800: 'rgba(var(--color-success-800-rgb), <alpha-value>)',
          900: 'rgba(var(--color-success-900-rgb), <alpha-value>)',
          950: 'rgba(var(--color-success-900-rgb), <alpha-value>)',
        },
        /* ── Paletas DECORATIVAS: tramo claro con token opcional ──
           purple/violet/indigo/pink/rose/orange/teal/cyan/sky/yellow no tienen
           equivalente semántico y por eso nunca se remapearon. El problema es que
           sus pasos 50-200 son hex casi blancos (#f3e8ff, #eef2ff, #fef9c3) y
           aparecen en 460 sitios —mosaicos de iconos, chips de canal, avisos—, así
           que sobre cualquier superficie que no sea blanca se leen como parches
           blancos flotando.

           El token va con el HEX ORIGINAL como fallback: si nadie lo define —tema
           base, aura, glass— el valor es byte a byte el de Tailwind y no cambia
           nada. Monocromo sí lo define (ThemeService.buildMonoSemanticTints) y los
           baja al nivel de su superficie conservando el hue.

           Se declaran como terna `-rgb` y no como color plano para no perder el
           modificador de opacidad: hay 8 usos tipo `bg-sky-50/60`. El fallback de
           var() admite la lista con comas. Los pasos 300-950 no se tocan: ya son
           colores sólidos, no tintes, y no sufren el problema. */
        purple: {
          50: 'rgba(var(--color-purple-50-rgb, 250, 245, 255), <alpha-value>)',
          100: 'rgba(var(--color-purple-100-rgb, 243, 232, 255), <alpha-value>)',
          200: 'rgba(var(--color-purple-200-rgb, 233, 213, 255), <alpha-value>)',
        },
        violet: {
          50: 'rgba(var(--color-violet-50-rgb, 245, 243, 255), <alpha-value>)',
          100: 'rgba(var(--color-violet-100-rgb, 237, 233, 254), <alpha-value>)',
          200: 'rgba(var(--color-violet-200-rgb, 221, 214, 254), <alpha-value>)',
        },
        indigo: {
          50: 'rgba(var(--color-indigo-50-rgb, 238, 242, 255), <alpha-value>)',
          100: 'rgba(var(--color-indigo-100-rgb, 224, 231, 255), <alpha-value>)',
          200: 'rgba(var(--color-indigo-200-rgb, 199, 210, 254), <alpha-value>)',
        },
        pink: {
          50: 'rgba(var(--color-pink-50-rgb, 253, 242, 248), <alpha-value>)',
          100: 'rgba(var(--color-pink-100-rgb, 252, 231, 243), <alpha-value>)',
          200: 'rgba(var(--color-pink-200-rgb, 251, 207, 232), <alpha-value>)',
        },
        rose: {
          50: 'rgba(var(--color-rose-50-rgb, 255, 241, 242), <alpha-value>)',
          100: 'rgba(var(--color-rose-100-rgb, 255, 228, 230), <alpha-value>)',
          200: 'rgba(var(--color-rose-200-rgb, 254, 205, 211), <alpha-value>)',
        },
        orange: {
          50: 'rgba(var(--color-orange-50-rgb, 255, 247, 237), <alpha-value>)',
          100: 'rgba(var(--color-orange-100-rgb, 255, 237, 213), <alpha-value>)',
          200: 'rgba(var(--color-orange-200-rgb, 254, 215, 170), <alpha-value>)',
        },
        teal: {
          50: 'rgba(var(--color-teal-50-rgb, 240, 253, 250), <alpha-value>)',
          100: 'rgba(var(--color-teal-100-rgb, 204, 251, 241), <alpha-value>)',
          200: 'rgba(var(--color-teal-200-rgb, 153, 246, 228), <alpha-value>)',
        },
        cyan: {
          50: 'rgba(var(--color-cyan-50-rgb, 236, 254, 255), <alpha-value>)',
          100: 'rgba(var(--color-cyan-100-rgb, 207, 250, 254), <alpha-value>)',
          200: 'rgba(var(--color-cyan-200-rgb, 165, 243, 252), <alpha-value>)',
        },
        sky: {
          50: 'rgba(var(--color-sky-50-rgb, 240, 249, 255), <alpha-value>)',
          100: 'rgba(var(--color-sky-100-rgb, 224, 242, 254), <alpha-value>)',
          200: 'rgba(var(--color-sky-200-rgb, 186, 230, 253), <alpha-value>)',
        },
        yellow: {
          50: 'rgba(var(--color-yellow-50-rgb, 254, 252, 232), <alpha-value>)',
          100: 'rgba(var(--color-yellow-100-rgb, 254, 249, 195), <alpha-value>)',
          200: 'rgba(var(--color-yellow-200-rgb, 254, 240, 138), <alpha-value>)',
        },
        /* ── Colores de valor único (con alpha donde hay token RGB) ──
           Los que se usan con /N (muted, surface, bg, secondary, foreground,
           text-primary, text-secondary) se definen con rgb(... / <alpha-value>).
           El resto conserva var() plano (no se usan con opacidad). */
        muted: 'rgba(var(--color-text-muted-rgb), <alpha-value>)',
        surface: 'rgba(var(--color-surface-rgb), <alpha-value>)',
        'surface-secondary': 'var(--color-surface-secondary)',
        bg: 'rgba(var(--color-background-rgb), <alpha-value>)',
        // Legacy color mappings for backward compatibility
        background: 'rgba(var(--color-background-rgb), <alpha-value>)',
        foreground: 'rgba(var(--color-foreground-rgb), <alpha-value>)',
        secondary: 'rgba(var(--color-secondary-rgb), <alpha-value>)',
        'muted-foreground': 'rgba(var(--color-text-muted-rgb), <alpha-value>)',
        accent: 'rgba(var(--color-accent-rgb), <alpha-value>)',
        'accent-foreground': 'var(--color-accent-foreground)',
        ring: 'var(--color-ring)',
        border: 'var(--color-border)',
        input: 'var(--color-input)',
        destructive: 'var(--color-destructive)',
        'destructive-foreground': 'var(--color-destructive-foreground)',
        'text-primary': 'rgba(var(--color-text-primary-rgb), <alpha-value>)',
        'text-secondary': 'rgba(var(--color-text-secondary-rgb), <alpha-value>)',
        // Compuestos por canal RGB, como `text-primary` arriba, y NO como
        // `var(--color-success)` a secas: un token declarado con el hex crudo
        // no puede recibir modificador de alfa, así que `border-warning/30`
        // —y las 163 apariciones de `<app-alert-banner>` que dependen de él—
        // no emitían NINGUNA regla, y el `border` sin color caía en el gris del
        // preflight. El resultado no era «sin borde» sino «borde equivocado»:
        // un aviso de peligro y uno de éxito se pintaban iguales.
        success: 'rgba(var(--color-success-rgb), <alpha-value>)',
        'success-light': 'var(--color-success-light)',
        warning: 'rgba(var(--color-warning-rgb), <alpha-value>)',
        'warning-light': 'var(--color-warning-light)',
        error: 'rgba(var(--color-error-rgb), <alpha-value>)',
        'error-light': 'var(--color-error-light)',
        // `--color-info` y `--color-info-light` ya existían en styles.scss (light
        // y dark), pero sin este mapeo no había utilidad que los alcanzara:
        // escribir `bg-info-light` compilaba a nada, en silencio.
        info: 'var(--color-info)',
        'info-light': 'var(--color-info-light)',
      },
      borderRadius: {
        sm: '0.375rem' /* 6px */,
        md: '0.625rem' /* 10px */,
        lg: '0.875rem' /* 14px */,
        pill: '9999px',
        // Legacy mappings
        button: 'var(--radius-button)',
        card: 'var(--radius-card)',
        input: 'var(--radius-input)',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(2,6,23,0.04)',
        sm: '0 4px 8px rgba(15,23,42,0.06)',
        md: '0 10px 30px rgba(15,23,42,0.08)',
        lg: '0 20px 50px rgba(2,6,23,0.10)',
        // Legacy mapping
        card: 'var(--shadow-card)',
      },
      spacing: {
        sm: '0.375rem' /* 6px */,
        md: '0.75rem' /* 12px */,
        lg: '1.25rem' /* 20px */,
      },
      transitionDuration: {
        DEFAULT: '160',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};