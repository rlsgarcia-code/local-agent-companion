// Unit tests use in-memory transports or temporary loopback servers. They must
// never reach a configured personal provider when a test double becomes stale.
const net = require("node:net");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === "object" ? first :
    typeof first === "number" ? { port: first, host: typeof args[1] === "string" ? args[1] : "localhost" } : {};
  if (options.port !== undefined) {
    const host = String(options.host ?? options.hostname ?? "localhost").toLowerCase();
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || [11434, 8788].includes(Number(options.port))) {
      const error = new Error("Unit tests cannot connect to live providers or external hosts; install an explicit test transport.");
      error.code = "UNIT_TEST_LIVE_NETWORK_BLOCKED";
      throw error;
    }
  }
  return Reflect.apply(connect, this, args);
};
