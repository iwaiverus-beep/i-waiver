import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B1622",
          soft: "#33475B",
          muted: "#64748B",
        },
        paper: "#FAF9F6",
        surface: "#F1EEE8",
        line: "#E2DDD3",
        accent: {
          DEFAULT: "#1B5E4F",
          hover: "#164F42",
          soft: "#E3EFEA",
        },
        flag: "#8A5A16",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      maxWidth: {
        prose: "68ch",
      },
      letterSpacing: {
        tightest: "-0.035em",
      },
    },
  },
  plugins: [],
};

export default config;
