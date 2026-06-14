// ════════════════════════════════════════════════════════════════════════════
// 📡 API клиент для YUKI Worker
//
// Все запросы идут на тот же домен (/api/*). Worker сам разруливает.
// Если API недоступен (билд без worker'а или локально) — функции вернут null,
// и фронт молча упадёт на localStorage-фоллбэк.
// ════════════════════════════════════════════════════════════════════════════

export type OrderStatus = "pending" | "completed" | "failed";

export type ApiOrder = {
  id: number;
  createdAt: number;
  username: string;
  items: { title: string; tariffTitle: string; qty: number; price: number }[];
  total: number;
  method: string;
  cryptoKind?: string;
  status: OrderStatus;
};

const API_BASE = "/api";

function authHeaders(username: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-yuki-user": username || "",
  };
}

/** Получить заказы. Если admin=true — придут все, иначе — только текущего юзера. */
export async function fetchOrders(username: string, admin = false): Promise<ApiOrder[] | null> {
  try {
    const qs = admin ? "?admin=1" : "";
    const r = await fetch(`${API_BASE}/orders${qs}`, {
      headers: authHeaders(username),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { orders?: ApiOrder[] };
    return data.orders ?? [];
  } catch {
    return null;
  }
}

/** Создать заказ (POST). */
export async function createOrder(
  username: string,
  payload: Omit<ApiOrder, "id" | "createdAt" | "status">,
): Promise<ApiOrder | null> {
  try {
    const r = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: authHeaders(username),
      body: JSON.stringify({ ...payload, username }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { order?: ApiOrder };
    return data.order ?? null;
  } catch {
    return null;
  }
}

/** Обновить статус заказа (PATCH, только admin). */
export async function updateOrderStatus(
  adminUsername: string,
  id: number,
  status: OrderStatus,
): Promise<ApiOrder | null> {
  try {
    const r = await fetch(`${API_BASE}/orders/${id}`, {
      method: "PATCH",
      headers: authHeaders(adminUsername),
      body: JSON.stringify({ status }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { order?: ApiOrder };
    return data.order ?? null;
  } catch {
    return null;
  }
}

/** Проверка живости API. */
export async function pingApi(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}
