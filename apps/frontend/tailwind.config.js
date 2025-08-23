/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {      colors: {
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        background: 'var(--color-background)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        border: 'var(--color-border)',
      },
      fontFamily: {
        base: 'var(--font-base)',
      },
      borderRadius: {
        'button': 'var(--button-radius, 0.5rem)',
      }
    },
  },
  plugins: [],
}
