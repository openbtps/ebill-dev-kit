// The eBillAddress developer documentation (developers.ebilladdress.com): a learning path, then task guides, then
// reference generated from the code it describes, never written by hand: the API from the SDK's own copy of eBill's
// OpenAPI document, the SDK from its TypeScript.
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";
import { themes as prismThemes } from "prism-react-renderer";

const REPOSITORY = "https://github.com/openbtps/ebill-dev-kit";

const config: Config = {
  title: "eBillAddress developers",
  tagline: "Build apps and templates for the eBillAddress Marketplace",
  favicon: "img/favicon.svg",
  url: "https://developers.ebilladdress.com",
  baseUrl: "/",
  // Rspack and the other faster tools (@docusaurus/faster): the OpenAPI theme's modules bundle under them.
  future: { v4: true, faster: true },
  // A broken link fails the build, so it fails CI.
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: { hooks: { onBrokenMarkdownLinks: "throw" } },
  i18n: { defaultLocale: "en-AU", locales: ["en-AU"] },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: `${REPOSITORY}/edit/main/docs/`,
          docItemComponent: "@theme/ApiItem",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],
  plugins: [
    [
      "docusaurus-plugin-openapi-docs",
      {
        id: "api",
        docsPluginId: "classic",
        config: {
          api: {
            specPath: "../packages/app-sdk/openapi.json",
            outputDir: "docs/reference/api",
            sidebarOptions: { groupPathsBy: "tag", categoryLinkSource: "tag" },
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "sdk",
        entryPoints: ["../packages/app-sdk/src/index.ts", "../packages/app-sdk/src/browser.ts"],
        tsconfig: "../packages/app-sdk/tsconfig.json",
        out: "docs/reference/sdk",
        readme: "none",
        excludePrivate: true,
        sidebar: { pretty: true },
      },
    ],
    "docusaurus-plugin-sass",
  ],
  themes: ["docusaurus-theme-openapi-docs"],
  themeConfig: {
    navbar: {
      title: "eBillAddress developers",
      items: [
        { to: "/get-started/first-app", label: "Get started", position: "left" },
        { to: "/concepts/apps-and-templates", label: "Concepts", position: "left" },
        { to: "/build/install", label: "Build", position: "left" },
        { to: "/publish/listing", label: "Publish", position: "left" },
        { to: "/reference", label: "Reference", position: "left" },
        { href: REPOSITORY, label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "light",
      links: [
        { label: "App contract", href: `${REPOSITORY}/blob/main/CONTRACT.md` },
        { label: "Examples", href: `${REPOSITORY}/tree/main/examples` },
        { label: "eBillAddress", href: "https://ebilladdress.com" },
      ],
      copyright: "eBillAddress. The SDK, the CLI and these docs are MIT licensed.",
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula, additionalLanguages: ["toml", "bash", "json", "http"] },
    // The API reference's request samples: curl, and Node, which the SDK is for, first.
    languageTabs: [
      { highlight: "bash", language: "curl", logoClass: "curl" },
      { highlight: "javascript", language: "nodejs", logoClass: "nodejs" },
      { highlight: "python", language: "python", logoClass: "python" },
    ],
  } satisfies Preset.ThemeConfig & { languageTabs: { highlight: string; language: string; logoClass: string }[] },
};

export default config;
