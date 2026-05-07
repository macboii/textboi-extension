const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "browser",
  target: "chrome114",
  sourcemap: watch,
};

const entries = [
  // Service worker — ESM (MV3 requirement)
  {
    ...shared,
    entryPoints: ["background/background.js"],
    outfile: "dist/background/background.js",
    format: "esm",
  },
  // Content script — IIFE (content scripts cannot be ES modules)
  {
    ...shared,
    entryPoints: ["content/content.js"],
    outfile: "dist/content/content.js",
    format: "iife",
  },
  // Popup
  {
    ...shared,
    entryPoints: ["popup/popup.js"],
    outfile: "dist/popup/popup.js",
    format: "iife",
  },
];

if (watch) {
  Promise.all(entries.map((e) => esbuild.context(e))).then((ctxs) => {
    ctxs.forEach((ctx) => ctx.watch());
    console.log("Watching for changes...");
  });
} else {
  Promise.all(entries.map((e) => esbuild.build(e)))
    .then(() => console.log("Build complete."))
    .catch(() => process.exit(1));
}
