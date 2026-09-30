// electron-builder afterPack hook: puts the web server's node_modules into the app.
//
// The till's UI is the Next.js standalone server in resources/web, started with
// Electron's own Node. It needs resources/web/node_modules (next, react, ...).
// electron-builder 26 always drops the top-level node_modules of any
// extraResources folder (app-builder-lib util/filter.js: `relative ===
// "node_modules"` returns false, whatever the filter says) — 24 did not. The app
// still packaged, still activated, and then showed nothing: "Cannot find module
// 'next'". So copy it in explicitly after packing, and fail the build if the
// result cannot start, rather than ship a till that cannot.

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, 'resources', 'web', 'node_modules');
  const webOut = path.join(context.appOutDir, 'resources', 'web');
  const dest = path.join(webOut, 'node_modules');

  if (!fs.existsSync(path.join(src, 'next', 'package.json'))) {
    throw new Error(`after-pack: ${src} has no next — run build-installer.ps1 so resources/web is staged`);
  }
  if (!fs.existsSync(path.join(webOut, 'server.js'))) {
    throw new Error(`after-pack: ${webOut} has no server.js`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });

  for (const mod of ['next', 'react', 'react-dom']) {
    if (!fs.existsSync(path.join(dest, mod, 'package.json'))) {
      throw new Error(`after-pack: ${mod} missing from ${dest}`);
    }
  }
  const count = fs.readdirSync(dest).length;
  console.log(`  • after-pack: copied web/node_modules (${count} top-level entries) -> ${dest}`);
};
