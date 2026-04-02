import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export type ManagedProcessLabel = string;

type ManagedChild = {
  label: ManagedProcessLabel;
  process: ChildProcessWithoutNullStreams;
};

export function runDevStack(input: {
  repoRoot: string;
  title: string;
  processes: Array<{ label: ManagedProcessLabel; script: string }>;
  startupLines: string[];
}): void {
  function writePrefixed(label: ManagedChild["label"], chunk: string): void {
    const prefix = `[${label}] `;
    const lines = chunk.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line && index === lines.length - 1) continue;
      process.stdout.write(`${prefix}${line}\n`);
    }
  }

  function attachOutput(child: ManagedChild): void {
    child.process.stdout.setEncoding("utf8");
    child.process.stderr.setEncoding("utf8");
    child.process.stdout.on("data", (chunk: string) => writePrefixed(child.label, chunk));
    child.process.stderr.on("data", (chunk: string) => writePrefixed(child.label, chunk));
  }

  function spawnDevProcess(label: ManagedChild["label"], script: string): ManagedChild {
    const child = spawn(npmCommand, ["run", script], {
      cwd: input.repoRoot,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    return {
      label,
      process: child,
    };
  }

  function terminate(children: ManagedChild[], signal: NodeJS.Signals): void {
    for (const child of children) {
      if (!child.process.killed) {
        child.process.kill(signal);
      }
    }
  }

  const children = input.processes.map((item) =>
    spawnDevProcess(item.label, item.script)
  );

  for (const child of children) {
    attachOutput(child);
  }

  process.stdout.write(`${input.title}\n`);
  for (const line of input.startupLines) {
    process.stdout.write(`${line}\n`);
  }

  let shuttingDown = false;
  let remainingChildren = children.length;
  let desiredExitCode = 0;

  function handleExit(code: number): void {
    if (shuttingDown) return;
    shuttingDown = true;
    desiredExitCode = code;
    terminate(children, "SIGTERM");
  }

  for (const child of children) {
    child.process.on("exit", (code, signal) => {
      remainingChildren -= 1;

      if (shuttingDown) {
        if (remainingChildren <= 0) {
          process.exit(desiredExitCode);
        }
        return;
      }

      if (signal) {
        writePrefixed(child.label, `stopped by ${signal}`);
        handleExit(1);
        return;
      }

      writePrefixed(child.label, `exited with code ${code ?? 0}`);
      handleExit(code ?? 0);
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      desiredExitCode = 0;
      terminate(children, signal);
    });
  }
}
