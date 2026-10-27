/* global document */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import pg from "pg";

const root = process.cwd();
const web = "http://127.0.0.1:8787";
const api = "http://127.0.0.1:8788";
const managed = process.argv.includes("--managed");
const captureDir = resolve(
  process.env.SHOWCASE_CAPTURE_DIR ?? "tmp/showcase-captures",
);
const children = [];
const results = {
  capturedAt: new Date().toISOString(),
  routes: [],
  externalRequests: [],
  providerCalls: 0,
  unexpectedWrites: [],
  localSocialAdapter: "deterministic_local",
};
function start(command, args, environment) {
  const child = spawn(command, args, {
    cwd: root,
    env: environment,
    stdio: "ignore",
  });
  children.push(child);
  return child;
}
async function command(args, environment) {
  const child = start(process.execPath, args, environment);
  await new Promise((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) =>
      code === 0 ? yes() : no(new Error("Synthetic fixture command failed")),
    );
  });
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await globalThis.fetch(url)).ok) return;
    } catch {
      /* startup */
    }
    await delay(300);
  }
  throw new Error("Isolated application did not become ready");
}
try {
  if (managed) {
    const url = new URL(process.env.DATABASE_ADMIN_URL);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/rc_showcase_tests");
    const pool = new pg.Pool({ connectionString: url.href });
    const exists = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname='rc_showcase_demo'",
    );
    assert.equal(exists.rowCount, 0, "Refuse a pre-existing database");
    await pool.query("CREATE DATABASE rc_showcase_demo");
    await pool.end();
    url.pathname = "/rc_showcase_demo";
    const runtimeUrl = new URL(process.env.DATABASE_URL);
    runtimeUrl.pathname = "/rc_showcase_demo";
    const authUrl = new URL(process.env.DATABASE_AUTH_URL);
    authUrl.pathname = "/rc_showcase_demo";
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_ADMIN_URL: url.href,
      DATABASE_URL: runtimeUrl.href,
      DATABASE_AUTH_URL: authUrl.href,
      DATABASE_RUNTIME_PASSWORD: process.env.DATABASE_RUNTIME_PASSWORD,
      DATABASE_AUTH_PASSWORD: process.env.DATABASE_AUTH_PASSWORD,
      NODE_ENV: "development",
      DEPLOYMENT_ENV: "local",
      API_HOST: "127.0.0.1",
      API_PORT: "8788",
      PUBLIC_WEB_ORIGIN: web,
      PUBLIC_API_ORIGIN: api,
      PUBLIC_API_URL: api,
      TRUSTED_PUBLIC_HOSTS: "127.0.0.1",
      LOCAL_DEMO_MODE: "true",
      SESSION_COOKIE_SECURE: "false",
      IDENTITY_ADAPTER: "unconfigured",
      OBJECT_STORAGE_MODE: "local",
      LOCAL_STORAGE_HOST: "127.0.0.1",
      LOCAL_STORAGE_PORT: "8789",
      LOCAL_STORAGE_ROOT: resolve("tmp/showcase-objects"),
      LOCAL_STORAGE_BASE_URL: "http://127.0.0.1:8789",
      LOCAL_STORAGE_SIGNING_SECRET: randomBytes(32).toString("hex"),
      MEDIA_SCANNER: "deterministic_local",
      SECRET_PROVIDER_MODE: "local_memory",
      SOCIAL_PROVIDER_MODE: "deterministic_local",
      SOCIAL_OAUTH_STATE_SECRET: randomBytes(32).toString("hex"),
      EXPECTED_MIGRATION_COUNT: "44",
      NODE_OPTIONS: "--import=" + resolve("scripts/showcase-offline.mjs"),
    };
    await command(["packages/database/dist/cli.js", "migrate"], env);
    await command(["--import", "tsx", "scripts/prepare-local-demo.ts"], env);
    start(process.execPath, ["apps/storage/dist/server.js"], env);
    start(process.execPath, ["apps/api/dist/server.js"], env);
    start(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "apps/web",
        "--hostname",
        "127.0.0.1",
        "--port",
        "8787",
      ],
      env,
    );
  }
  await ready(api + "/health/ready");
  await ready(web + "/sq/showcase");
  results.productionBuildVerified = (
    await readFile("apps/web/.next/BUILD_ID", "utf8")
  ).trim();
  results.runtime =
    "Local development web server; production BFF HTTPS policy is unchanged";
  await mkdir(captureDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      locale: "sq-AL",
      serviceWorkers: "block",
    });
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        !(url.origin === api && url.pathname === "/auth/local-demo")
      )
        results.unexpectedWrites.push(url.pathname);
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        ["127.0.0.1", "localhost"].includes(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
      )
        return route.continue();
      results.externalRequests.push(url.hostname);
      return route.abort();
    });
    const anonymous = await context.request.get(
      web + "/api/dashboard/overview",
    );
    assert.equal(anonymous.status(), 401, "Anonymous dashboard must be denied");
    results.anonymousDashboardStatus = anonymous.status();
    const page = await context.newPage();
    page.on("websocket", (socket) => {
      const host = new URL(socket.url()).hostname;
      if (!["127.0.0.1", "localhost"].includes(host))
        results.externalRequests.push(host);
    });
    const token = (
      await readFile(resolve("tmp/local-demo-token"), "utf8")
    ).trim();
    await page.goto(api + "/auth/local-demo");
    await page.getByLabel("One-time local token").fill(token);
    await page.getByRole("button", { name: "Enter demo securely" }).click();
    try {
      await page.waitForURL(web + "/sq/showcase", { timeout: 30000 });
    } catch {
      const location = new URL(page.url());
      throw new Error(
        "Demo navigation failed: " +
          location.origin +
          location.pathname +
          " / " +
          (await page.locator("body").innerText()).slice(0, 600),
      );
    }
    await page
      .getByText("Aurora Media Newsroom — Demo", { exact: false })
      .first()
      .waitFor({ timeout: 30000 });
    const fresh = await browser.newContext();
    const replay = await fresh.request.post(api + "/auth/local-demo", {
      form: { token },
      maxRedirects: 0,
    });
    assert.equal(
      replay.status(),
      403,
      "Used token must not create a new session",
    );
    results.usedTokenReplayStatus = replay.status();
    await fresh.close();
    const overview = await page.request.get(web + "/api/dashboard/overview");
    assert.equal(overview.status(), 200);
    const state = await overview.json();
    assert.ok(JSON.stringify(state).includes("Aurora"));
    for (const [name, path] of [
      ["showcase", "/sq/showcase"],
      ["newsroom", "/sq/research"],
      ["content", "/sq/content"],
      ["composer", "/sq/social/composer"],
      ["review", "/sq/social/review"],
      ["calendar", "/sq/social/calendar"],
      ["preflight", "/sq/social/preflight"],
      ["people", "/sq/people"],
      ["workboard", "/sq/workzone/board"],
    ]) {
      const endpoint =
        name === "newsroom"
          ? "/api/research/cases"
          : name === "content"
            ? "/api/content-items"
            : name === "people"
              ? "/api/memberships"
              : name === "workboard"
                ? "/api/workzone/stories"
                : name === "showcase"
                  ? "/api/dashboard/overview"
                  : "/api/social/studio";
      const loaded = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === endpoint &&
          response.request().method() === "GET",
      );
      await page.goto(web + path);
      const response = await loaded;
      assert.equal(
        response.status(),
        200,
        "Authenticated read failed: " + endpoint,
      );
      await response.finished();
      await page.locator("main").first().waitFor();
      await page.getByRole("note").waitFor();
      await page.waitForFunction(
        () =>
          !/Po ngarkohet|Duke ngarkuar|Duke u ngarkuar|Po kontrollohen/i.test(
            document.body.innerText,
          ),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await delay(200);
      const text = await page.locator("body").innerText();
      assert.ok(
        !/SECRET_ID|access_token/i.test(text),
        "Private content in visible UI",
      );
      assert.ok(!text.includes("Application error:"));
      assert.ok(
        !/nuk është i disponueshëm|nuk janë të disponueshme|nuk mund të ngarko/i.test(
          text,
        ),
        "Unavailable UI on " + path,
      );
      await page.screenshot({
        path: resolve(captureDir, name + ".png"),
        fullPage: false,
      });
      results.routes.push(path);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(web + "/sq/showcase");
    await page
      .getByText("Aurora Media Newsroom — Demo", { exact: false })
      .first()
      .waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({
      path: resolve(captureDir, "mobile-showcase.png"),
      fullPage: false,
    });
    assert.deepEqual(
      results.externalRequests,
      [],
      "Browser attempted external requests",
    );
    assert.deepEqual(
      results.unexpectedWrites,
      [],
      "Capture attempted a non-authentication write",
    );
    await context.close();
  } finally {
    await browser.close();
  }
  await writeFile(
    resolve(captureDir, "acceptance.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Showcase browser acceptance passed: " +
      results.routes.length +
      " routes, mobile capture, no external requests.",
  );
} finally {
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
}
