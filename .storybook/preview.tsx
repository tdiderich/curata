import React, { useEffect } from "react";
import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/kazam.css";
import "../src/app/globals.css";

/**
 * Stories render with the app's real stylesheets and the same theme
 * attributes ThemeScript stamps at runtime, so what Storybook shows is
 * what the app ships. Toolbar globals switch accent/mode per story.
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Accent theme (data-theme)",
      toolbar: {
        title: "Accent",
        items: ["violet", "green", "blue", "indigo", "red", "orange", "yellow", "teal"],
        dynamicTitle: true,
      },
    },
    mode: {
      description: "Light or dark (data-mode)",
      toolbar: {
        title: "Mode",
        items: ["dark", "light"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "violet",
    mode: "dark",
  },
  decorators: [
    (Story, context) => {
      const { theme, mode } = context.globals;
      useEffect(() => {
        const d = document.documentElement;
        d.setAttribute("data-theme", String(theme ?? "violet"));
        d.setAttribute("data-mode", String(mode ?? "dark"));
      }, [theme, mode]);
      return (
        <div style={{ background: "var(--bg)", padding: 24, minHeight: "100vh" }}>
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/settings",
      },
    },
    backgrounds: { disable: true },
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
