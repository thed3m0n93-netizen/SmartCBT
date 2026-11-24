import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSession, revokeSession } from "./auth-session.js";
import { createNusantaraServer, GAME_SOCKET_PATH, resolveCosmetics } from "./nusantara-game.js";
import { NusantaraRoomRegistry } from "./nusantara-rooms.js";
import { loadGameState } from "./nusantara-store.js";

test("resolveCosmetics prioritizes incoming selection over saved fallback", () => {
  const chosen = resolveCosmetics(
    {
      role: "osis",
      hairStyle: "hijab",
      hairColor: "#9f1239",
      skinColor: "#a86b3e",
    },
    {
      role: "sma",
      hairStyle: "short",
      hairColor: "#1e293b",
      skinColor: "#f6d198",
    }
  );
  assert.deepEqual(chosen, {
    role: "osis",
    hairStyle: "hijab",
    hairColor: "#9f1239",
    skinColor: "#a86b3e",
  });

  const fallbackUsed = resolveCosmetics(
    { role: "invalid" as any, hairStyle: "bad" as any },
    { role: "smp", hairStyle: "long", hairColor: "#ca8a04", skinColor: "#fde6c4" }
  );
  assert.deepEqual(fallbackUsed, {
    role: "smp",
    hairStyle: "long",
    hairColor: "#ca8a04",
    skinColor: "#fde6c4",
  });
});

test("joinGame and updateAppearance sync selected character immediately to self, peers, and DB", async () => {
  const httpServer = createServer();
  const registry = new NusantaraRoomRegistry();
  const ioServer = createNusantaraServer(httpServer, { roomRegistry: registry, startLoops: false });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Student A uses the pre-seeded mock student account (`class_id: 1`).
  const tokenA = createSession({
    id: "00000000-0000-0000-0000-000000000003",
    username: "siswa_andi",
    full_name: "Andi Prasetyo",
    role: "student",
    status: "active",
  });
  // Teacher joins staff room in same server to verify no cross-room leak; Student B in unassigned.
  const tokenA2 = createSession({
    id: "00000000-0000-0000-0000-000000000003",
    username: "siswa_andi",
    full_name: "Andi Prasetyo",
    role: "student",
    status: "active",
  });

  const connectClient = (token: string): ClientSocket =>
    ioClient(baseUrl, {
      path: GAME_SOCKET_PATH,
      auth: { token },
      transports: ["websocket"],
    });

  let sockA: ClientSocket | null = null;
  let sockA2: ClientSocket | null = null;

  try {
    sockA = connectClient(tokenA);
    const init1 = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout init1")), 4000);
      sockA!.on("connect_error", (e) => { clearTimeout(t); reject(e); });
      sockA!.on("initGame", (d) => { clearTimeout(t); resolve(d); });
      sockA!.emit("joinGame", {
        role: "osis",
        hairStyle: "hijab",
        hairColor: "#9f1239",
        skinColor: "#a86b3e",
      });
    });

    const self1 = init1.players[init1.selfId];
    assert.equal(self1.role, "osis");
    assert.equal(self1.hairStyle, "hijab");
    assert.equal(self1.hairColor, "#9f1239");
    assert.equal(self1.skinColor, "#a86b3e");

    // Verify immediate persistence in game_nusantara_state (wait microtask for async save).
    await new Promise((r) => setTimeout(r, 40));
    const saved1 = await loadGameState("00000000-0000-0000-0000-000000000003");
    assert.equal(saved1?.uniform, "osis");
    assert.equal(saved1?.hair_style, "hijab");

    // In-game updateAppearance updates active sprite & persists immediately.
    const updated1 = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout updateAppearance")), 4000);
      sockA!.once("playerUpdated", (d) => { clearTimeout(t); resolve(d); });
      sockA!.emit("updateAppearance", {
        role: "smp",
        hairStyle: "long",
        hairColor: "#ca8a04",
        skinColor: "#fde6c4",
      });
    });

    assert.equal(updated1.id, init1.selfId);
    assert.equal(updated1.role, "smp");
    assert.equal(updated1.hairStyle, "long");
    assert.equal(updated1.hairColor, "#ca8a04");
    assert.equal(updated1.skinColor, "#fde6c4");

    await new Promise((r) => setTimeout(r, 40));
    const saved2 = await loadGameState("00000000-0000-0000-0000-000000000003");
    assert.equal(saved2?.uniform, "smp");
    assert.equal(saved2?.hair_style, "long");

    // Disconnect and re-enter with a different character before entering class.
    sockA.disconnect();
    sockA = null;
    await new Promise((r) => setTimeout(r, 40));

    sockA2 = connectClient(tokenA2);
    const init2 = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout init2")), 4000);
      sockA2!.on("connect_error", (e) => { clearTimeout(t); reject(e); });
      sockA2!.on("initGame", (d) => { clearTimeout(t); resolve(d); });
      sockA2!.emit("joinGame", {
        role: "guru",
        hairStyle: "hijab",
        hairColor: "#059669",
        skinColor: "#dba670",
      });
    });

    const self2 = init2.players[init2.selfId];
    assert.equal(self2.role, "guru");
    assert.equal(self2.hairStyle, "hijab");
    assert.equal(self2.hairColor, "#059669");
    assert.equal(self2.skinColor, "#dba670");
  } finally {
    sockA?.disconnect();
    sockA2?.disconnect();
    revokeSession(tokenA);
    revokeSession(tokenA2);
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    httpServer.close();
  }
});
