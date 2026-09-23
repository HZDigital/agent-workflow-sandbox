import { createApp } from "./server.js";

const rawPort = process.env["PORT"];
// `Number("")` is 0, which would bind a random port instead of complaining.
const port = rawPort === undefined || rawPort.trim() === "" ? 3000 : Number(rawPort);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT must be an integer between 0 and 65535, got "${rawPort}".`);
  process.exit(1);
}

const { server } = createApp();

server.listen(port, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  console.log(`agent-workflow-sandbox listening on http://localhost:${boundPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Without this, close() waits for every keep-alive connection to go idle
    // and Ctrl-C appears to hang — the default signal exit is gone by now.
    server.closeAllConnections();
  });
}
