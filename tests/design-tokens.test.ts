import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";
import { DESIGN_TOKENS } from "../src/lib/design-tokens";

const ROOT = path.resolve(__dirname, "..");

describe("Unified Stitch Design Tokens & Tailwind Configuration (.stitch/ledgersplit/DESIGN.md)", () => {
  it("exposes all Stitch canonical color tokens and backward-compatible aliases", () => {
    const expectedColors: Record<string, string> = {
      surface: "#f9f9fb",
      "surface-container-lowest": "#ffffff",
      "surface-container-low": "#f3f3f5",
      "surface-pearl": "#fafafc",
      "on-surface": "#1a1c1d",
      "on-surface-variant": "#414753",
      outline: "#727784",
      "outline-variant": "#c1c6d5",
      primary: "#0066cc",
      "primary-focus": "#0071e3",
      "primary-container": "#0066cc",
      "on-primary": "#ffffff",
      "secondary-container": "#0372e4",
      error: "#ba1a1a",
      danger: "#dc2626",
      success: "#22c55e",
      warning: "#f59e0b",
      canvas: "#ffffff",
      "canvas-parchment": "#f9f9fb",
      ink: "#1a1c1d",
      body: "#1a1c1d",
      "ink-muted-80": "#414753",
      "ink-muted-48": "#727784",
      hairline: "#e0e0e0",
      "divider-soft": "#f0f0f0",
    };

    const extendColors = tailwindConfig.theme?.extend?.colors as Record<
      string,
      string
    >;

    for (const [token, hex] of Object.entries(expectedColors)) {
      expect(
        DESIGN_TOKENS.colors[token as keyof typeof DESIGN_TOKENS.colors],
      ).toBe(hex);
      expect(extendColors[token]).toBe(hex);
    }
  });

  it("exposes Inter-first font stacks and the Stitch typography scale", () => {
    const extendFonts = tailwindConfig.theme?.extend?.fontFamily as Record<
      string,
      string[]
    >;

    expect(extendFonts.display[0]).toBe("Inter");
    expect(extendFonts.display).toContain("SF Pro Display");
    expect(extendFonts.sans[0]).toBe("Inter");
    expect(extendFonts.sans).toContain("SF Pro Text");

    expect(DESIGN_TOKENS.typography["headline-xl"]).toMatchObject({
      fontFamily: "Inter",
      fontSize: "30px",
      fontWeight: 600,
      lineHeight: "38px",
    });
    expect(DESIGN_TOKENS.typography["headline-lg"]).toMatchObject({
      fontSize: "24px",
      fontWeight: 600,
      lineHeight: "32px",
    });
    expect(DESIGN_TOKENS.typography["headline-md"]).toMatchObject({
      fontSize: "17px",
      fontWeight: 600,
      lineHeight: "24px",
    });
    expect(DESIGN_TOKENS.typography["headline-sm"]).toMatchObject({
      fontSize: "15px",
      fontWeight: 600,
      lineHeight: "20px",
    });
    expect(DESIGN_TOKENS.typography["body-md"]).toMatchObject({
      fontSize: "14px",
      fontWeight: 400,
      lineHeight: "20px",
    });
    expect(DESIGN_TOKENS.typography["body-sm"]).toMatchObject({
      fontSize: "13px",
      fontWeight: 400,
      lineHeight: "18px",
    });
    expect(DESIGN_TOKENS.typography["label-md"]).toMatchObject({
      fontSize: "12px",
      fontWeight: 600,
      lineHeight: "16px",
    });
    expect(DESIGN_TOKENS.typography["label-sm"]).toMatchObject({
      fontSize: "11px",
      fontWeight: 600,
      lineHeight: "14px",
    });
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

    expect(DESIGN_TOKENS.spacing.xxs).toBe("4px");
    expect(DESIGN_TOKENS.spacing.xs).toBe("8px");
    expect(DESIGN_TOKENS.spacing.lg).toBe("24px");
    expect(DESIGN_TOKENS.spacing.section).toBe("80px");

    expect(extendSpacing["ds-xxs"]).toBe("4px");
    expect(extendSpacing["ds-xs"]).toBe("8px");
    expect(extendSpacing["ds-lg"]).toBe("24px");
    expect(extendSpacing["ds-section"]).toBe("80px");
    expect(extendSpacing.md).toBeUndefined();
    expect(extendSpacing.lg).toBeUndefined();
  });

  it("declares Stitch CSS variables, @theme tokens, tabular-nums, and Material Symbols Outlined in globals.css", () => {
    const globalsCss = fs.readFileSync(
      path.join(ROOT, "src/app/globals.css"),
      "utf8",
    );

    expect(globalsCss).toContain("--color-surface: #f9f9fb;");
    expect(globalsCss).toContain("--color-surface-container-lowest: #ffffff;");
    expect(globalsCss).toContain("--color-surface-container-low: #f3f3f5;");
    expect(globalsCss).toContain("--color-primary: #0066cc;");
    expect(globalsCss).toContain("--color-on-surface: #1a1c1d;");
    expect(globalsCss).toContain("--color-on-surface-variant: #414753;");
    expect(globalsCss).toContain("--color-outline: #727784;");
    expect(globalsCss).toContain("--radius-card: 18px;");
    expect(globalsCss).toContain("--radius-pill: 9999px;");
    expect(globalsCss).toContain('"Inter"');
    expect(globalsCss).toContain(".material-symbols-outlined");
    expect(globalsCss).toContain("font-variant-numeric: tabular-nums;");
    expect(globalsCss).toContain("@theme inline");
  });

  it("loads Inter and Material Symbols Outlined in src/app/layout.tsx", () => {
    const layoutTsx = fs.readFileSync(
      path.join(ROOT, "src/app/layout.tsx"),
      "utf8",
    );

    expect(layoutTsx).toContain("family=Inter");
    expect(layoutTsx).toContain("family=Material+Symbols+Outlined");
    expect(layoutTsx).toContain("bg-surface");
    expect(layoutTsx).toContain("text-on-surface");
  });
});
