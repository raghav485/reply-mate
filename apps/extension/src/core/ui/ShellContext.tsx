import { createContext, useContext } from "react";
import type { ModuleContext } from "@replymate/contracts";

const ShellContext = createContext<ModuleContext | null>(null);

export function ShellContextProvider(props: {
  ctx: ModuleContext;
  children: React.ReactNode;
}) {
  return <ShellContext.Provider value={props.ctx}>{props.children}</ShellContext.Provider>;
}

export function useShellContext(): ModuleContext {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("Shell context is not available.");
  }
  return ctx;
}
