#!/usr/bin/env node
// After `npm run build:cap && npx cap sync`, confirm the iOS shell picked up the viewport fix
// and (when OFFLINE_NATIVE is paused) server.url — both live in gitignored ios/App/App/.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

const appJsx = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
const offlineOn = /const OFFLINE_NATIVE = true/.test(appJsx);

const iosCap = join(ROOT, "ios/App/App/capacitor.config.json");
if (!existsSync(iosCap)) {
  fails.push("ios/App/App/capacitor.config.json missing — run: npx cap sync ios");
} else {
  const capTxt = readFileSync(iosCap, "utf8");
  if (offlineOn) {
    if (/"url"\s*:\s*"https:\/\/gotvero\.com"/.test(capTxt)) {
      fails.push("OFFLINE_NATIVE on but ios capacitor.config.json still has server.url — run: npx cap sync ios");
    }
  } else if (!/"url"\s*:\s*"https:\/\/gotvero\.com"/.test(capTxt)) {
    fails.push("OFFLINE_NATIVE paused but ios capacitor.config.json has NO server.url — native is still on stale local bundle. Run: npx cap sync ios");
  }
}

const bundleHtml = join(ROOT, "ios/App/App/public/index.html");
const distHtml = join(ROOT, "dist/index.html");
const htmlPath = existsSync(bundleHtml) ? bundleHtml : distHtml;
if (!existsSync(htmlPath)) {
  fails.push("No dist/index.html — run: npm run build:cap");
} else {
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes("native-viewport-boot") || !html.includes("isNativeShell")) {
    fails.push(`${htmlPath.replace(ROOT + "/", "")} missing native-viewport-boot / isNativeShell — rebuild with npm run build:cap`);
  }
}

const assetsDir = join(ROOT, "dist/assets");
if (existsSync(assetsDir)) {
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith(".js")) continue;
    const chunk = readFileSync(join(assetsDir, f), "utf8");
    if (chunk.includes("lockNativeShellLayout")) {
      fails.push(`dist/assets/${f} still contains lockNativeShellLayout — rebuild`);
    }
  }
}

if (fails.length) {
  console.error("\n  ❌ Cap bundle verification FAILED\n");
  for (const f of fails) console.error(`     · ${f}`);
  console.error("\n  Fix: npm run cap:prepare   then Xcode ▶\n");
  process.exit(1);
}
console.log("  ✅ Cap bundle verification passed (ios config + viewport boot in bundle)\n");
