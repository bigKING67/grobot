declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  pid: number;
  cwd(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  stdin: {
    isTTY?: boolean;
    setEncoding(encoding: string): void;
    [Symbol.asyncIterator](): AsyncIterator<string>;
  };
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
  export interface SpawnOptions {
    stdio?: ["pipe", "pipe", "pipe"];
  }

  export interface SpawnReadableStream {
    setEncoding(encoding: "utf8"): void;
    on(event: "data", listener: (chunk: string | Buffer) => void): void;
  }

  export interface SpawnWritableStream {
    write(
      data: string,
      encoding: "utf8",
      callback: (error?: Error | null) => void,
    ): void;
    end(): void;
    on(event: "error", listener: (error: Error) => void): void;
  }

  export interface SpawnProcess {
    stdin: SpawnWritableStream;
    stdout: SpawnReadableStream;
    stderr: SpawnReadableStream;
    kill(signal?: string): boolean;
    on(event: "error", listener: (error: Error) => void): SpawnProcess;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): SpawnProcess;
  }

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

  export function spawn(
    command: string,
    args?: string[],
    options?: SpawnOptions,
  ): SpawnProcess;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string): Hash;
    digest(): Buffer;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: string): Hash;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
}

declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
    mtimeMs: number;
  }

  export const constants: {
    W_OK: number;
  };

  export function readFileSync(path: number | string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function chmodSync(path: string, mode: number): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function unlinkSync(path: string): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function statSync(path: string): Stats;
  export function accessSync(path: string, mode?: number): void;
}

declare module "node:http" {
  export interface RequestOptions {
    protocol?: string;
    hostname?: string;
    port?: number;
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
  }

  export interface ClientRequest {
    on(event: "error", listener: (error: Error) => void): ClientRequest;
    on(event: "timeout", listener: () => void): ClientRequest;
    destroy(error?: Error): void;
    end(data?: string | Uint8Array): void;
  }

  export interface IncomingMessage {
    method?: string;
    url?: string;
    statusCode?: number;
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

  export function request(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ): ClientRequest;
}

declare module "node:https" {
  import { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

  export function request(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ): ClientRequest;
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

declare module "node:readline" {
  export interface Interface {
    question(prompt: string, callback: (answer: string) => void): void;
    close(): void;
    on(event: "SIGINT", listener: () => void): Interface;
  }

  export function createInterface(options: {
    input: unknown;
    output?: unknown;
  }): Interface;
}

declare module "./_shared/mock-model-server.mjs" {
  export interface MockModelServerCall {
    method: string;
    path: string;
    authorization: string;
    model: string;
    prompt: string;
    bodyText: string;
  }

  export interface MockModelServerHandle {
    baseUrl: string;
    getCalls(): MockModelServerCall[];
    close(): Promise<void>;
  }

  export function startMockModelServer(options?: {
    mode?: string;
    content?: string;
    responseDelayMs?: number;
  }): Promise<MockModelServerHandle>;
}
