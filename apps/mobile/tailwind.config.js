/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{tsx,ts}', './src/**/*.{tsx,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#22C55E',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
        },
        primaryDark: '#1B3C2B',
        primaryLight: '#F0FDF4',
        surface: '#ffffff',
        bg: '#F8FAFC',
        card: '#F8FAFC',
        cardBorder: '#E4E4E7',
        inputBorder: '#D4D4D8',
        text: {
          primary: '#18181B',
          secondary: '#71717A',
          muted: '#A1A1AA',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
      },
    },
  },
  plugins: [],
};
