import { createContext, useContext, type ReactNode } from "react";

const ActiveTabContext = createContext<number | null>(null);

export function ActiveTabProvider(props: {
  tabId: number | null;
  children: ReactNode;
}) {
  return (
    <ActiveTabContext.Provider value={props.tabId}>
      {props.children}
    </ActiveTabContext.Provider>
  );
}

export function useActiveTabId(): number | null {
  return useContext(ActiveTabContext);
}
