/**
 * Filesystem + command-execution abstraction the tools run against.
 *
 * Tools never touch node:fs / child processes directly — they go through a Sandbox.
 * This keeps tools unit-testable (inject a mock) and leaves a seam for future
 * sandbox backends (ACP / remote). LocalSandbox is the only impl for now.
 *
 * Paths are interpreted relative to the sandbox's workspace root; absolute
 * paths pass through. Reads may reach outside the root; the write boundary is
 * enforced by the permission gate above the sandbox, not here.
 */
export interface Sandbox {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string, append?: boolean): Promise<{ bytes: number }>;
  list(path: string, maxDepth?: number): Promise<string[]>;
  exec(
    command: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ output: string; exitCode: number }>;
}
