const { execSync } = require("child_process");
const fs = require("fs");

// 1. 빌드
console.log("Building...");
execSync("node build.js", { stdio: "inherit" });

// 2. 이전 ZIP 삭제
const outFile = "textboi-extension.zip";
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

// 3. 프로젝트 루트에서 직접 ZIP 생성 (경로 구조 그대로 유지)
const files = [
  "manifest.json",
  "billing-success.html",
  "billing-success.js",
  "icons",
  "assets",
  "content/styles.css",
  "popup/popup.html",
  "popup/popup.css",
  "dist/background/background.js",
  "dist/content/content.js",
  "dist/popup/popup.js",
];

execSync(`zip -r -9 "${outFile}" ${files.join(" ")}`, { stdio: "inherit" });

const size = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`\n✅ ${outFile} (${size} KB)`);
