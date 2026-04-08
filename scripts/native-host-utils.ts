import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NATIVE_HOST_NAME = "app.replymate.native";

export function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

export function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function isValidExtensionId(input: string): boolean {
  return /^[a-p]{32}$/.test(input.trim());
}

export function assertValidExtensionId(extensionId: string): void {
  if (!extensionId) {
    throw new Error("Missing required --extension-id argument.");
  }
  if (!isValidExtensionId(extensionId)) {
    throw new Error(
      "The provided extension ID is invalid. Chrome extension IDs must be 32 lowercase characters in the range a-p."
    );
  }
}

export function getBuiltHostPath(repoRoot: string): string {
  return join(repoRoot, "apps", "api", "dist", "native", "nativeHost.js");
}

export function assertBuiltHostExists(repoRoot: string): string {
  const builtHost = getBuiltHostPath(repoRoot);
  if (!existsSync(builtHost)) {
    throw new Error(
      "Build the API first so the native host exists at apps/api/dist/native/nativeHost.js."
    );
  }
  return builtHost;
}

export function getChromeNativeHostPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env) {
  if (platform === "darwin") {
    const hostDir = join(
      homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts"
    );
    const wrapperDir = join(homedir(), ".replymate", "native-hosts");
    return {
      supported: true as const,
      manifestPath: join(hostDir, `${NATIVE_HOST_NAME}.json`),
      wrapperPath: join(wrapperDir, `${NATIVE_HOST_NAME}.sh`),
      hostDir,
      wrapperDir,
      registryKey: null,
    };
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const hostDir = join(localAppData, "ReplyMate", "NativeMessagingHosts");
    return {
      supported: true as const,
      manifestPath: join(hostDir, `${NATIVE_HOST_NAME}.json`),
      wrapperPath: join(hostDir, `${NATIVE_HOST_NAME}.cmd`),
      hostDir,
      wrapperDir: hostDir,
      registryKey: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.replymate.native",
    };
  }

  return {
    supported: false as const,
    manifestPath: "",
    wrapperPath: "",
    hostDir: "",
    wrapperDir: "",
    registryKey: null,
  };
}
