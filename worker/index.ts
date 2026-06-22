// ════════════════════════════════════════════════════════════════════════════
// 🚀 YUKI MINI APP — Cloudflare Worker (API + статика)
//
// Что делает:
//   • GET  /api/orders              → список ВСЕХ заказов (для админа)
//   • GET  /api/orders?u=username   → только заказы конкретного юзера
//   • POST /api/orders              → создать новый заказ
//   • PATCH /api/orders/:id         → обновить статус (admin)
//   • GET  /api/health              → проверка живости
//   • остальное → статика из ASSETS (фронтенд React)
//
// Данные хранятся в Cloudflare KV под одним ключом "orders" (JSON-массив).
// ════════════════════════════════════════════════════════════════════════════

type OrderStatus = "pending" | "completed" | "failed";

type OrderItem = {
  id: number;
  createdAt: number;
  username: string;
  items: { title: string; tariffTitle: string; qty: number; price: number }[];
  total: number;
  method: string;
  cryptoKind?: string;
  status: OrderStatus;
  kind?: "order" | "topup";
};

interface Env {
  // KV namespace (привязка в wrangler.jsonc)
  YUKI_KV: KVNamespace;
  // Статика (привязка в wrangler.jsonc через assets)
  ASSETS: Fetcher;
}

const KV_KEY = "orders";

// Список админов (синхронизирован с фронтом)
const ADMIN_USERNAMES = ["samarskiyyyy", "ceoclott"];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });

async function readOrders(env: Env): Promise<OrderItem[]> {
  const raw = await env.YUKI_KV.get(KV_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OrderItem[];
  } catch {
    return [];
  }
}

async function writeOrders(env: Env, orders: OrderItem[]) {
  await env.YUKI_KV.put(KV_KEY, JSON.stringify(orders));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type, x-yuki-user",
        },
      });
    }

    // ─── API ─────────────────────────────────────────────────────────────
    if (path.startsWith("/api/")) {
      try {
        // /api/health
        if (path === "/api/health") {
          return json({ ok: true, time: Date.now() });
        }

        // /api/orders
        if (path === "/api/orders") {
          if (request.method === "GET") {
            const u = url.searchParams.get("u")?.toLowerCase() || "";
            const isAdminQuery = url.searchParams.get("admin") === "1";
            const callerUsername = (request.headers.get("x-yuki-user") || "").toLowerCase();
            const isAdmin = ADMIN_USERNAMES.includes(callerUsername);

            const all = await readOrders(env);
            // Админ видит ВСЁ, обычный юзер — только свои
            if (isAdmin && isAdminQuery) {
              return json({ orders: all });
            }
            const target = u || callerUsername;
            const filtered = all.filter(
              (o) => (o.username || "").toLowerCase() === target,
            );
            return json({ orders: filtered });
          }

          if (request.method === "POST") {
            const body = (await request.json()) as Partial<OrderItem>;
            if (!body || !body.username || !body.items || !body.total) {
              return json({ error: "bad request" }, 400);
            }
            const newOrder: OrderItem = {
              id: Date.now(),
              createdAt: Date.now(),
              username: body.username,
              items: body.items as OrderItem["items"],
              total: body.total,
              method: body.method || "unknown",
              cryptoKind: body.cryptoKind,
              status: "pending",
              kind: body.kind || "order",
            };
            const all = await readOrders(env);
            all.unshift(newOrder);
            // Ограничим до 500 последних, чтобы KV не пухло
            if (all.length > 500) all.length = 500;
            await writeOrders(env, all);
            return json({ ok: true, order: newOrder });
          }

          if (request.method === "DELETE") {
            const callerUsername = (request.headers.get("x-yuki-user") || "").toLowerCase();
            if (!ADMIN_USERNAMES.includes(callerUsername)) {
              return json({ error: "forbidden" }, 403);
            }
            const all = await readOrders(env);
            await writeOrders(env, []);
            return json({ ok: true, removed: all.length, orders: [] });
          }
        }

        // /api/orders/test-users (DELETE — admin)
        if (path === "/api/orders/test-users" && request.method === "DELETE") {
          const callerUsername = (request.headers.get("x-yuki-user") || "").toLowerCase();
          if (!ADMIN_USERNAMES.includes(callerUsername)) {
            return json({ error: "forbidden" }, 403);
          }
          const all = await readOrders(env);
          const next = all.filter(
            (o) => !ADMIN_USERNAMES.includes((o.username || "").toLowerCase()),
          );
          await writeOrders(env, next);
          return json({ ok: true, removed: all.length - next.length, orders: next });
        }

        // /api/orders/:id (PATCH — admin)
        const match = path.match(/^\/api\/orders\/(\d+)$/);
        if (match) {
          const id = Number(match[1]);
          if (request.method === "PATCH") {
            const callerUsername = (request.headers.get("x-yuki-user") || "").toLowerCase();
            if (!ADMIN_USERNAMES.includes(callerUsername)) {
              return json({ error: "forbidden" }, 403);
            }
            const body = (await request.json()) as { status?: OrderStatus };
            if (!body.status || !["pending", "completed", "failed"].includes(body.status)) {
              return json({ error: "bad status" }, 400);
            }
            const all = await readOrders(env);
            const idx = all.findIndex((o) => o.id === id);
            if (idx === -1) return json({ error: "not found" }, 404);
            all[idx] = { ...all[idx], status: body.status };
            await writeOrders(env, all);
            return json({ ok: true, order: all[idx] });
          }
        }

        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // ─── СТАТИКА ─────────────────────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
