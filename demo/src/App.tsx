import React, { useEffect, useState } from "react";
import { ActivityPage } from "./pages/ActivityPage.js";
import { DesignSystemPage } from "./pages/DesignSystemPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";

type ProposalLoader = () => Promise<{ default: React.ComponentType }>;

const proposalModules: Record<string, ProposalLoader> = import.meta.env.DEV
  ? (import.meta.glob("./proposals/*/index.tsx") as Record<string, ProposalLoader>)
  : {};

function getHashRoute(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

const ProposalHost: React.FC<{ id: string }> = ({ id }) => {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    const key = `./proposals/${decodeURIComponent(id)}/index.tsx`;
    const loader = proposalModules[key];
    if (!loader) {
      setComp(null);
      return;
    }
    void loader().then((mod) => setComp(() => mod.default));
  }, [id]);

  if (!Comp) {
    return <div className="p-6 text-muted">Proposal not found: {id}</div>;
  }
  return <Comp />;
};

export const App: React.FC = () => {
  const [route, setRoute] = useState<string>(getHashRoute);

  useEffect(() => {
    const onHash = () => setRoute(getHashRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (import.meta.env.DEV) {
    if (route === "/__studio/design-system") {
      return <DesignSystemPage />;
    }
    if (route.startsWith("/__studio/proposals/")) {
      const id = route.slice("/__studio/proposals/".length);
      return <ProposalHost id={id} />;
    }
  }

  const isActivity = route === "/activity";
  const navLinkBase = "no-underline py-2 px-2.5 rounded-lg font-medium transition-colors";

  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr] max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_1fr]">
      <aside className="bg-surface border-r border-line py-5 px-3.5 flex flex-col gap-4 max-[959px]:border-r-0 max-[959px]:border-b max-[959px]:flex-row max-[959px]:items-center max-[959px]:justify-between">
        <div className="font-bold text-base text-ink">Demo Studio Host</div>
        <nav className="flex flex-col gap-1.5 max-[959px]:flex-row">
          <a
            href="#/"
            className={`${navLinkBase} ${!isActivity ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}
          >
            Workspace
          </a>
          <a
            href="#/activity"
            className={`${navLinkBase} ${isActivity ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}
          >
            Activity
          </a>
        </nav>
      </aside>

      {isActivity ? <ActivityPage /> : <WorkspacePage />}
    </div>
  );
};
