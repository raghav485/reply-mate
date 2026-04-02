import { copyFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(extensionRoot, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const esbuildCommand =
  process.platform === "win32"
    ? resolve(extensionRoot, "../../node_modules/.bin/esbuild.cmd")
    : resolve(extensionRoot, "../../node_modules/.bin/esbuild");

function prefixWrite(label, chunk) {
  const lines = chunk.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line && index === lines.length - 1) continue;
    process.stdout.write(`[extension:${label}] ${line}\n`);
  }
}

async function copyManifest() {
  await mkdir(distDir, { recursive: true });
  await copyFile(resolve(extensionRoot, "manifest.json"), resolve(distDir, "manifest.json"));
}

function spawnManaged(label, command, args) {
  const child = spawn(command, args, {
    cwd: extensionRoot,
    env: {
      ...process.env,
      ...(label === "vite" ? { REPLYMATE_EXTENSION_WATCH_MODE: "1" } : {}),
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => prefixWrite(label, chunk));
  child.stderr.on("data", (chunk) => prefixWrite(label, chunk));
  return child;
}

async function main() {
  await copyManifest();

  const manifestWatcher = watch(resolve(extensionRoot, "manifest.json"), () => {
    void copyManifest().catch((error) => {
      prefixWrite("manifest", error instanceof Error ? error.message : String(error));
    });
  });

  prefixWrite("watch", "starting npm run build:watch");
  prefixWrite(
    "watch",
    `starting ${esbuildCommand.replace(`${extensionRoot}/`, "")} src/content/index.ts --watch`
  );

  const vite = spawnManaged("vite", npmCommand, ["run", "build:watch"]);
  const esbuild = spawnManaged("esbuild", esbuildCommand, [
    "src/content/index.ts",
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=chrome114",
    "--outfile=dist/content.js",
    "--watch",
  ]);

  const children = [vite, esbuild];
  let shuttingDown = false;
  let exitCode = 0;

  function shutdown(nextCode, signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = nextCode;
    manifestWatcher.close();
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  }

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (shuttingDown) {
        if (children.every((item) => item.killed || item.exitCode !== null)) {
          process.exit(exitCode);
        }
        return;
      }

      prefixWrite(
        "watch",
        signal ? `stopped by ${signal}` : `exited with code ${code ?? 0}`
      );
      shutdown(code ?? 1, "SIGTERM");
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(0, signal));
  }

  process.stdout.write("ReplyMate extension watch ready\n");
  process.stdout.write("- Output: apps/extension/dist\n");
  process.stdout.write("- Manifest: apps/extension/dist/manifest.json\n");
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "ReplyMate extension watch failed."}\n`
  );
  process.exit(1);
});
