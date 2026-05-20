/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Pretendard",
          "'Bricolage Grotesque'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        display: ["'Bricolage Grotesque'", "Pretendard", "sans-serif"],
        serif: ["'Instrument Serif'", "ui-serif", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      colors: {
        ink: "#0c1424",
        char: "#1a2436",
        mist: "#eef2f8",
        frost: "#f7faff",
        pearl: "#fbfcfe",
        silver: {
          50: "#f7f9fc",
          100: "#eef2f8",
          200: "#dde4ee",
          300: "#c2cddf",
          400: "#9eaec5",
          500: "#7889a4",
          600: "#566782",
          700: "#3d4c64",
          800: "#283346",
          900: "#161d2c"
        },
        azure: {
          50: "#f0f6ff",
          100: "#e0ebfd",
          200: "#c6dbf8",
          300: "#9dc1ef",
          400: "#6fa3e3",
          500: "#4a87d2",
          600: "#3a6ec0",
          700: "#2f579e"
        },
        signal: {
          DEFAULT: "#5fd1ad",
          deep: "#1f7a5b"
        },
        warn: "#e3a55a",
        alert: {
          DEFAULT: "#e87b8a",
          deep: "#a8364a"
        }
      },
      boxShadow: {
        elevated:
          "0 1px 2px rgba(15, 24, 42, 0.04), 0 8px 16px -4px rgba(70, 100, 140, 0.10), 0 24px 48px -12px rgba(70, 100, 140, 0.16)",
        soft: "0 1px 2px rgba(15, 24, 42, 0.04), 0 4px 12px rgba(70, 100, 140, 0.06)",
        glow:
          "0 0 0 1px rgba(108, 157, 235, 0.22), 0 8px 24px -4px rgba(108, 157, 235, 0.22)",
        crisp:
          "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(15, 24, 42, 0.06)",
        inset:
          "inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 0 0 1px rgba(180, 195, 220, 0.4)",
        sunk: "inset 0 1px 3px rgba(40, 51, 70, 0.10)"
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(95, 209, 173, 0.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(95, 209, 173, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(95, 209, 173, 0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(40px,-20px,0) scale(1.05)" },
          "66%": { transform: "translate3d(-30px,15px,0) scale(0.96)" }
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(180%)" }
        },
        "blink-dot": {
          "0%, 70%, 100%": { opacity: "0.25" },
          "35%": { opacity: "1" }
        }
      },
      animation: {
        rise: "rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-ring": "pulse-ring 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        shimmer: "shimmer 2.4s linear infinite",
        drift: "drift 24s ease-in-out infinite",
        scan: "scan 3.2s linear infinite",
        "blink-dot": "blink-dot 1.4s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
