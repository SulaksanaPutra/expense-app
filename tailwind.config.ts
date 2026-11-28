import type { Config } from "tailwindcss";
import { DESIGN_TOKENS } from "./src/lib/design-tokens";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ...DESIGN_TOKENS.colors,
      },
      fontFamily: {
        display: [...DESIGN_TOKENS.fontFamily.display],
        sans: [...DESIGN_TOKENS.fontFamily.sans],
      },
      borderRadius: {
        ...DESIGN_TOKENS.rounded,
        card: DESIGN_TOKENS.rounded.card,
      },
      spacing: Object.fromEntries(
        Object.entries(DESIGN_TOKENS.spacing).map(([key, value]) => [
          `ds-${key}`,
          value,
        ]),
      ),
    },
  },
  plugins: [],
};

export default config;
