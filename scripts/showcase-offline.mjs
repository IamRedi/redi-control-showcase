/** Evaluation-only preload. No provider credential or external network route. */
import net from "node:net";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { URL } from "node:url";

const local = (host) =>
  !host ||
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(host).toLowerCase(),
  );
function check(host) {
  if (!local(host))
    throw new Error("SHOWCASE_OFFLINE: external connections are disabled");
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") check(first.host ?? first.hostname);
  else if (typeof args[1] === "string") check(args[1]);
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  check(hostname);
  return lookup.call(this, hostname, ...rest);
};
const fetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  check(url.hostname);
  return fetch(input, init);
};
syncBuiltinESMExports();
