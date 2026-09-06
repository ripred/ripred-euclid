import type { ReactNode } from "react";
import { EditionContext, useEditionSession } from "./use-edition";

export function EditionProvider({ children }: { children: ReactNode }) {
  const session = useEditionSession();
  return (
    <EditionContext.Provider value={session}>
      {children}
    </EditionContext.Provider>
  );
}
