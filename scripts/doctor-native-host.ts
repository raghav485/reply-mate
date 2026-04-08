import { existsSync, readFileSync } from "node:fs";
import {
  assertValidExtensionId,
  getBuiltHostPath,
  getChromeNativeHostPaths,
  NATIVE_HOST_NAME,
  readArg,
  resolveRepoRoot,
} from "./native-host-utils.js";

type ManifestShape = {
  allowed_origins?: string[];
  path?: string;
};

function readManifest(path: string): ManifestShape | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as ManifestShape;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const extensionId = readArg("--extension-id").trim();
  if (extensionId) {
    assertValidExtensionId(extensionId);
  }

  const repoRoot = resolveRepoRoot();
  const builtHostPath = getBuiltHostPath(repoRoot);
  const target = getChromeNativeHostPaths(process.platform, process.env);

  if (!target.supported) {
    throw new Error("Native-host diagnostics are supported only on macOS and Windows.");
  }

  const manifest = readManifest(target.manifestPath);
  const expectedOrigin = extensionId ? `chrome-extension://${extensionId}/` : null;
  const allowedOrigins = manifest?.allowed_origins || [];

  process.stdout.write("ReplyMate native-host diagnostics\n");
  process.stdout.write(`- Host name: ${NATIVE_HOST_NAME}\n`);
  process.stdout.write(`- Built host exists: ${existsSync(builtHostPath) ? "yes" : "no"}\n`);
  process.stdout.write(`- Built host path: ${builtHostPath}\n`);
  process.stdout.write(`- Manifest path: ${target.manifestPath}\n`);
  process.stdout.write(`- Manifest exists: ${existsSync(target.manifestPath) ? "yes" : "no"}\n`);
  process.stdout.write(`- Wrapper path: ${target.wrapperPath}\n`);
  process.stdout.write(`- Wrapper exists: ${existsSync(target.wrapperPath) ? "yes" : "no"}\n`);
  if (target.registryKey) {
    process.stdout.write(`- Registry key: ${target.registryKey}\n`);
  }

  if (manifest) {
    process.stdout.write(
      `- Allowed origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "none"}\n`
    );
    process.stdout.write(`- Manifest command path: ${manifest.path || "missing"}\n`);
  }

  if (expectedOrigin) {
    process.stdout.write(`- Expected origin: ${expectedOrigin}\n`);
    process.stdout.write(
      `- Expected origin present: ${allowedOrigins.includes(expectedOrigin) ? "yes" : "no"}\n`
    );
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
