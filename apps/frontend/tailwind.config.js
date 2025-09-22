/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        'muted-foreground': 'var(--color-muted-foreground)',
        accent: 'var(--color-accent)',
        'accent-foreground': 'var(--color-accent-foreground)',
        ring: 'var(--color-ring)',
        border: 'var(--color-border)',
        input: 'var(--color-input)',
        destructive: 'var(--color-destructive)',
        'destructive-foreground': 'var(--color-destructive-foreground)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)'
      },
      fontFamily: {
        base: 'var(--font-base)'
      },
      borderRadius: {
        button: 'var(--radius-button, 0.5rem)',
        card: 'var(--radius-card, 0.75rem)',
        input: 'var(--radius-input, 0.5rem)'
      },
      boxShadow: {
        card: 'var(--shadow-card, 0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1))'
      }
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
}
