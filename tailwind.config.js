/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Pretendard", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["ui-serif", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"]
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
      }
    }
  },
  plugins: []
};
