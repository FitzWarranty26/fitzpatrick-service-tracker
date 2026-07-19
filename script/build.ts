import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Copy PWA assets to dist/public
  const pwaAssets = [
    ["manifest.json", "dist/public/manifest.json"],
    ["attached_assets/apple-touch-icon.png", "dist/public/apple-touch-icon.png"],
    ["attached_assets/favicon-32.png", "dist/public/favicon-32.png"],
    ["attached_assets/icon-192.png", "dist/public/icon-192.png"],
    ["attached_assets/icon-512.png", "dist/public/icon-512.png"],
    ["attached_assets/icon-167.png", "dist/public/icon-167.png"],
  ];
  for (const [src, dest] of pwaAssets) {
    if (existsSync(src)) {
      await copyFile(src, dest);
    }
  }
  console.log("copied PWA assets");

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Copy versioned migration SQL into dist so the bundled server can find them
  // even if the process cwd differs from the repo root (see server/migrate.ts).
  if (existsSync("migrations")) {
    await mkdir("dist/migrations", { recursive: true });
    for (const f of await readdir("migrations")) {
      if (f.endsWith(".sql")) {
        await copyFile(join("migrations", f), join("dist/migrations", f));
      }
    }
    console.log("copied migrations to dist/migrations");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
