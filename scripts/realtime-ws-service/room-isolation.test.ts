import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createIoServer } from "./server";

// Integration coverage for the real-time layer's two hard safety
// requirements — "multiple agents for the same company both get notified"
// and "company isolation is never crossed" — plus the new resync broadcast
// this fix adds. Uses a REAL ephemeral HTTP server and REAL socket.io-client
// connections (no mocks for the socket layer itself), the same technique
// server.ts's actual production code path uses, just bound to a random port
// and a disposable test secret instead of the real Railway service.

const SECRET = "test-secret-at-least-32-bytes-long-for-hs256";
const key = new TextEncoder().encode(SECRET);

function mintToken(companyIds: string[], sub = "user-1") {
  return new SignJWT({ companyIds, roleKey: "MANAGER" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("300s")
    .sign(key);
}

async function startTestServer() {
  const httpServer = createServer();
  const io = createIoServer({ httpServer, wsAuthSecret: SECRET, crmBaseUrl: "http://localhost" });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    io,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

async function connectClient(url: string, token: string | undefined): Promise<ClientSocket> {
  const socket = ioClient(url, {
    auth: (cb) => cb(token !== undefined ? { token } : {}),
    reconnection: false,
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e) => reject(e));
  });
  return socket;
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function neverReceives(socket: ClientSocket, event: string, waitMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received "${event}"`));
    });
  });
}

test("room isolation: two agents authorized for the SAME company both receive an event emitted to that company's room", async () => {
  const server = await startTestServer();
  try {
    const tokenA = await mintToken(["company-A"], "agent-1");
    const tokenB = await mintToken(["company-A"], "agent-2");
    const clientA = await connectClient(server.url, tokenA);
    const clientB = await connectClient(server.url, tokenB);

    const receivedA = waitForEvent<{ conversationId: string }>(clientA, "social:new-message");
    const receivedB = waitForEvent<{ conversationId: string }>(clientB, "social:new-message");

    server.io.to("company:company-A").emit("social:new-message", { conversationId: "convo-1", messageId: "msg-1" });

    const [a, b] = await Promise.all([receivedA, receivedB]);
    assert.equal(a.conversationId, "convo-1");
    assert.equal(b.conversationId, "convo-1");

    clientA.close();
    clientB.close();
  } finally {
    await server.close();
  }
});

test("company isolation: a client authorized for a DIFFERENT company never receives another company's event", async () => {
  const server = await startTestServer();
  try {
    const tokenA = await mintToken(["company-A"]);
    const tokenOther = await mintToken(["company-OTHER"]);
    const clientA = await connectClient(server.url, tokenA);
    const clientOther = await connectClient(server.url, tokenOther);

    const isolationCheck = neverReceives(clientOther, "social:new-message");
    const receivedA = waitForEvent<{ conversationId: string }>(clientA, "social:new-message");

    server.io.to("company:company-A").emit("social:new-message", { conversationId: "convo-2", messageId: null });

    await receivedA;
    await isolationCheck;

    clientA.close();
    clientOther.close();
  } finally {
    await server.close();
  }
});

test("resync broadcast: reaches every connected client regardless of company, since it carries no company-specific data", async () => {
  const server = await startTestServer();
  try {
    const clientA = await connectClient(server.url, await mintToken(["company-A"]));
    const clientB = await connectClient(server.url, await mintToken(["company-B"]));

    const receivedA = waitForEvent(clientA, "social:resync");
    const receivedB = waitForEvent(clientB, "social:resync");

    server.io.emit("social:resync");

    await Promise.all([receivedA, receivedB]);

    clientA.close();
    clientB.close();
  } finally {
    await server.close();
  }
});

test("authentication: a connection with no token is rejected, never joins any room", async () => {
  const server = await startTestServer();
  try {
    await assert.rejects(() => connectClient(server.url, undefined));
  } finally {
    await server.close();
  }
});

test("authentication: a connection with an invalid/tampered token is rejected", async () => {
  const server = await startTestServer();
  try {
    await assert.rejects(() => connectClient(server.url, "not-a-real-token"));
  } finally {
    await server.close();
  }
});
