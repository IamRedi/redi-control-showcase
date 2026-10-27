import { buildLocalObjectStorageServer } from "@redi-control/media-social";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const port = Number(process.env.LOCAL_STORAGE_PORT ?? 9000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("LOCAL_STORAGE_PORT is invalid");
const maxObjectBytes = Number(
  process.env.MEDIA_MAX_OBJECT_BYTES ?? 536_870_912,
);
if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1)
  throw new Error("MEDIA_MAX_OBJECT_BYTES is invalid");

const app = buildLocalObjectStorageServer({
  rootDirectory: required("LOCAL_STORAGE_ROOT"),
  signingSecret: required("LOCAL_STORAGE_SIGNING_SECRET"),
  maxObjectBytes,
});

try {
  await app.listen({
    host: process.env.LOCAL_STORAGE_HOST ?? "127.0.0.1",
    port,
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close());
}
