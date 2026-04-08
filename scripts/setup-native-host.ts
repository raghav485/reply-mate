import { spawn } from "node:child_process";
import {
  assertValidExtensionId,
  getBuiltHostPath,
  readArg,
  resolveRepoRoot,
} from "./native-host-utils.js";

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
    });
  });
}

async function main(): Promise<void> {
  const extensionId = readArg("--extension-id").trim();
  assertValidExtensionId(extensionId);

  const repoRoot = resolveRepoRoot();
  const builtHost = getBuiltHostPath(repoRoot);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  process.stdout.write("ReplyMate native-host setup\n");
  process.stdout.write(`- Extension ID: ${extensionId}\n`);
  process.stdout.write(`- Native host build target: ${builtHost}\n`);

  await run(npmCommand, ["run", "build", "--workspace", "@replymate/api"], repoRoot);
  await run(
    npmCommand,
    ["run", "register:native-host", "--", "--extension-id", extensionId],
    repoRoot
  );

  process.stdout.write("\nNext steps:\n");
  process.stdout.write("1. Fully quit Chrome.\n");
  process.stdout.write("2. Reopen Chrome.\n");
  process.stdout.write("3. Reload the unpacked ReplyMate extension.\n");
  process.stdout.write("4. Reopen the side panel and validate the connection.\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
