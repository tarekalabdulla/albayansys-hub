import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        cairo: ["Cairo", "system-ui", "sans-serif"],
        tajawal: ["Tajawal", "system-ui", "sans-serif"],
        sans: ["Cairo", "Tajawal", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          glow: "hsl(var(--primary-glow))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-accent": "var(--gradient-accent)",
        "gradient-hero": "var(--gradient-hero)",
        "gradient-card": "var(--gradient-card)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "glow-success": {
          "0%, 100%": { boxShadow: "0 0 0 1px hsl(var(--success) / 0.35), 0 0 0 0 hsl(var(--success) / 0.45)" },
          "50%":       { boxShadow: "0 0 0 1px hsl(var(--success) / 0.55), 0 0 28px 4px hsl(var(--success) / 0.40)" },
        },
        "glow-primary": {
          "0%, 100%": { boxShadow: "0 0 0 1px hsl(var(--primary) / 0.40), 0 0 0 0 hsl(var(--primary) / 0.50)" },
          "50%":       { boxShadow: "0 0 0 1px hsl(var(--primary) / 0.65), 0 0 32px 6px hsl(var(--primary) / 0.50)" },
        },
        "glow-warning": {
          "0%, 100%": { boxShadow: "0 0 0 1px hsl(var(--warning) / 0.40), 0 0 0 0 hsl(var(--warning) / 0.45)" },
          "50%":       { boxShadow: "0 0 0 1px hsl(var(--warning) / 0.60), 0 0 28px 4px hsl(var(--warning) / 0.45)" },
        },
        "glow-info": {
          "0%, 100%": { boxShadow: "0 0 0 1px hsl(var(--info) / 0.35), 0 0 0 0 hsl(var(--info) / 0.40)" },
          "50%":       { boxShadow: "0 0 0 1px hsl(var(--info) / 0.55), 0 0 24px 4px hsl(var(--info) / 0.40)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "glow-success": "glow-success 2.2s ease-in-out infinite",
        "glow-primary": "glow-primary 1.6s ease-in-out infinite",
        "glow-warning": "glow-warning 2s ease-in-out infinite",
        "glow-info": "glow-info 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
