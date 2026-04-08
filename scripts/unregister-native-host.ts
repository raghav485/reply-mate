import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getChromeNativeHostPaths, NATIVE_HOST_NAME } from "./native-host-utils.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  if (process.platform === "darwin") {
    const { manifestPath, wrapperPath } = getChromeNativeHostPaths("darwin");
    await rm(manifestPath, { force: true });
    await rm(wrapperPath, { force: true });
  } else if (process.platform === "win32") {
    const { manifestPath, wrapperPath, registryKey } = getChromeNativeHostPaths(
      "win32",
      process.env
    );
    await rm(manifestPath, { force: true });
    await rm(wrapperPath, { force: true });
    await execFileAsync("reg", [
      "delete",
      registryKey!,
      "/f",
    ]).catch(() => {});
  }

  process.stdout.write(`Unregistered ${NATIVE_HOST_NAME}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
