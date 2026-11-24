import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "@babel/parser";
import { getGitContext } from "../shared/git.js";

export interface ZhanjuanViteOptions {
  project?: string;
  mode?: string;
  healthPath?: string;
  attributeName?: string;
  rootDir?: string;
  include?: (id: string) => boolean;
}

interface Insertion {
  offset: number;
  text: string;
}

interface AstNodeLike {
  type: string;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
}

const INTRINSIC_TAG_RE = /^[a-z][a-z0-9-]*$/;
const JSX_EXT_RE = /\.[tj]sx$/i;

function isAstNode(value: unknown): value is AstNodeLike {
  return Boolean(value && typeof value === "object" && "type" in value && typeof (value as AstNodeLike).type === "string");
}

function walkAst(node: unknown, visit: (node: AstNodeLike) => void): void {
  if (!isAstNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) {
          walkAst(item, visit);
        }
      }
    } else if (isAstNode(child)) {
      walkAst(child, visit);
    }
  }
}

export function injectDataSourceTags(
  code: string,
  filePath: string,
  opts?: { rootDir?: string; attributeName?: string },
): string | null {
  const attributeName = opts?.attributeName ?? "data-source";
  const rootDir = opts?.rootDir ?? process.cwd();
  const relPosix = path.relative(rootDir, filePath).replaceAll("\\", "/") || path.basename(filePath);
  const safeRel = relPosix.replaceAll('"', "&quot;");

  let ast: unknown;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      errorRecovery: false,
    });
  } catch {
    return null;
  }

  const insertions: Insertion[] = [];

  walkAst(ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const nameNode = node.name as AstNodeLike | undefined;
    if (!nameNode || nameNode.type !== "JSXIdentifier") return;

    const tagName = String(nameNode.name ?? "");
    if (!INTRINSIC_TAG_RE.test(tagName)) return;

    const attributes = Array.isArray(node.attributes) ? (node.attributes as AstNodeLike[]) : [];
    const alreadyTagged = attributes.some((attr) => {
      if (attr.type !== "JSXAttribute") return false;
      const attrName = attr.name as AstNodeLike | undefined;
      return attrName?.type === "JSXIdentifier" && attrName.name === attributeName;
    });
    if (alreadyTagged) return;

    const typeParams = node.typeParameters as { end?: number } | undefined;
    const rawNameEnd = nameNode["end"];
    const insertOffset =
      typeof typeParams?.end === "number"
        ? typeParams.end
        : typeof rawNameEnd === "number"
          ? rawNameEnd
          : undefined;

    const line = node.loc?.start.line;
    if (insertOffset === undefined || typeof line !== "number") return;

    insertions.push({
      offset: insertOffset,
      text: ` ${attributeName}="${safeRel}:${line}"`,
    });
  });

  if (insertions.length === 0) {
    return null;
  }

  insertions.sort((a, b) => b.offset - a.offset);
  let output = code;
  for (const ins of insertions) {
    output = `${output.slice(0, ins.offset)}${ins.text}${output.slice(ins.offset)}`;
  }
  return output;
}

export interface ZhanjuanVitePlugin {
  name: string;
  enforce: "pre";
  apply: "serve";
  configResolved: (config: { command: string; mode: string; root: string }) => void;
  configureServer: (server: {
    middlewares: {
      use: (
        route: string,
        handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
      ) => void;
    };
  }) => void;
  transform: (code: string, id: string) => { code: string; map: null } | null;
}

export function zhanjuanVite(options: ZhanjuanViteOptions = {}): ZhanjuanVitePlugin {
  const attributeName = options.attributeName ?? "data-source";
  const healthPath = options.healthPath ?? "/__zhanjuan-health";

  let isServe = false;
  let resolvedRoot = options.rootDir ?? process.cwd();
  let resolvedMode = options.mode;

  return {
    name: "zhanjuan:source-tag",
    enforce: "pre",
    apply: "serve",
    configResolved(config) {
      isServe = config.command === "serve";
      resolvedRoot = options.rootDir ?? config.root ?? process.cwd();
      if (!resolvedMode) {
        resolvedMode = config.mode;
      }
    },
    configureServer(server) {
      const git = getGitContext(resolvedRoot);
      const expectedProject = options.project ?? path.basename(git.repoRoot);
      server.middlewares.use(healthPath, (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const payload = JSON.stringify({
          ok: true,
          repoRoot: git.repoRoot,
          worktreePath: git.worktreePath,
          expectedProject,
          expectedMode: resolvedMode,
        });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(payload);
      });
    },
    transform(code, id) {
      if (!isServe) return null;
      const cleanId = id.split("?")[0] ?? id;
      if (!JSX_EXT_RE.test(cleanId)) return null;
      if (cleanId.includes("/node_modules/") || cleanId.includes("\\node_modules\\")) return null;
      if (options.include && !options.include(cleanId)) return null;

      const transformed = injectDataSourceTags(code, cleanId, {
        rootDir: resolvedRoot,
        attributeName,
      });
      if (!transformed) return null;
      return {
        code: transformed,
        map: null,
      };
    },
  };
}

export default zhanjuanVite;
