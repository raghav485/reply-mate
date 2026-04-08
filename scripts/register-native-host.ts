import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertBuiltHostExists,
  assertValidExtensionId,
  getChromeNativeHostPaths,
  NATIVE_HOST_NAME,
  readArg,
  resolveRepoRoot,
} from "./native-host-utils.js";

const execFileAsync = promisify(execFile);

function resolveHostCommand(repoRoot: string): { command: string; args: string[] } {
  const builtHost = assertBuiltHostExists(repoRoot);

  return {
    command: process.execPath,
    args: [builtHost],
  };
}

async function registerMacOs(extensionId: string, repoRoot: string): Promise<void> {
  const { hostDir, wrapperDir, manifestPath } = getChromeNativeHostPaths("darwin");
  await mkdir(hostDir, { recursive: true });
  await mkdir(wrapperDir, { recursive: true });

  const { command, args } = resolveHostCommand(repoRoot);
  const wrapperPath = join(wrapperDir, `${NATIVE_HOST_NAME}.sh`);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${command}" ${args.map((arg) => `"${arg}"`).join(" ")}\n`,
    { mode: 0o700 }
  );
  await chmod(wrapperPath, 0o700);

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: "ReplyMate native host",
        path: wrapperPath,
        type: "stdio",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2
    )
  );
}

async function registerWindows(extensionId: string, repoRoot: string): Promise<void> {
  const { hostDir, manifestPath, registryKey, wrapperPath } = getChromeNativeHostPaths(
    "win32",
    process.env
  );
  await mkdir(hostDir, { recursive: true });
  const { command, args } = resolveHostCommand(repoRoot);

  await writeFile(
    wrapperPath,
    `@echo off\r\n"${command}" ${args.map((arg) => `"${arg}"`).join(" ")}\r\n`
  );

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: "ReplyMate native host",
        path: wrapperPath,
        type: "stdio",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2
    )
  );

  await execFileAsync("reg", [
    "add",
    registryKey!,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ]);
}

async function main(): Promise<void> {
  const extensionId = readArg("--extension-id").trim();
  assertValidExtensionId(extensionId);
  const repoRoot = resolveRepoRoot();

  if (process.platform === "darwin") {
    await registerMacOs(extensionId, repoRoot);
  } else if (process.platform === "win32") {
    await registerWindows(extensionId, repoRoot);
  } else {
    throw new Error("Native host registration is supported only on macOS and Windows.");
  }

  process.stdout.write(`Registered ${NATIVE_HOST_NAME} for ${extensionId}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
