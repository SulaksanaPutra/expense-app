/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
      comment:
        "Circular dependencies complicate modular reasoning and deterministic bundling.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment:
        "Do not depend on packages not declared in package.json.",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "not-to-deprecated",
      severity: "warn",
      comment: "Avoid depending on deprecated core or npm modules.",
      from: {},
      to: {
        dependencyTypes: ["deprecated"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: [
        "(^|/)node_modules(/|$)",
        "(^|/)\\.next(/|$)",
        "(^|/)out(/|$)",
        "(^|/)build(/|$)",
        "(^|/)coverage(/|$)",
      ],
    },
    exclude: {
      path: [
        "^node_modules/",
        "^\\.next/",
        "\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$",
        "^src/.*\\.d\\.ts$",
      ],
    },
    includeOnly: "^src/",
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "^src/[^/]+",
      },
    },
  },
};
