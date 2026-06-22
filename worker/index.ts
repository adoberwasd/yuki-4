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
  // Secret: npx wrangler secret put CRYPTOBOT_TOKEN
  CRYPTOBOT_TOKEN?: string;
}

const KV_KEY = "orders";
const CRYPTOBOT_API_BASE = "https://pay.crypt.bot/api";

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

type CryptoBotInvoice = {
  invoiceId: number;
  status: string;
  payUrl: string;
  amount?: string;
  fiat?: string;
};

function normalizeCryptoBotInvoice(raw: any): CryptoBotInvoice | null {
  if (!raw) return null;
  const payUrl = raw.bot_invoice_url || raw.mini_app_invoice_url || raw.web_app_invoice_url || raw.pay_url;
  const invoiceId = Number(raw.invoice_id);
  if (!invoiceId || !payUrl) return null;
  return {
    invoiceId,
    status: String(raw.status || "active"),
    payUrl: String(payUrl),
    amount: raw.amount ? String(raw.amount) : undefined,
    fiat: raw.fiat ? String(raw.fiat) : undefined,
  };
}

async function cryptoBotRequest(env: Env, method: string, payload: Record<string, unknown>) {
  if (!env.CRYPTOBOT_TOKEN) {
    throw new Error("CRYPTOBOT_TOKEN secret is not configured");
  }

  const response = await fetch(`${CRYPTOBOT_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Crypto-Pay-API-Token": env.CRYPTOBOT_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as any;
  if (!response.ok || !data?.ok) {
    const details =
      typeof data?.error === "object"
        ? [data.error.name, data.error.code].filter(Boolean).join(" ")
        : data?.error;
    throw new Error(details || `CryptoBot ${method} failed with HTTP ${response.status}`);
  }
  return data.result;
}

function buildInvoiceDescription(kind: string, items: OrderItem["items"] | undefined, amount: number) {
  if (kind === "topup") return `YUKI пополнение баланса на ${amount} RUB`;
  const first = items?.[0];
  if (!first) return `YUKI заказ на ${amount} RUB`;
  const tail = items && items.length > 1 ? ` + ещё ${items.length - 1}` : "";
  return `YUKI: ${first.title} (${first.tariffTitle})${tail}`.slice(0, 1024);
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

        // /api/cryptobot/invoice — создать счёт Crypto Bot (mainnet @CryptoBot)
        if (path === "/api/cryptobot/invoice" && request.method === "POST") {
          const callerUsername = request.headers.get("x-yuki-user") || "guest";
          const body = (await request.json()) as {
            amount?: number;
            kind?: "order" | "topup";
            items?: OrderItem["items"];
          };

          const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return json({ error: "bad amount" }, 400);
          }

          const kind = body.kind || "order";
          let result: unknown;
          try {
            result = await cryptoBotRequest(env, "createInvoice", {
              currency_type: "fiat",
              fiat: "RUB",
              accepted_assets: "usdt,ton,btc",
              amount: amount.toFixed(2),
              description: buildInvoiceDescription(kind, body.items, amount),
              payload: `yuki:${kind}:${callerUsername}:${Date.now()}`.slice(0, 128),
              allow_comments: false,
              allow_anonymous: false,
              expires_in: 600,
            });
          } catch (error) {
            return json(
              {
                error: "cryptobot_create_failed",
                detail: error instanceof Error ? error.message : String(error),
              },
              502,
            );
          }

          const invoice = normalizeCryptoBotInvoice(result);
          if (!invoice) return json({ error: "bad cryptobot response" }, 502);
          return json({ ok: true, invoice });
        }

        // /api/cryptobot/invoice/:id — проверить статус счёта Crypto Bot
        const cryptoInvoiceMatch = path.match(/^\/api\/cryptobot\/invoice\/(\d+)$/);
        if (cryptoInvoiceMatch && request.method === "GET") {
          let result: unknown;
          try {
            result = await cryptoBotRequest(env, "getInvoices", {
              invoice_ids: cryptoInvoiceMatch[1],
            });
          } catch (error) {
            return json(
              {
                error: "cryptobot_check_failed",
                detail: error instanceof Error ? error.message : String(error),
              },
              502,
            );
          }
          const rawInvoice = Array.isArray(result?.items)
            ? result.items[0]
            : Array.isArray(result)
              ? result[0]
              : result;
          const invoice = normalizeCryptoBotInvoice(rawInvoice);
          if (!invoice) return json({ error: "invoice not found" }, 404);
          return json({ ok: true, invoice });
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
