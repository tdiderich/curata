import path from "path";
import { fileURLToPath } from "url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  // Match tsconfig's "@/*" -> "src/*" so stories can render app components
  // that import through the alias (the help-video demo screens do).
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = { ...(cfg.resolve.alias as Record<string, string>), "@": path.resolve(here, "../src") };
    return cfg;
  },
};
export default config;
