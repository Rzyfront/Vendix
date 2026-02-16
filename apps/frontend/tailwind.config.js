/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
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
        primary: {
          500: "#7ED7A5",
          600: "#2F6F4E",
          700: "#2F6F4E",
          DEFAULT: "var(--primary)",
        },
        muted: "#94A3B8",
        surface: "#ffffff",
        bg: "#f8fafc",
        // Legacy color mappings for backward compatibility
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        secondary: "var(--color-secondary)",
        "muted-foreground": "var(--color-muted-foreground)",
        accent: "var(--color-accent)",
        "accent-foreground": "var(--color-accent-foreground)",
        ring: "var(--color-ring)",
        border: "var(--color-border)",
        input: "var(--color-input)",
        destructive: "var(--color-destructive)",
        "destructive-foreground": "var(--color-destructive-foreground)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        success: "var(--color-success)",
        "success-light": "var(--color-success-light)",
        warning: "var(--color-warning)",
        "warning-light": "var(--color-warning-light)",
        error: "var(--color-error)",
        "error-light": "var(--color-error-light)",
      },
      borderRadius: {
        sm: "0.375rem" /* 6px */,
        md: "0.625rem" /* 10px */,
        lg: "0.875rem" /* 14px */,
        pill: "9999px",
        // Legacy mappings
        button: "var(--radius-button)",
        card: "var(--radius-card)",
        input: "var(--radius-input)",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(2,6,23,0.04)",
        sm: "0 4px 8px rgba(15,23,42,0.06)",
        md: "0 10px 30px rgba(15,23,42,0.08)",
        lg: "0 20px 50px rgba(2,6,23,0.10)",
        // Legacy mapping
        card: "var(--shadow-card)",
      },
      spacing: {
        sm: "0.375rem" /* 6px */,
        md: "0.75rem" /* 12px */,
        lg: "1.25rem" /* 20px */,
      },
      transitionDuration: {
        DEFAULT: "160",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
