import test from "node:test";
import assert from "node:assert/strict";
import worker, { PublicChatRoom } from "../src/index.js";

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
}

function makeRoom() {
  const storage = new MemoryStorage();
  return {
    room: new PublicChatRoom({ storage }, {}),
    storage
  };
}

function chatRequest(method, body, userId = "buyer-google-sub", role = "member", path = "/messages") {
  return new Request("https://room.internal" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Chat-User-Id": userId,
      "X-Chat-Role": role
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("rechaza llamadas internas sin identidad verificada", async () => {
  const { room } = makeRoom();
  const response = await room.fetch(new Request("https://room.internal/messages"));
  assert.equal(response.status, 401);
});

test("una sala autorizada devuelve una lista vacía y el permiso de moderación", async () => {
  const { room } = makeRoom();
  const member = await room.fetch(chatRequest("GET", undefined, "buyer-1", "member"));
  const memberBody = await member.json();
  assert.equal(member.status, 200);
  assert.deepEqual(memberBody.messages, []);
  assert.equal(memberBody.canModerate, false);

  const admin = await room.fetch(chatRequest("GET", undefined, "owner-1", "admin"));
  const adminBody = await admin.json();
  assert.equal(admin.status, 200);
  assert.equal(adminBody.canModerate, true);
});

test("guarda mensajes, conserva la identidad privada y no expone el ID Google", async () => {
  const { room, storage } = makeRoom();
  const sent = await room.fetch(chatRequest("POST", {
    name: "Damián",
    text: "¡Hola a todos! ⚽🔥"
  }, "buyer-google-sub"));
  const sentBody = await sent.json();

  assert.equal(sent.status, 201);
  assert.equal(sentBody.message.name, "Damián");
  assert.equal(sentBody.message.text, "¡Hola a todos! ⚽🔥");
  assert.equal(sentBody.message.isMine, true);
  assert.ok(sentBody.message.id);
  assert.ok(sentBody.message.createdAt);
  assert.equal(Object.hasOwn(sentBody.message, "authorId"), false);

  const stored = await storage.get("messages");
  assert.equal(stored[0].authorId, "buyer-google-sub");

  const listed = await room.fetch(chatRequest("GET", undefined, "another-buyer"));
  const listedBody = await listed.json();
  assert.equal(listedBody.messages.length, 1);
  assert.equal(listedBody.messages[0].isMine, false);
  assert.equal(Object.hasOwn(listedBody.messages[0], "authorId"), false);
});

test("el alias queda asociado a la cuenta y no se puede suplantar cambiándolo", async () => {
  const { room } = makeRoom();
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow();
    const first = await room.fetch(chatRequest("POST", {
      name: "JugadorUno",
      text: "Primer mensaje"
    }, "buyer-unique"));
    Date.now = () => originalNow() + 3000;
    const second = await room.fetch(chatRequest("POST", {
      name: "Administrador",
      text: "Segundo mensaje"
    }, "buyer-unique"));

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((await second.json()).message.name, "JugadorUno");
  } finally {
    Date.now = originalNow;
  }
});

test("limita mensajes repetidos por cuenta, no por dirección IP", async () => {
  const { room } = makeRoom();
  const first = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "Primer mensaje"
  }, "buyer-rate-1"));
  const second = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "Segundo mensaje"
  }, "buyer-rate-1"));
  const otherBuyer = await room.fetch(chatRequest("POST", {
    name: "Otra persona",
    text: "Mensaje de otra cuenta"
  }, "buyer-rate-2"));

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("Retry-After"), "2");
  assert.equal(otherBuyer.status, 201);
});

test("rechaza alias, mensajes vacíos y mensajes demasiado largos", async () => {
  const { room } = makeRoom();
  const shortName = await room.fetch(chatRequest("POST", {
    name: "A",
    text: "Hola"
  }, "buyer-short-name"));
  const emptyText = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "   "
  }, "buyer-empty-text"));
  const longText = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "x".repeat(501)
  }, "buyer-long-text"));

  assert.equal(shortName.status, 400);
  assert.equal(emptyText.status, 400);
  assert.equal(longText.status, 400);
});

test("solo el administrador puede retirar un mensaje y la eliminación es visible", async () => {
  const { room } = makeRoom();
  const sent = await room.fetch(chatRequest("POST", {
    name: "Comprador",
    text: "Mensaje que requiere moderación"
  }, "buyer-to-moderate"));
  const id = (await sent.json()).message.id;

  const denied = await room.fetch(chatRequest(
    "DELETE", undefined, "buyer-to-moderate", "member", "/messages/" + id
  ));
  assert.equal(denied.status, 403);

  const deleted = await room.fetch(chatRequest(
    "DELETE", undefined, "owner-1", "admin", "/messages/" + id
  ));
  assert.equal(deleted.status, 200);

  const listed = await room.fetch(chatRequest("GET", undefined, "buyer-2"));
  const message = (await listed.json()).messages[0];
  assert.equal(message.deleted, true);
  assert.equal(message.text, "Este mensaje fue eliminado por moderación.");
  assert.equal(message.isMine, false);
});

test("el límite conserva solo los últimos 120 mensajes", async () => {
  const { room, storage } = makeRoom();
  const seed = Array.from({ length: 125 }, (_, index) => ({
    id: "seed-" + index,
    name: "Comprador",
    text: "Mensaje " + index,
    createdAt: new Date(1700000000000 + index).toISOString(),
    authorId: "buyer-seed",
    deleted: false
  }));
  await storage.put("messages", seed);

  // Una publicación nueva normaliza el historial al límite del producto.
  const sent = await room.fetch(chatRequest("POST", {
    name: "Comprador",
    text: "Nuevo mensaje"
  }, "buyer-limit"));
  assert.equal(sent.status, 201);
  const messages = await storage.get("messages");
  assert.equal(messages.length, 120);
  assert.equal(messages.at(-1).text, "Nuevo mensaje");
});

test("el Worker no enruta el Chat sin un token Google", async () => {
  let roomCalled = false;
  const response = await worker.fetch(
    new Request("https://worker.example/api/chat/messages"),
    {
      GOOGLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com",
      PUBLIC_CHAT_ROOM: {
        idFromName: () => "public-room",
        get: () => ({
          fetch: async () => {
            roomCalled = true;
            return new Response(JSON.stringify({ messages: [] }), { status: 200 });
          }
        })
      }
    }
  );
  assert.equal(response.status, 401);
  assert.equal(roomCalled, false);
});
