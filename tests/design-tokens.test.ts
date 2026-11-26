import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";
import { DESIGN_TOKENS } from "../src/lib/design-tokens";

const ROOT = path.resolve(__dirname, "..");

describe("Design Tokens & Tailwind Configuration (.stitch/DESIGN.md)", () => {
  it("exposes all required color tokens in DESIGN_TOKENS and tailwind.config.ts", () => {
    const expectedColors: Record<string, string> = {
      primary: "#0066cc",
      "primary-focus": "#0071e3",
      "primary-on-dark": "#2997ff",
      ink: "#1d1d1f",
      body: "#1d1d1f",
      "ink-muted-80": "#333333",
      "ink-muted-48": "#7a7a7a",
      "divider-soft": "#f0f0f0",
      hairline: "#e0e0e0",
      canvas: "#ffffff",
      "canvas-parchment": "#f5f5f7",
      "surface-pearl": "#fafafc",
      "on-primary": "#ffffff",
    };

    const extendColors = tailwindConfig.theme?.extend?.colors as Record<
      string,
      string
    >;

    for (const [token, hex] of Object.entries(expectedColors)) {
      expect(DESIGN_TOKENS.colors[token as keyof typeof DESIGN_TOKENS.colors]).toBe(
        hex,
      );
      expect(extendColors[token]).toBe(hex);
    }
  });

  it("exposes SF Pro / system-ui font stacks and typography scale", () => {
    const extendFonts = tailwindConfig.theme?.extend?.fontFamily as Record<
      string,
      string[]
    >;

    expect(extendFonts.display).toContain("SF Pro Display");
    expect(extendFonts.display).toContain("system-ui");
    expect(extendFonts.sans).toContain("SF Pro Text");
    expect(extendFonts.sans).toContain("system-ui");

    expect(DESIGN_TOKENS.typography["hero-display"].fontSize).toBe("56px");
    expect(DESIGN_TOKENS.typography.body.fontSize).toBe("17px");
    expect(DESIGN_TOKENS.typography.caption.fontSize).toBe("14px");
  });

  it("exposes card (18px) and pill (9999px) border radii and spacing scale", () => {
    const extendRadius = tailwindConfig.theme?.extend?.borderRadius as Record<
      string,
      string
    >;
    const extendSpacing = tailwindConfig.theme?.extend?.spacing as Record<
      string,
      string
    >;

    expect(extendRadius.lg).toBe("18px");
    expect(extendRadius.card).toBe("18px");
    expect(extendRadius.pill).toBe("9999px");
    expect(extendRadius.full).toBe("9999px");
    expect(extendRadius.sm).toBe("8px");
    expect(extendRadius.md).toBe("11px");

    expect(extendSpacing.xxs).toBe("4px");
    expect(extendSpacing.xs).toBe("8px");
    expect(extendSpacing.lg).toBe("24px");
    expect(extendSpacing.section).toBe("80px");
  });

  it("declares matching CSS variables and @theme tokens in src/app/globals.css", () => {
    const globalsCss = fs.readFileSync(
      path.join(ROOT, "src/app/globals.css"),
      "utf8",
    );

    expect(globalsCss).toContain("--color-primary: #0066cc;");
    expect(globalsCss).toContain("--color-primary-focus: #0071e3;");
    expect(globalsCss).toContain("--color-canvas-parchment: #f5f5f7;");
    expect(globalsCss).toContain("--color-canvas: #ffffff;");
    expect(globalsCss).toContain("--color-hairline: #e0e0e0;");
    expect(globalsCss).toContain("--color-ink: #1d1d1f;");
    expect(globalsCss).toContain("--radius-lg: 18px;");
    expect(globalsCss).toContain("--radius-pill: 9999px;");
    expect(globalsCss).toContain("SF Pro Text");
    expect(globalsCss).toContain("SF Pro Display");
    expect(globalsCss).toContain("@theme inline");
  });
});
