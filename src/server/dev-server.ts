import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { GitContext, ResolvedCanvasConfig, RuntimeInfo } from "../shared/types.js";

export interface ExpectedProbeIdentity {
  repoRoot: string;
  worktreePath: string;
  expectedProject?: string;
  expectedMode?: string;
}

export interface ProbeResponse {
  ok?: boolean;
  repoRoot?: string;
  worktreePath?: string;
  expectedProject?: string;
  expectedMode?: string;
}

export async function allocateFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to resolve ephemeral port.")));
        return;
      }
      const { port } = addr;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export async function probeReuseHealth(
  port: number,
  probePath: string,
  expected: ExpectedProbeIdentity,
  timeoutMs = 1500,
): Promise<{ matched: boolean; reason?: string; payload?: ProbeResponse }> {
  const url = `http://127.0.0.1:${port}${probePath.startsWith("/") ? probePath : `/${probePath}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { matched: false, reason: `HTTP ${res.status} from ${probePath}` };
    }
    const payload = (await res.json()) as ProbeResponse;
    if (typeof payload.repoRoot !== "string" || path.resolve(payload.repoRoot) !== path.resolve(expected.repoRoot)) {
      return {
        matched: false,
        reason: `repoRoot mismatch: got ${String(payload.repoRoot)}, expected ${expected.repoRoot}`,
        payload,
      };
    }
    if (
      typeof payload.worktreePath !== "string" ||
      path.resolve(payload.worktreePath) !== path.resolve(expected.worktreePath)
    ) {
      return {
        matched: false,
        reason: `worktreePath mismatch: got ${String(payload.worktreePath)}, expected ${expected.worktreePath}`,
        payload,
      };
    }
    if (payload.expectedProject !== expected.expectedProject) {
      return {
        matched: false,
        reason: `expectedProject mismatch: got ${String(payload.expectedProject)}, expected ${String(expected.expectedProject)}`,
        payload,
      };
    }
    if (payload.expectedMode !== expected.expectedMode) {
      return {
        matched: false,
        reason: `expectedMode mismatch: got ${String(payload.expectedMode)}, expected ${String(expected.expectedMode)}`,
        payload,
      };
    }
    return { matched: true, payload };
  } catch (err) {
    return { matched: false, reason: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttpReachable(port: number, pathName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        method: "GET",
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export interface ManagedDevServer {
  port: number;
  url: string;
  reused: boolean;
  stop: () => Promise<void>;
}

export async function ensureDevServer(
  config: ResolvedCanvasConfig,
  git: GitContext,
  opts?: { reusePort?: number },
): Promise<ManagedDevServer> {
  const expected: ExpectedProbeIdentity = {
    repoRoot: git.repoRoot,
    worktreePath: git.worktreePath,
    expectedProject: config.devServer.expectedProject,
    expectedMode: config.devServer.expectedMode,
  };

  // Only attempt reuse when reuseProbe is configured AND a candidate port is explicitly known or recorded in runtime.json.
  if (config.devServer.reuseProbe) {
    const candidatePort = opts?.reusePort ?? readSavedDevPort(config.notesDirAbsolute);
    if (candidatePort) {
      const probe = await probeReuseHealth(candidatePort, config.devServer.reuseProbe, expected);
      if (probe.matched) {
        return {
          port: candidatePort,
          url: `http://127.0.0.1:${candidatePort}`,
          reused: true,
          stop: async () => undefined,
        };
      }
    }
  }

  const devPort = await allocateFreePort("127.0.0.1");
  const command = config.devServer.command.replaceAll("{port}", String(devPort));
  const logs: string[] = [];
  const appendLog = (chunk: Buffer): void => {
    const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      logs.push(line);
      if (logs.length > 120) logs.shift();
    }
  };

  const child: ChildProcess = spawn(command, {
    cwd: config.devServer.cwd,
    env: {
      ...process.env,
      ...config.devServer.env,
      PORT: String(devPort),
      ZHANJUAN_PORT: String(devPort),
    },
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);

  let exited = false;
  let exitInfo = "";
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const stop = async (): Promise<void> => {
    if (exited || !child.pid) return;
    await terminateProcessGroup(child);
  };

  const deadline = Date.now() + config.devServer.readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `Host devServer exited prematurely (${exitInfo}). Command: ${command}\nRecent output:\n${logs.join("\n")}`,
      );
    }

    const reachable = await checkHttpReachable(devPort, config.devServer.readyPath);
    if (reachable) {
      if (config.devServer.reuseProbe) {
        const probe = await probeReuseHealth(devPort, config.devServer.reuseProbe, expected);
        if (probe.matched) {
          return {
            port: devPort,
            url: `http://127.0.0.1:${devPort}`,
            reused: false,
            stop,
          };
        }
        // Give the server a brief chance if readyPath answered before probe route registered, else wait until timeout.
      } else {
        return {
          port: devPort,
          url: `http://127.0.0.1:${devPort}`,
          reused: false,
          stop,
        };
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  let probeHint = "";
  if (config.devServer.reuseProbe) {
    const lastProbe = await probeReuseHealth(devPort, config.devServer.reuseProbe, expected);
    probeHint = lastProbe.reason ? `\nLast probe check: ${lastProbe.reason}` : "";
  }
  await stop();
  throw new Error(
    `Timed out after ${config.devServer.readyTimeoutMs}ms waiting for host devServer on 127.0.0.1:${devPort}.${probeHint}\nRecent output:\n${logs.join("\n")}`,
  );
}

function readSavedDevPort(notesDirAbsolute: string): number | undefined {
  const runtimePath = path.join(notesDirAbsolute, "runtime.json");
  if (!existsSync(runtimePath)) return undefined;
  try {
    const info = JSON.parse(readFileSync(runtimePath, "utf8")) as Partial<RuntimeInfo>;
    if (typeof info.devPort === "number" && Number.isInteger(info.devPort) && info.devPort > 0) {
      return info.devPort;
    }
  } catch {
    // Ignore invalid runtime file.
  }
  return undefined;
}

export async function terminateProcessGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }

  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already dead.
    }
  }
}
