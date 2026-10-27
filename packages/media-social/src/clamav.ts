import { createHash } from "node:crypto";
import { createConnection, type Socket } from "node:net";

import type {
  MalwareScanner,
  ObjectStoragePort,
  StoredObjectMetadata,
} from "./storage.js";

export interface ClamAvMalwareScannerOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly downloadUrlTtlSeconds: number;
}

function connect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(
      () => socket.destroy(new Error("CLAMAV_CONNECT_TIMEOUT")),
      timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("connect", connected);
      socket.off("error", failed);
    };
    const connected = (): void => {
      cleanup();
      socket.setTimeout(timeoutMs, () =>
        socket.destroy(new Error("CLAMAV_TIMEOUT")),
      );
      resolve(socket);
    };
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    socket.once("connect", connected);
    socket.once("error", failed);
  });
}

function write(socket: Socket, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

function readResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onClose = (): void => fail(new Error("CLAMAV_RESPONSE_INCOMPLETE"));
    const onData = (chunk: Buffer): void => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 4096) {
        fail(new Error("CLAMAV_RESPONSE_TOO_LARGE"));
        return;
      }
      const terminator = response.indexOf(0);
      if (terminator >= 0) {
        const value = response.subarray(0, terminator).toString("utf8");
        cleanup();
        resolve(value);
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function command(
  host: string,
  port: number,
  timeoutMs: number,
  value: string,
): Promise<string> {
  const socket = await connect(host, port, timeoutMs);
  try {
    const response = readResponse(socket);
    await write(socket, Buffer.from(`z${value}\0`));
    return await response;
  } finally {
    socket.destroy();
  }
}

export class ClamAvMalwareScanner implements MalwareScanner {
  public readonly configured = true;

  public constructor(
    private readonly storage: ObjectStoragePort,
    private readonly options: ClamAvMalwareScannerOptions,
  ) {
    if (!options.host.trim() || /\s/.test(options.host))
      throw new Error("INVALID_CLAMAV_HOST");
    if (
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535
    )
      throw new Error("INVALID_CLAMAV_PORT");
    if (options.timeoutMs < 1000 || options.timeoutMs > 300_000)
      throw new Error("INVALID_CLAMAV_TIMEOUT");
    if (options.maxBytes < 1 || options.maxBytes > 1024 * 1024 * 1024)
      throw new Error("INVALID_CLAMAV_MAX_BYTES");
    if (
      options.downloadUrlTtlSeconds < 30 ||
      options.downloadUrlTtlSeconds > 3600
    )
      throw new Error("INVALID_CLAMAV_DOWNLOAD_TTL");
  }

  public async health(): Promise<boolean> {
    try {
      return (
        (await command(
          this.options.host,
          this.options.port,
          Math.min(this.options.timeoutMs, 5000),
          "PING",
        )) === "PONG"
      );
    } catch {
      return false;
    }
  }

  public async scan(
    metadata: StoredObjectMetadata,
  ): Promise<{ safe: boolean; reason?: string }> {
    if (metadata.sizeBytes < 0 || metadata.sizeBytes > this.options.maxBytes)
      return { safe: false, reason: "scanner_size_limit" };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("CLAMAV_TIMEOUT")),
      this.options.timeoutMs,
    );
    let socket: Socket | undefined;
    try {
      const url = await this.storage.createDownloadUrl(
        metadata.objectKey,
        new Date(Date.now() + this.options.downloadUrlTtlSeconds * 1000),
      );
      const download = await fetch(url, { signal: controller.signal });
      if (!download.ok || !download.body)
        return { safe: false, reason: "scanner_download_failed" };
      socket = await connect(
        this.options.host,
        this.options.port,
        this.options.timeoutMs,
      );
      await write(socket, Buffer.from("zINSTREAM\0"));
      const hash = createHash("sha256");
      let scannedBytes = 0;
      const reader = download.body.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          scannedBytes += chunk.length;
          if (
            scannedBytes > metadata.sizeBytes ||
            scannedBytes > this.options.maxBytes
          ) {
            await reader.cancel();
            return { safe: false, reason: "scanner_size_mismatch" };
          }
          hash.update(chunk);
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.length);
          await write(socket, size);
          await write(socket, chunk);
        }
      } finally {
        reader.releaseLock();
      }
      if (
        scannedBytes !== metadata.sizeBytes ||
        hash.digest("hex") !== metadata.checksumSha256
      )
        return { safe: false, reason: "scanner_integrity_mismatch" };
      const response = readResponse(socket);
      await write(socket, Buffer.alloc(4));
      const verdict = await response;
      if (verdict === "stream: OK") return { safe: true };
      if (/^stream: .+ FOUND$/.test(verdict))
        return { safe: false, reason: "malware_detected" };
      return { safe: false, reason: "scanner_error" };
    } catch {
      return { safe: false, reason: "scanner_unavailable" };
    } finally {
      clearTimeout(timeout);
      socket?.destroy();
    }
  }
}
