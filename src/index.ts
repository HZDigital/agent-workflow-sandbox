import { createApp } from "./server.js";

const port = Number(process.env["PORT"] ?? 3000);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT must be an integer between 0 and 65535, got "${process.env["PORT"]}".`);
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
  });
}
