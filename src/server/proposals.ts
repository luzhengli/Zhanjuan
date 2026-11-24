import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProposalItem, ResolvedCanvasConfig } from "../shared/types.js";

const ENTRY_CANDIDATES = ["index.tsx", "index.jsx", "index.ts", "index.js", "index.html"];

export function discoverProposals(config: ResolvedCanvasConfig): ProposalItem[] {
  if (!config.proposals) {
    return [];
  }
  const proposalsRoot = path.resolve(config.projectRoot, config.proposals.dir);
  if (!existsSync(proposalsRoot)) {
    return [];
  }

  const entries = readdirSync(proposalsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items: ProposalItem[] = [];
  for (const entry of entries) {
    const dirAbs = path.join(proposalsRoot, entry.name);
    const hasEntry = ENTRY_CANDIDATES.some((file) => existsSync(path.join(dirAbs, file)));
    if (!hasEntry) continue;

    let title = entry.name
      .split(/[-_]+/)
      .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
      .join(" ");
    let description: string | undefined;
    let baseBoard: string | undefined = config.proposals.compareWith;

    const metaPath = path.join(dirAbs, "proposal.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
          title?: unknown;
          description?: unknown;
          baseBoard?: unknown;
        };
        if (typeof meta.title === "string" && meta.title.trim()) {
          title = meta.title.trim();
        }
        if (typeof meta.description === "string" && meta.description.trim()) {
          description = meta.description.trim();
        }
        if (typeof meta.baseBoard === "string" && meta.baseBoard.trim()) {
          baseBoard = meta.baseBoard.trim();
        }
      } catch {
        // Ignore malformed proposal.json metadata and fall back to folder name.
      }
    }

    const prefix = config.proposals.routePrefix.endsWith("/")
      ? config.proposals.routePrefix
      : `${config.proposals.routePrefix}/`;

    items.push({
      id: entry.name,
      title,
      description,
      baseBoard,
      route: `${prefix}${encodeURIComponent(entry.name)}`,
      sourcePath: path.relative(config.projectRoot, dirAbs).replaceAll("\\", "/"),
    });
  }

  return items;
}
