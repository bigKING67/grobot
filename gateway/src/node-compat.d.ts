declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  stdout: {
    write(chunk: string): void;
  };
  stderr: {
    write(chunk: string): void;
  };
  exitCode?: number;
};

declare class Buffer extends Uint8Array {
  static from(data: string | Uint8Array, encoding?: string): Buffer;
  static concat(list: readonly Uint8Array[]): Buffer;
  static alloc(size: number): Buffer;
  toString(encoding?: string, start?: number, end?: number): string;
  subarray(start?: number, end?: number): Buffer;
}

declare module "node:child_process" {
  export interface SpawnSyncOptions {
    input?: string;
    encoding?: "utf8";
    timeout?: number;
    maxBuffer?: number;
  }

  export interface SpawnSyncReturns<TOutput> {
    status: number | null;
    signal: string | null;
    stdout: TOutput;
    stderr: TOutput;
    error?: unknown;
  }

  export function spawnSync(
    command: string,
    args?: string[],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<string>;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: string): Hash;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
}

declare module "node:fs" {
  export function readFileSync(path: number | string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
}

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: string) => void): void;
    on(event: "end", listener: () => void): void;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(data?: string): void;
  }

  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }

  export interface Server {
    listen(port: number, host?: string, callback?: () => void): void;
    address(): AddressInfo | string | null;
    close(callback?: (error?: Error) => void): void;
  }

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}

declare module "node:net" {
  export interface Socket {
    write(data: string | Uint8Array): boolean;
    end(data?: string | Uint8Array): void;
    destroy(error?: Error): void;
    on(event: "connect", listener: () => void): Socket;
    on(event: "data", listener: (chunk: Uint8Array) => void): Socket;
    on(event: "error", listener: (error: Error) => void): Socket;
    on(event: "close", listener: () => void): Socket;
  }

  export function createConnection(
    options: { host: string; port: number },
    listener?: () => void,
  ): Socket;
}
