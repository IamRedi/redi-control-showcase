import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ClamAvMalwareScanner } from "../src/clamav.js";
import type {
  ObjectStoragePort,
  StoredObjectMetadata,
} from "../src/storage.js";

const bytes = Buffer.from("safe media bytes");
const objectKey =
  "tenant/00000000-0000-4000-8000-000000000001/media/00000000-0000-4000-8000-000000000002/original.jpg";
const metadata: StoredObjectMetadata = {
  objectKey,
  sizeBytes: bytes.length,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  declaredMimeType: "image/jpeg",
  observedMimeType: "image/jpeg",
};

const storage: ObjectStoragePort = {
  health: () => Promise.resolve(true),
  createUploadGrant: () => Promise.reject(new Error("not used")),
  head: () => Promise.reject(new Error("not used")),
  createDownloadUrl: () => Promise.resolve("https://objects.test/file"),
  delete: () => Promise.reject(new Error("not used")),
};

const servers: Server[] = [];

async function fakeClamd(verdict: string): Promise<number> {
  const server = createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      if (request.equals(Buffer.from("zPING\0"))) {
        socket.end("PONG\0");
        return;
      }
      const commandLength = Buffer.byteLength("zINSTREAM\0");
      if (request.length < commandLength) return;
      let offset = commandLength;
      while (request.length >= offset + 4) {
        const length = request.readUInt32BE(offset);
        if (length === 0) {
          socket.end(`stream: ${verdict}\0`);
          return;
        }
        if (request.length < offset + 4 + length) return;
        offset += 4 + length;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_TEST_PORT");
  return address.port;
}

function scanner(port: number): ClamAvMalwareScanner {
  return new ClamAvMalwareScanner(storage, {
    host: "127.0.0.1",
    port,
    timeoutMs: 1000,
    maxBytes: 1024,
    downloadUrlTtlSeconds: 60,
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("ClamAV malware scanner", () => {
  it("checks daemon health and accepts only a clean streamed object", async () => {
    const port = await fakeClamd("OK");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(scanner(port).health()).resolves.toBe(true);
    await expect(scanner(port).scan(metadata)).resolves.toEqual({ safe: true });
  });

  it("rejects a malware verdict without exposing the signature", async () => {
    const port = await fakeClamd("Win.Test.EICAR_HDB-1 FOUND");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(scanner(port).scan(metadata)).resolves.toEqual({
      safe: false,
      reason: "malware_detected",
    });
  });

  it("fails closed when scanned bytes differ from verified storage metadata", async () => {
    const port = await fakeClamd("OK");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(Buffer.from("changed contents"))),
    );
    await expect(scanner(port).scan(metadata)).resolves.toEqual({
      safe: false,
      reason: "scanner_integrity_mismatch",
    });
  });
});
