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

function chatRequest(method, body, ip = "192.0.2.1") {
  return new Request("https://room.internal/messages", {
    method,
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("una sala vacía devuelve una lista de mensajes vacía", async () => {
  const { room } = makeRoom();
  const response = await room.fetch(chatRequest("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, []);
});

test("guarda mensajes y los devuelve en consultas posteriores", async () => {
  const { room } = makeRoom();
  const sent = await room.fetch(chatRequest("POST", {
    name: "Damian",
    text: "¡Hola a todos!",
    language: "en"
  }));
  const sentBody = await sent.json();

  assert.equal(sent.status, 201);
  assert.equal(sentBody.message.name, "Damian");
  assert.equal(sentBody.message.text, "¡Hola a todos!");
  assert.equal(sentBody.message.language, "en");
  assert.ok(sentBody.message.id);
  assert.ok(sentBody.message.createdAt);

  const listed = await room.fetch(chatRequest("GET"));
  const messages = (await listed.json()).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, sentBody.message.id);
});

test("rechaza alias y mensajes vacíos o demasiado largos", async () => {
  const { room } = makeRoom();
  const shortName = await room.fetch(chatRequest("POST", {
    name: "A",
    text: "Hola"
  }, "192.0.2.2"));
  const emptyText = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "   "
  }, "192.0.2.3"));
  const longText = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "x".repeat(501)
  }, "192.0.2.4"));

  assert.equal(shortName.status, 400);
  assert.equal(emptyText.status, 400);
  assert.equal(longText.status, 400);
});

test("mantiene español por defecto para clientes antiguos y valida el idioma", async () => {
  const { room } = makeRoom();
  const legacy = await room.fetch(chatRequest("POST", {
    name: "Legacy",
    text: "Mensaje antiguo"
  }, "192.0.2.20"));
  const invalid = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "Hola",
    language: "xx"
  }, "192.0.2.21"));
  const body = await legacy.json();
  assert.equal(legacy.status, 201);
  assert.equal(body.message.language, "es");
  assert.equal(invalid.status, 400);
});

test("limita mensajes repetidos desde la misma dirección", async () => {
  const { room } = makeRoom();
  const first = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "Primer mensaje"
  }, "192.0.2.5"));
  const second = await room.fetch(chatRequest("POST", {
    name: "Persona",
    text: "Segundo mensaje"
  }, "192.0.2.5"));

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("Retry-After"), "2");
});

test("el Worker enruta GET y POST a la misma sala pública", async () => {
  const { room } = makeRoom();
  const calls = [];
  const binding = {
    idFromName(name) {
      assert.equal(name, "deporte-total-360-public");
      return "public-room-id";
    },
    get(id) {
      assert.equal(id, "public-room-id");
      return {
        fetch(request) {
          calls.push(request.method);
          return room.fetch(request);
        }
      };
    }
  };

  const get = await worker.fetch(
    new Request("https://worker.example/api/chat/messages"),
    { PUBLIC_CHAT_ROOM: binding }
  );
  const post = await worker.fetch(
    new Request("https://worker.example/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Invitado", text: "Desde la APK" })
    }),
    { PUBLIC_CHAT_ROOM: binding }
  );

  assert.equal(get.status, 200);
  assert.equal(post.status, 201);
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("POST fuera de la ruta del chat sigue prohibido", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health", { method: "POST" }),
    {}
  );
  assert.equal(response.status, 405);
});
