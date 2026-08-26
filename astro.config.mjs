import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://lolwierd.com",
  output: "static",
  markdown: {
    // Two themes, no default: the highlighter emits both as CSS variables and
    // writing.css picks between them from data-sky, so code follows the sun over
    // Vadodara like the rest of the page instead of the visitor's OS theme.
    // Vitesse is the closest of the bundled themes to warm paper and bone ink.
    shikiConfig: {
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
      wrap: false
    }
  }
});
