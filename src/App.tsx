import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createOrder as apiCreateOrder,
  fetchOrders as apiFetchOrders,
  pingApi,
  updateOrderStatus as apiUpdateOrderStatus,
} from "./api";

// ════════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ════════════════════════════════════════════════════════════════════════════
type TabId = "catalog" | "cart" | "orders" | "balance" | "profile" | "admin";
type DurationId = "trial" | "month" | "extended" | "lifetime";
type CategoryId =
  | "all"
  | "standoff2"
  | "cs2"
  | "valorant"
  | "brawlstars"
  | "ios"
  | "telegram"
  | "microsoft"
  | "apple"
  | "google";
type Platform = "iOS" | "Desktop" | "Android" | "iOS/Android";

type Tariff = { id: DurationId; title: string; subtitle: string; price: number };

type Product = {
  id: string;
  category: Exclude<CategoryId, "all">;
  title: string;
  short: string;
  description: string;
  image: string;
  video?: string;
  note?: string;
  infoUrl?: string;
  platform: Platform;
  features: string[];
  tariffs: Tariff[];
};

type CartItem = {
  id: number;
  productId: string;
  title: string;
  category: string;
  tariffId: DurationId;
  tariffTitle: string;
  price: number;
  qty: number;
};

type OrderStatus = "pending" | "completed" | "failed";

type OrderItem = {
  id: number;
  createdAt: number;
  username: string;
  items: { title: string; tariffTitle: string; qty: number; price: number }[];
  total: number;
  method: PayMethodId;
  cryptoKind?: CryptoKindId;
  status: OrderStatus;
  kind?: "purchase" | "topup"; // тип заказа: покупка товара или пополнение баланса
};

type TelegramUser = { first_name?: string; username?: string; photo_url?: string };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy") => void;
          notificationOccurred?: (type: "success" | "warning" | "error") => void;
        };
        initDataUnsafe?: { user?: TelegramUser };
      };
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ════════════════════════════════════════════════════════════════════════════
const money = new Intl.NumberFormat("ru-RU");
const formatPrice = (value: number) => `${money.format(value)} ₽`;

const STARS_TO_RUB = 1.6;

// Юзеры с предустановленным балансом (отладка/подарки)
const DEBUG_BALANCES: { username: string; balance: number; greeting?: string }[] = [
  { username: "samarskiyyyy", balance: 1_000_000 },
  {
    username: "ceoclott",
    balance: 1_200_000,
    greeting: "Тебе лямчик двести чисто вот братанам закидываю, обла посос 🤝",
  },
];

// Список админов (с доступом к админ-панели)
const ADMIN_USERNAMES = ["samarskiyyyy", "ceoclott"];

// 💬 Ссылка на поддержку (вставь сюда @username или ссылку)
const SUPPORT_URL = ""; // ← пример: "https://t.me/yuki_support"

// 💳 Реквизиты для оплаты (на странице оплаты)
const PAYMENT_CRYPTO_ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"; // ← пример, замени на свой
const PAYMENT_PHONE_NUMBER = "+7 (900) 000-00-00"; // ← пример, замени на свой
const PAYMENT_TIMER_SECONDS = 10 * 60; // 10 минут

// ════════════════════════════════════════════════════════════════════════════
// КАТЕГОРИИ
// Чтобы добавить кастомную PNG-иконку к категории — пропиши ссылку в iconUrl.
// ════════════════════════════════════════════════════════════════════════════
const categories: {
  id: CategoryId;
  title: string;
  short: string;
  icon: string; // эмодзи fallback
  iconUrl: string; // ← вставь сюда прямую ссылку на PNG иконку
}[] = [
  { id: "all", title: "YUKI Soft", short: "Весь софт", icon: "✦", iconUrl: "" },
  { id: "standoff2", title: "Standoff 2", short: "Игровой софт", icon: "🎯", iconUrl: "" },
  { id: "cs2", title: "CS2", short: "Игровой софт", icon: "⚡", iconUrl: "" },
  { id: "valorant", title: "Valorant", short: "Игровой софт", icon: "💎", iconUrl: "" },
  { id: "brawlstars", title: "Brawl Stars", short: "Мобильный софт", icon: "🌟", iconUrl: "" },
  { id: "ios", title: "Сертификаты iOS", short: "Подписи приложений", icon: "📱", iconUrl: "" },
  { id: "telegram", title: "Telegram", short: "Сервисы Telegram", icon: "✈️", iconUrl: "" },
  { id: "microsoft", title: "Microsoft", short: "Лицензии", icon: "🪟", iconUrl: "" },
  { id: "apple", title: "Apple", short: "Apple-сервисы", icon: "🍏", iconUrl: "" },
  { id: "google", title: "Google", short: "Google-сервисы", icon: "🔎", iconUrl: "" },
];

// ════════════════════════════════════════════════════════════════════════════
// КАТАЛОГ ТОВАРОВ
// ════════════════════════════════════════════════════════════════════════════
const products: Product[] = [
  {
    id: "s2-yuki-ipa",
    category: "standoff2",
    title: "YUKI iPA",
    short: "Приватный софт для Standoff 2",
    description:
      "Фирменный YUKI iPA под Standoff 2: стабильная сборка, аккуратная работа и регулярные обновления под актуальные версии игры.",
    image: "",
    video: "", // ← вставь сюда ссылку на MP4
    note: "После покупки вы получите iPA файл + ключ софта. Также вы получите всю необходимую информацию по поводу обновлений.",
    infoUrl: "",
    platform: "iOS",
    features: ["iPA сборка", "Стабильно", "Обновления", "Поддержка"],
    tariffs: [
      { id: "trial", title: "7 дней", subtitle: "Тест", price: 150 },
      { id: "month", title: "30 дней", subtitle: "Стандарт", price: 450 },
      { id: "extended", title: "60 дней", subtitle: "Продлённый", price: 650 },
      { id: "lifetime", title: "Навсегда", subtitle: "Один платёж", price: 900 },
    ],
  },
  {
    id: "cs2-wh",
    category: "cs2",
    title: "CS2 | Wallhack ESP",
    short: "Показ игроков через стены",
    description:
      "Чистый ESP для CS2 без лишних функций — только то, что нужно для уверенной игры на любом ранге.",
    image: "",
    note: "",
    infoUrl: "",
    platform: "Desktop",
    features: ["Player ESP", "Bomb info", "Safe mode", "Auto-update"],
    tariffs: [
      { id: "trial", title: "7 дней", subtitle: "Тест", price: 250 },
      { id: "month", title: "30 дней", subtitle: "Стандарт", price: 750 },
      { id: "lifetime", title: "Навсегда", subtitle: "Один платёж", price: 2500 },
    ],
  },
  {
    id: "cs2-aim",
    category: "cs2",
    title: "CS2 | Aim Assist",
    short: "Помощь при стрельбе",
    description:
      "Аккуратный Aim Assist без палева. Настройка плавности, активация по клавише, поддержка всех режимов.",
    image: "",
    note: "",
    infoUrl: "",
    platform: "Desktop",
    features: ["Smooth Aim", "Hotkey", "Settings", "Stable"],
    tariffs: [
      { id: "trial", title: "7 дней", subtitle: "Тест", price: 300 },
      { id: "month", title: "30 дней", subtitle: "Стандарт", price: 900 },
      { id: "lifetime", title: "Навсегда", subtitle: "Один платёж", price: 3000 },
    ],
  },
  {
    id: "vlr-cheat",
    category: "valorant",
    title: "Valorant | Private Cheat",
    short: "Премиум приватка",
    description:
      "Приватный софт под Valorant с продуманным интерфейсом, поддержкой 24/7 и регулярными апдейтами под патчи.",
    image: "",
    note: "",
    infoUrl: "",
    platform: "Desktop",
    features: ["ESP", "Aim", "Private build", "Поддержка"],
    tariffs: [
      { id: "trial", title: "7 дней", subtitle: "Тест", price: 400 },
      { id: "month", title: "30 дней", subtitle: "Стандарт", price: 1200 },
      { id: "lifetime", title: "Навсегда", subtitle: "Один платёж", price: 4500 },
    ],
  },
  {
    id: "bs-mod",
    category: "brawlstars",
    title: "Brawl Stars | Mod Menu",
    short: "Мод-меню с возможностями",
    description:
      "Кастомное мод-меню для Brawl Stars с расширенными функциями для приватных серверов. Простая установка.",
    image: "",
    note: "",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Unlock all", "Custom skins", "Private server", "Easy install"],
    tariffs: [
      { id: "trial", title: "7 дней", subtitle: "Тест", price: 90 },
      { id: "month", title: "30 дней", subtitle: "Стандарт", price: 290 },
      { id: "lifetime", title: "Навсегда", subtitle: "Один платёж", price: 900 },
    ],
  },
  {
    id: "ios-cert-personal",
    category: "ios",
    title: "Сертификат iOS | Personal",
    short: "Личный сертификат подписи",
    description:
      "Персональный сертификат для подписи iOS-приложений. Стабильная работа, быстрая выдача после оплаты.",
    image: "https://i.ibb.co/Y4r3Lrm0/IMG-1160.png",
    note: "",
    infoUrl: "",
    platform: "iOS",
    features: ["Личный", "Быстрая выдача", "Стабильность", "Поддержка"],
    tariffs: [
      { id: "month", title: "30 дней", subtitle: "Базовый", price: 350 },
      { id: "lifetime", title: "365 дней", subtitle: "Годовой", price: 2500 },
    ],
  },
  {
    id: "ios-cert-business",
    category: "ios",
    title: "Сертификат iOS | Business",
    short: "Корпоративная подпись",
    description:
      "Корпоративный сертификат iOS для масштабного распространения приложений. Подходит для команд и студий.",
    image: "https://i.ibb.co/Kpd1RNr4/IMG-1159.png",
    note: "",
    infoUrl: "",
    platform: "iOS",
    features: ["Enterprise", "Без лимитов", "Поддержка 24/7", "Гарантия"],
    tariffs: [
      { id: "month", title: "30 дней", subtitle: "Базовый", price: 1500 },
      { id: "lifetime", title: "365 дней", subtitle: "Годовой", price: 9900 },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// МЕТОДЫ ОПЛАТЫ
// ════════════════════════════════════════════════════════════════════════════
type PayMethodId = "sbp" | "cryptobot" | "stars" | "crypto";

type PayMethod = {
  id: PayMethodId;
  title: string;
  hint: string;
  logo: string;
  unit: "₽" | "⭐";
  accent: string;
};

const payMethods: PayMethod[] = [
  {
    id: "sbp",
    title: "Перевод",
    hint: "По номеру телефона",
    logo: "https://i.ibb.co/TM4Bk4Gb/3-DD14-F7-F-9-D57-4426-B5-B4-332-CD9-CBA1-FC.png",
    unit: "₽",
    accent: "from-emerald-500/20 to-violet-500/15",
  },
  {
    id: "cryptobot",
    title: "Crypto Bot",
    hint: "Оплата через @CryptoBot",
    logo: "https://i.ibb.co/4ZXRx9HZ/E5-DED65-E-285-C-4-FB1-BD63-6-BA15548-B92-C.png",
    unit: "₽",
    accent: "from-sky-500/20 to-violet-500/15",
  },
  {
    id: "stars",
    title: "TG Stars",
    hint: "Telegram Stars ⭐",
    logo: "https://i.ibb.co/Qv65tGLB/82483339-07-DD-4-D01-BAE3-439310-D3-A224.png",
    unit: "⭐",
    accent: "from-amber-400/20 to-fuchsia-500/15",
  },
  {
    id: "crypto",
    title: "Крипта",
    hint: "USDT / TON / BTC",
    logo: "https://i.ibb.co/DP8qdkb9/IMG-1175.png",
    unit: "₽",
    accent: "from-indigo-500/20 to-fuchsia-500/15",
  },
];

// ════════════════════════════════════════════════════════════════════════════
// КРИПТО-ВАЛЮТЫ (для метода "Крипта")
// ════════════════════════════════════════════════════════════════════════════
type CryptoKindId = "btc" | "ton" | "usdt";

type CryptoKind = {
  id: CryptoKindId;
  title: string;
  symbol: string;
  logo: string; // ← вставь сюда прямую ссылку на лого
  coingeckoId: string; // id для API курса
};

const cryptoKinds: CryptoKind[] = [
  { id: "btc", title: "Bitcoin", symbol: "BTC", logo: "", coingeckoId: "bitcoin" },
  { id: "ton", title: "Toncoin", symbol: "TON", logo: "", coingeckoId: "the-open-network" },
  { id: "usdt", title: "Tether", symbol: "USDT", logo: "", coingeckoId: "tether" },
];

// ════════════════════════════════════════════════════════════════════════════
// ИКОНКИ ПЛАТФОРМ
// ════════════════════════════════════════════════════════════════════════════
const PLATFORM_ICONS: Record<Platform, string> = {
  iOS: "https://i.ibb.co/cS7ZS0c5/IMG-1138.png",
  Desktop: "https://i.ibb.co/LzKLYc2f/IMG-1137.png",
  Android: "https://i.ibb.co/cS7ZS0c5/IMG-1138.png",
  "iOS/Android": "https://i.ibb.co/cS7ZS0c5/IMG-1138.png",
};

// ════════════════════════════════════════════════════════════════════════════
// 🛒 Иконки корзины
// CART_ICON_URL          → маленькая (нижняя навигация + кнопки "В корзину")
// CART_BIG_ICON_URL      → большая (на пустой странице корзины с пульсацией)
// Если оставить пустым — будет показан дефолтный эмодзи 🛒
// ════════════════════════════════════════════════════════════════════════════
const CART_ICON_URL = "https://i.ibb.co/Lz9rtkKw/5-E583-D59-B90-B-446-B-8037-426157-B97-B51.png";
const CART_BIG_ICON_URL = "";

// ════════════════════════════════════════════════════════════════════════════
// НАВИГАЦИЯ
// ════════════════════════════════════════════════════════════════════════════
const baseNavItems: { id: TabId; label: string; icon: string }[] = [
  { id: "catalog", label: "Каталог", icon: "◈" },
  { id: "cart", label: "Корзина", icon: "cart" },
  { id: "orders", label: "Заказы", icon: "◉" },
  { id: "balance", label: "Баланс", icon: "₽" },
  { id: "profile", label: "Профиль", icon: "◎" },
];

// ════════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ
// ════════════════════════════════════════════════════════════════════════════
function SectionCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative rounded-[28px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl ${className}`}
    >
      {children}
    </section>
  );
}

function ProductImage({ src, title }: { src: string; title: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={title}
        className="h-full w-full object-cover"
        onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/40 via-fuchsia-500/30 to-indigo-600/40 text-5xl">
      ✦
    </div>
  );
}

function CategoryIcon({ icon, iconUrl }: { icon: string; iconUrl?: string }) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-4 w-4 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
      />
    );
  }
  return <span>{icon}</span>;
}

function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  // Фиксированный контейнер 24x24 — все иконки одного размера и центрируются
  return (
    <span className="flex h-6 w-6 items-center justify-center">
      {icon === "cart" ? (
        CART_ICON_URL ? (
          <img
            src={CART_ICON_URL}
            alt=""
            className={`max-h-full max-w-full object-contain transition ${
              active ? "opacity-100" : "opacity-60"
            }`}
          />
        ) : (
          <span className="text-[18px] leading-none">🛒</span>
        )
      ) : (
        <span className="text-[18px] leading-none">{icon}</span>
      )}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: Platform }) {
  const iconUrl = PLATFORM_ICONS[platform];
  return (
    <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-violet-300/30 bg-black/55 px-3 py-1 shadow-[0_6px_22px_rgba(0,0,0,0.45)] backdrop-blur-md">
      {iconUrl && (
        <img
          src={iconUrl}
          alt={platform}
          className="h-4 w-auto object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        />
      )}
      <span className="text-[11px] font-semibold tracking-wide text-violet-50">{platform}</span>
    </span>
  );
}

// Маленький пульсирующий шарик статуса
function StatusDot({ kind }: { kind: "pending" | "completed" | "failed" }) {
  const colors = {
    pending: "bg-amber-400",
    completed: "bg-fuchsia-400",
    failed: "bg-red-400",
  };
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <span className={`absolute inset-0 animate-ping rounded-full ${colors[kind]} opacity-60`} />
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors[kind]}`} />
    </span>
  );
}

// Формат таймера 10:00
const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// ════════════════════════════════════════════════════════════════════════════
// ХУК для парсинга курсов криптовалют (CoinGecko API)
// ════════════════════════════════════════════════════════════════════════════
function useCryptoRate(coinId: string | null) {
  const [rubPerUnit, setRubPerUnit] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coinId) {
      setRubPerUnit(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=rub`)
      .then((r) => r.json())
      .then((data) => {
        const rate = data?.[coinId]?.rub;
        if (typeof rate === "number") setRubPerUnit(rate);
        else setError("Не удалось получить курс");
      })
      .catch(() => setError("Сеть недоступна"))
      .finally(() => setLoading(false));
  }, [coinId]);

  return { rubPerUnit, loading, error };
}

// ════════════════════════════════════════════════════════════════════════════
// ОСНОВНОЙ КОМПОНЕНТ
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ─── Состояние навигации ───
  const [activeTab, setActiveTab] = useState<TabId>("catalog");
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("all");
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // ─── Экраны оплаты ───
  // null = нет активного, иначе — открыт payment-flow
  const [paymentFlow, setPaymentFlow] = useState<{
    method: PayMethodId;
    amount: number; // итоговая сумма ₽
    cryptoKind?: CryptoKindId;
    stage: "crypto-choose" | "address" | "waiting" | "failed";
    orderId?: number;
    kind?: "purchase" | "topup"; // тип flow
  } | null>(null);

  // ─── Приветственное окно ───
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem("yuki_welcome_dismissed");
  });
  const [welcomeDontShow, setWelcomeDontShow] = useState(false);

  // ─── Корзина и заказы ───
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const s = window.localStorage.getItem("yuki_cart_pending");
      return s ? (JSON.parse(s) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  // ВСЕ заказы (от всех юзеров в этом браузере) — для админки
  const [orders, setOrders] = useState<OrderItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      // Сначала пробуем новый общий ключ
      const sNew = window.localStorage.getItem("yuki_all_orders");
      if (sNew) return JSON.parse(sNew) as OrderItem[];
      // Миграция со старого ключа
      const sOld = window.localStorage.getItem("yuki_orders");
      return sOld ? (JSON.parse(sOld) as OrderItem[]) : [];
    } catch {
      return [];
    }
  });

  // ─── Баланс ───
  const [balance, setBalance] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const saved = window.localStorage.getItem("yuki_balance_rub");
    if (saved !== null) {
      const p = Number(saved);
      return Number.isFinite(p) ? p : 0;
    }
    return 0;
  });

  // ─── Баланс: страница ───
  const [topUpAmount, setTopUpAmount] = useState("");
  const [selectedPayMethod, setSelectedPayMethod] = useState<PayMethodId>("sbp");

  // ─── Юзер ───
  const [user, setUser] = useState<TelegramUser>({ first_name: "YUKI user", username: "" });

  // ─── Модалка нет денег ───
  const [noFundsModal, setNoFundsModal] = useState<{ needed: number; title: string } | null>(null);

  // ─── Просмотр заказа (для завершённых) ───
  const [viewOrderId, setViewOrderId] = useState<number | null>(null);
  const [showSupport, setShowSupport] = useState(false);

  // ─── Бэкенд готов? (Worker + KV) ───
  const [apiReady, setApiReady] = useState(false);

  // ─── Модалка-подарок (для отладочных юзеров с greeting) ───
  const [giftModal, setGiftModal] = useState<{
    message: string;
    balance: number;
  } | null>(null);

  // Ref на main, чтобы скроллить наверх при смене страницы / открытии товара
  const mainRef = useRef<HTMLElement | null>(null);
  // Ключ для перерисовки контента с анимацией
  const pageKey = `${activeTab}|${openedProductId ?? ""}|${paymentFlow?.stage ?? ""}|${viewOrderId ?? ""}`;

  // Агрессивный сброс скролла — по всем возможным контейнерам (Telegram WebApp особенности)
  useEffect(() => {
    const scrollAllToTop = () => {
      if (mainRef.current) mainRef.current.scrollTop = 0;
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      document.querySelectorAll(".yuki-scroll").forEach((el) => {
        (el as HTMLElement).scrollTop = 0;
      });
    };

    // Дважды: сразу + после кадра рендера
    scrollAllToTop();
    const raf = requestAnimationFrame(() => {
      scrollAllToTop();
      requestAnimationFrame(scrollAllToTop);
    });
    return () => cancelAnimationFrame(raf);
  }, [pageKey]);

  // ─── Persist ───
  useEffect(() => {
    window.localStorage.setItem("yuki_balance_rub", String(balance));
  }, [balance]);
  useEffect(() => {
    window.localStorage.setItem("yuki_cart_pending", JSON.stringify(cart));
  }, [cart]);
  useEffect(() => {
    window.localStorage.setItem("yuki_all_orders", JSON.stringify(orders));
  }, [orders]);

  // Слушаем изменения в localStorage из других вкладок/окон —
  // если новый юзер сделал заказ в другой вкладке, у админа автообновится
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "yuki_all_orders" && e.newValue) {
        try {
          setOrders(JSON.parse(e.newValue) as OrderItem[]);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ─── Telegram WebApp init ───
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.("#0a0615");
    tg.setBackgroundColor?.("#05010d");
    const u = tg.initDataUnsafe?.user;
    if (u) {
      const next: TelegramUser = {
        first_name: u.first_name || "Пользователь YUKI",
        username: u.username || "",
        photo_url: u.photo_url,
      };
      setUser(next);

      // Спец-балансы для отладочных юзеров (одноразово, версия v2)
      const uname = (next.username || "").toLowerCase();
      const debug = DEBUG_BALANCES.find((d) => d.username.toLowerCase() === uname);
      if (debug) {
        const key = `yuki_debug_applied_v2_${debug.username}`;
        if (!window.localStorage.getItem(key)) {
          setBalance(debug.balance);
          window.localStorage.setItem(key, "1");
          if (debug.greeting) {
            setGiftModal({ message: debug.greeting, balance: debug.balance });
          }
        }
      }
    }
  }, []);

  // ─── Toast auto-hide ───
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(t);
  }, [notice]);

  const vibrate = (style: "light" | "medium" | "heavy") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const isAdmin = ADMIN_USERNAMES.includes((user.username || "").toLowerCase());

  const navItems = useMemo(() => baseNavItems, []);

  // ─── Пинг API при запуске + автозагрузка заказов ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await pingApi();
      if (cancelled) return;
      setApiReady(ok);
      if (!ok) return;
      // API доступен — тянем заказы (всё для админа, свои для юзера)
      const fresh = await apiFetchOrders(user.username || "", isAdmin);
      if (!cancelled && fresh) setOrders(fresh as OrderItem[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.username, isAdmin]);

  // Периодическое обновление заказов раз в 10 сек, если API живёт
  useEffect(() => {
    if (!apiReady) return;
    const t = window.setInterval(async () => {
      const fresh = await apiFetchOrders(user.username || "", isAdmin);
      if (fresh) setOrders(fresh as OrderItem[]);
    }, 10000);
    return () => window.clearInterval(t);
  }, [apiReady, user.username, isAdmin]);

  // ─── Видимые товары ───
  const visibleProducts = useMemo(() => {
    if (selectedCategory === "all") return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  const openedProduct = useMemo(
    () => products.find((p) => p.id === openedProductId) ?? null,
    [openedProductId],
  );

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const avatarLetter = (user.first_name || "Y").trim().charAt(0).toUpperCase();

  // ─── Действия с корзиной ───
  const handleAddToCart = (product: Product, tariff: Tariff) => {
    vibrate("medium");
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
    setCart((prev) => {
      const ex = prev.find((i) => i.productId === product.id && i.tariffId === tariff.id);
      if (ex) {
        return prev.map((i) =>
          i.productId === product.id && i.tariffId === tariff.id ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [
        {
          id: Date.now(),
          productId: product.id,
          title: product.title,
          category: product.category,
          tariffId: tariff.id,
          tariffTitle: tariff.title,
          price: tariff.price,
          qty: 1,
        },
        ...prev,
      ];
    });
    setNotice(`${product.title} • ${tariff.title} — в корзине`);
  };

  const updateQty = (id: number, d: number) => {
    vibrate("light");
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: i.qty + d } : i)).filter((i) => i.qty > 0),
    );
  };

  const removeFromCart = (id: number) => {
    vibrate("light");
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  // ─── Старт оплаты корзины ───
  const startCheckout = (method: PayMethodId) => {
    if (cart.length === 0) return;
    vibrate("medium");
    if (method === "crypto") {
      setPaymentFlow({ method, amount: cartTotal, stage: "crypto-choose", kind: "purchase" });
    } else {
      setPaymentFlow({ method, amount: cartTotal, stage: "address", kind: "purchase" });
    }
  };

  // Старт пополнения баланса (тот же flow, но kind=topup)
  const startTopUp = (method: PayMethodId, amountRub: number) => {
    if (amountRub <= 0) return;
    vibrate("medium");
    if (method === "crypto") {
      setPaymentFlow({ method, amount: amountRub, stage: "crypto-choose", kind: "topup" });
    } else {
      setPaymentFlow({ method, amount: amountRub, stage: "address", kind: "topup" });
    }
  };

  // ─── Юзер нажал "Я оплатил" ───
  const handleIPaid = async () => {
    if (!paymentFlow) return;
    vibrate("medium");

    const isTopUp = paymentFlow.kind === "topup";

    // Для пополнения — items = одна позиция "Пополнение баланса", для покупки — позиции корзины
    const orderItems = isTopUp
      ? [
          {
            title: "Пополнение баланса",
            tariffTitle: formatPrice(paymentFlow.amount),
            qty: 1,
            price: paymentFlow.amount,
          },
        ]
      : cart.map((i) => ({
          title: i.title,
          tariffTitle: i.tariffTitle,
          qty: i.qty,
          price: i.price,
        }));

    const baseOrder: OrderItem = {
      id: Date.now(),
      createdAt: Date.now(),
      username: user.username || "guest",
      items: orderItems,
      total: paymentFlow.amount,
      method: paymentFlow.method,
      cryptoKind: paymentFlow.cryptoKind,
      status: "pending",
      kind: isTopUp ? "topup" : "purchase",
    };

    if (apiReady) {
      const created = await apiCreateOrder(user.username || "guest", {
        username: user.username || "guest",
        items: baseOrder.items,
        total: baseOrder.total,
        method: baseOrder.method,
        cryptoKind: baseOrder.cryptoKind,
      });
      if (created) {
        const withKind = { ...(created as OrderItem), kind: baseOrder.kind };
        setOrders((prev) => [withKind, ...prev]);
        if (!isTopUp) setCart([]);
        setPaymentFlow({ ...paymentFlow, stage: "waiting", orderId: withKind.id });
        return;
      }
    }

    setOrders((prev) => [baseOrder, ...prev]);
    if (!isTopUp) setCart([]);
    setPaymentFlow({ ...paymentFlow, stage: "waiting", orderId: baseOrder.id });
  };

  // ─── Админка: принять/отклонить заказ ───
  const adminUpdateOrder = async (id: number, status: OrderStatus) => {
    vibrate("medium");

    // Найдём заказ для проверки kind
    const order = orders.find((o) => o.id === id);

    // Если это пополнение и админ принял — начисляем баланс юзеру
    // (если это сам админ — на свой баланс; если другой — в спец-очередь)
    if (order && order.kind === "topup" && status === "completed") {
      const targetUser = order.username.toLowerCase();
      if (targetUser === (user.username || "").toLowerCase()) {
        // Сам себе пополнил — сразу на текущий баланс
        setBalance((p) => p + order.total);
      } else {
        // Другому юзеру — кладём в очередь pending-зачислений
        try {
          const key = "yuki_pending_topups";
          const raw = window.localStorage.getItem(key);
          const list = raw ? (JSON.parse(raw) as { username: string; amount: number; orderId: number }[]) : [];
          if (!list.find((x) => x.orderId === id)) {
            list.push({ username: targetUser, amount: order.total, orderId: id });
            window.localStorage.setItem(key, JSON.stringify(list));
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (apiReady) {
      const updated = await apiUpdateOrderStatus(user.username || "", id, status);
      if (updated) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id ? { ...(updated as OrderItem), kind: o.kind } : o,
          ),
        );
        setNotice(
          status === "completed"
            ? order?.kind === "topup"
              ? `Пополнение @${order.username} на ${formatPrice(order.total)} принято`
              : "Заказ помечен как выполненный"
            : status === "failed"
              ? "Заказ помечен как ошибка"
              : "Заказ в обработке",
        );
        return;
      }
    }

    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setNotice(
      status === "completed"
        ? order?.kind === "topup"
          ? `Пополнение @${order.username} на ${formatPrice(order.total)} принято`
          : "Заказ помечен как выполненный"
        : status === "failed"
          ? "Заказ помечен как ошибка"
          : "Заказ в обработке",
    );
  };

  // При входе юзера — проверяем очередь топ-апов на его имя и зачисляем
  useEffect(() => {
    if (!user.username) return;
    try {
      const key = "yuki_pending_topups";
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const list = JSON.parse(raw) as { username: string; amount: number; orderId: number }[];
      const my = list.filter((x) => x.username.toLowerCase() === user.username!.toLowerCase());
      if (my.length === 0) return;
      const sum = my.reduce((s, x) => s + x.amount, 0);
      setBalance((p) => p + sum);
      const rest = list.filter((x) => x.username.toLowerCase() !== user.username!.toLowerCase());
      window.localStorage.setItem(key, JSON.stringify(rest));
      setNotice(`Зачислено ${formatPrice(sum)} (подтверждённые пополнения)`);
    } catch {
      /* ignore */
    }
  }, [user.username]);

  // ════════════════════════════════════════════════════════════════════════
  // РЕНДЕР
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="h-screen overflow-hidden bg-[#05010d] text-white">
      <style>{`
        @keyframes yukiPulse {
          0%, 100% { transform: scale(1); opacity: 0.55; }
          50% { transform: scale(1.05); opacity: 0.75; }
        }
        @keyframes yukiRing {
          0% { transform: scale(0.9); opacity: 0.28; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes yukiSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes yukiPageIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes yukiFadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .yuki-pulse-dot { animation: yukiPulse 2.4s ease-in-out infinite; }
        .yuki-pulse-ring { animation: yukiRing 2.4s ease-out infinite; }
        .yuki-spin { animation: yukiSpin 1.2s linear infinite; }
        .yuki-page { animation: yukiPageIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .yuki-fade { animation: yukiFadeIn 0.25s ease-out both; }

        /* Глобальные плавные переходы: всё что меняется — анимируется */
        button, a, [role="button"] {
          transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                      background-color 0.22s ease,
                      border-color 0.22s ease,
                      color 0.22s ease,
                      box-shadow 0.22s ease,
                      opacity 0.22s ease;
        }
        img, svg, span, div {
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
                      opacity 0.22s ease,
                      background-color 0.25s ease;
        }
        /* Плавный скролл внутри main */
        .yuki-scroll { scroll-behavior: smooth; }
        /* Модалки — мягко появляются */
        .yuki-modal-bg { animation: yukiFadeIn 0.25s ease-out both; }
        .yuki-modal-card { animation: yukiPageIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden">
        {/* Фон */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#0b0420_0%,#0a0320_40%,#0c0524_100%)]" />
          <div className="absolute -top-24 left-[-50px] h-64 w-64 rounded-full bg-fuchsia-600/20 blur-3xl" />
          <div className="absolute right-[-50px] top-[420px] h-72 w-72 rounded-full bg-violet-600/18 blur-3xl" />
          <div className="absolute bottom-32 left-8 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="absolute right-12 bottom-[-40px] h-44 w-44 rounded-full bg-fuchsia-500/12 blur-3xl" />
        </div>

        {/* Шапка */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-black/40 backdrop-blur-2xl">
          <div className="flex items-center justify-between px-4 pb-4 pt-4">
            <button
              type="button"
              onClick={() => {
                if (openedProduct) return setOpenedProductId(null);
                setActiveTab("catalog");
              }}
              className="flex items-center gap-3"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-xl shadow-[0_0_40px_rgba(168,85,247,0.42)]">
                ✦
              </div>
              <div className="text-left">
                <div className="text-[24px] font-black tracking-[0.22em] text-white">YUKI</div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-violet-200/65">
                  soft bot mini app
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                vibrate("light");
                setOpenedProductId(null);
                setActiveTab("balance");
              }}
              className="flex flex-col items-center rounded-full border border-violet-300/15 bg-white/5 px-4 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.32)] transition active:scale-95"
            >
              <div className="text-[9px] uppercase tracking-[0.3em] text-violet-200/55">Баланс</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/25 text-[11px] text-violet-100">
                  ₽
                </span>
                {formatPrice(balance)}
              </div>
            </button>
          </div>
        </header>

        {/* Основной контент */}
        <main
          ref={mainRef}
          className="yuki-scroll relative z-10 flex-1 overflow-y-auto px-4 pb-32 pt-4"
        >
          <div key={pageKey} className="yuki-page">
          {/* ─── ЭКРАН ОПЛАТЫ ─── */}
          {paymentFlow ? (
            <PaymentScreen
              flow={paymentFlow}
              onClose={() => setPaymentFlow(null)}
              onCryptoPick={(kind) =>
                setPaymentFlow({ ...paymentFlow, cryptoKind: kind, stage: "address" })
              }
              onIPaid={handleIPaid}
              onBackToCatalog={() => {
                setPaymentFlow(null);
                setActiveTab("catalog");
              }}
              onGoToOrders={() => {
                setPaymentFlow(null);
                setActiveTab("orders");
              }}
            />
          ) : openedProduct ? (
            <ProductPage
              product={openedProduct}
              onBack={() => {
                vibrate("light");
                setOpenedProductId(null);
              }}
              onAddToCart={handleAddToCart}
              cartCount={cartCount}
              onGoCart={() => {
                setOpenedProductId(null);
                setActiveTab("cart");
              }}
            />
          ) : (
            <>
              {/* ─── КАТАЛОГ ─── */}
              {activeTab === "catalog" && (
                <CatalogPage
                  categories={categories}
                  selectedCategory={selectedCategory}
                  onPickCategory={(id) => {
                    vibrate("light");
                    setSelectedCategory(id);
                  }}
                  products={visibleProducts}
                  onOpenProduct={(id) => {
                    vibrate("light");
                    setOpenedProductId(id);
                  }}
                />
              )}

              {/* ─── КОРЗИНА ─── */}
              {activeTab === "cart" && (
                <CartPage
                  cart={cart}
                  cartTotal={cartTotal}
                  cartCount={cartCount}
                  balance={balance}
                  onUpdateQty={updateQty}
                  onRemove={removeFromCart}
                  selectedMethod={selectedPayMethod}
                  onPickMethod={setSelectedPayMethod}
                  onClearCart={() => {
                    vibrate("light");
                    setCart([]);
                    setNotice("Корзина очищена");
                  }}
                  onCheckout={startCheckout}
                  onGoCatalog={() => setActiveTab("catalog")}
                />
              )}

              {/* ─── ЗАКАЗЫ (только свои у обычного юзера) ─── */}
              {activeTab === "orders" && (
                <OrdersPage
                  orders={orders.filter(
                    (o) => o.username.toLowerCase() === (user.username || "").toLowerCase(),
                  )}
                  viewOrderId={viewOrderId}
                  onView={(id) => setViewOrderId(id)}
                  onClose={() => setViewOrderId(null)}
                  onOpenSupport={() => setShowSupport(true)}
                />
              )}

              {/* ─── БАЛАНС ─── */}
              {activeTab === "balance" && (
                <BalancePage
                  balance={balance}
                  selectedPayMethod={selectedPayMethod}
                  setSelectedPayMethod={setSelectedPayMethod}
                  topUpAmount={topUpAmount}
                  setTopUpAmount={setTopUpAmount}
                  onTopUp={(rub) => {
                    setTopUpAmount("");
                    startTopUp(selectedPayMethod, rub);
                  }}
                />
              )}

              {/* ─── ПРОФИЛЬ ─── */}
              {activeTab === "profile" && (
                <ProfilePage
                  user={user}
                  avatarLetter={avatarLetter}
                  balance={balance}
                  ordersCount={orders.length}
                  isAdmin={isAdmin}
                  onGoBalance={() => setActiveTab("balance")}
                  onGoOrders={() => setActiveTab("orders")}
                  onGoAdmin={() => setActiveTab("admin")}
                />
              )}

              {/* ─── АДМИНКА ─── */}
              {activeTab === "admin" && isAdmin && (
                <AdminPage
                  orders={orders}
                  onApprove={(id) => adminUpdateOrder(id, "completed")}
                  onReject={(id) => adminUpdateOrder(id, "failed")}
                />
              )}
            </>
          )}
          </div>
        </main>

        {/* Нижняя навигация */}
        {!paymentFlow && (
          <nav className="fixed bottom-0 left-0 right-0 z-30 mx-auto w-full max-w-md border-t border-white/10 bg-black/65 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl">
            <div className={`grid gap-1 ${isAdmin ? "grid-cols-5" : "grid-cols-5"}`}>
              {navItems.map((item) => {
                const isActive = item.id === activeTab && !openedProduct;
                const showBadge = item.id === "cart" && cartCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      vibrate("light");
                      setOpenedProductId(null);
                      setActiveTab(item.id);
                    }}
                    className={`relative flex h-14 flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-2 text-center transition ${
                      isActive
                        ? "bg-gradient-to-b from-violet-500/35 to-indigo-500/15 text-white"
                        : "text-violet-100/60"
                    }`}
                  >
                    <NavIcon icon={item.icon} active={isActive} />
                    <span className="text-[10px] font-medium leading-none">{item.label}</span>
                    {showBadge && (
                      <span className="absolute right-2 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[9px] font-bold text-white shadow-[0_0_12px_rgba(232,121,249,0.7)]">
                        {cartCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Toast */}
        {notice && (
          <div className="pointer-events-none fixed bottom-28 left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-violet-300/20 bg-black/75 px-4 py-3 text-sm text-violet-50 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            {notice}
          </div>
        )}

        {/* 🎁 Подарок (для отладочных юзеров) */}
        {giftModal && (
          <Modal>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-4xl shadow-[0_0_60px_rgba(168,85,247,0.55)]">
              🎁
            </div>
            <h2 className="mt-5 text-center text-2xl font-bold text-white">
              У тебя подарок!
            </h2>
            <p className="mt-3 text-center text-base leading-6 text-violet-100/85">
              {giftModal.message}
            </p>
            <div className="mt-5 rounded-2xl border border-violet-300/30 bg-violet-500/15 px-4 py-4 text-center">
              <div className="text-xs uppercase tracking-[0.28em] text-violet-200/65">
                На баланс зачислено
              </div>
              <div className="mt-2 text-3xl font-black text-white">
                {formatPrice(giftModal.balance)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setGiftModal(null)}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white shadow-[0_12px_36px_rgba(168,85,247,0.4)]"
            >
              Спасибо, бро 🤝
            </button>
          </Modal>
        )}

        {/* Welcome modal */}
        {showWelcome && (
          <Modal>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-2xl shadow-[0_0_40px_rgba(168,85,247,0.4)]">
              ✦
            </div>
            <h2 className="mt-5 text-center text-2xl font-bold text-white">Добро пожаловать!</h2>
            <p className="mt-3 text-center text-sm leading-6 text-violet-100/70">
              YUKI — твой персональный магазин приватного софта, сертификатов и цифровых товаров.
              Выбирай категорию, добавляй в корзину и оплачивай удобным способом.
            </p>

            <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 text-sm text-violet-100/70">
              <input
                type="checkbox"
                checked={welcomeDontShow}
                onChange={(e) => setWelcomeDontShow(e.target.checked)}
                className="h-4 w-4 accent-violet-500"
              />
              Больше не показывать
            </label>

            <button
              type="button"
              onClick={() => {
                if (welcomeDontShow) {
                  window.localStorage.setItem("yuki_welcome_dismissed", "1");
                }
                setShowWelcome(false);
              }}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white shadow-[0_12px_36px_rgba(168,85,247,0.4)]"
            >
              Начать покупки!
            </button>
          </Modal>
        )}

        {/* No funds modal */}
        {noFundsModal && (
          <Modal>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-2xl">
              ⚠️
            </div>
            <h3 className="mt-4 text-center text-xl font-semibold text-white">
              Недостаточно средств
            </h3>
            <p className="mt-2 text-center text-sm text-violet-100/65">
              Не хватает{" "}
              <span className="font-semibold text-violet-200">
                {formatPrice(noFundsModal.needed)}
              </span>
              .
            </p>
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setNoFundsModal(null);
                  setActiveTab("balance");
                }}
                className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white"
              >
                Пополнить
              </button>
              <button
                type="button"
                onClick={() => setNoFundsModal(null)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base font-semibold text-violet-100"
              >
                Ок
              </button>
            </div>
          </Modal>
        )}

        {/* Support modal */}
        {showSupport && (
          <Modal>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/20 text-2xl">
              💬
            </div>
            <h3 className="mt-4 text-center text-xl font-semibold text-white">Поддержка</h3>
            <p className="mt-2 text-center text-sm text-violet-100/65">
              Если возникли проблемы с оплатой или товаром — напиши в поддержку. Ответим в течение
              нескольких минут.
            </p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
              {SUPPORT_URL ? (
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-semibold text-violet-300 underline underline-offset-2"
                >
                  Написать в поддержку
                </a>
              ) : (
                <span className="text-sm text-violet-100/55">
                  Ссылка появится позже (в коде поле SUPPORT_URL)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowSupport(false)}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base font-semibold text-violet-100"
            >
              Закрыть
            </button>
          </Modal>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// МОДАЛКА (обёртка)
// ════════════════════════════════════════════════════════════════════════════
function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="yuki-modal-bg fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-md">
      <div className="yuki-modal-card w-full max-w-sm rounded-[28px] border border-violet-300/20 bg-[#0d0420] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        {children}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА КАТАЛОГА
// ════════════════════════════════════════════════════════════════════════════
function CatalogPage({
  categories,
  selectedCategory,
  onPickCategory,
  products,
  onOpenProduct,
}: {
  categories: typeof import("./App").default extends never ? never : any;
  selectedCategory: CategoryId;
  onPickCategory: (id: CategoryId) => void;
  products: Product[];
  onOpenProduct: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SectionCard className="bg-white/[0.03]">
        <p className="text-xs uppercase tracking-[0.38em] text-violet-200/60">YUKI soft catalog</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-white">
          Выбери категорию
          <br />и открой товар
        </h1>
        <p className="mt-3 text-sm leading-6 text-violet-100/55">
          «YUKI Soft» — фильтр со всеми товарами. Остальные кнопки — фильтрация по разделам.
        </p>
      </SectionCard>

      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.map((cat: any) => {
          const isActive = cat.id === selectedCategory;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onPickCategory(cat.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition active:scale-95 ${
                isActive
                  ? "border-violet-300/50 bg-gradient-to-r from-[#7c3aed] via-[#8b5cf6] to-[#a855f7] text-white"
                  : "border-white/10 bg-white/[0.04] text-violet-100/75"
              }`}
            >
              <CategoryIcon icon={cat.icon} iconUrl={cat.iconUrl} />
              <span className="font-medium">{cat.title}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {products.length === 0 ? (
          <SectionCard className="text-center text-violet-100/60">
            В этом разделе пока пусто. Скоро добавим товары.
          </SectionCard>
        ) : (
          products.map((product) => {
            const minPrice = Math.min(...product.tariffs.map((t) => t.price));
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => onOpenProduct(product.id)}
                className="block w-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] text-left shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition active:scale-[0.99]"
              >
                <div className="relative h-44 w-full overflow-hidden">
                  <PlatformBadge platform={product.platform} />
                  <ProductImage src={product.image} title={product.title} />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-lg font-semibold text-white">{product.title}</div>
                      <div className="mt-1 text-sm text-violet-100/55">{product.short}</div>
                    </div>
                    <div className="flex items-baseline gap-1.5 rounded-2xl border border-violet-300/20 bg-violet-500/10 px-3 py-2">
                      <span className="text-[10px] uppercase tracking-[0.22em] text-violet-100/55">
                        от
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {formatPrice(minPrice)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2 text-xs text-violet-100/55">
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                      {categories.find((c: any) => c.id === product.category)?.title}
                    </span>
                    <span className="text-violet-200/60">Открыть →</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА ТОВАРА
// ════════════════════════════════════════════════════════════════════════════
function ProductPage({
  product,
  onBack,
  onAddToCart,
  cartCount,
  onGoCart,
}: {
  product: Product;
  onBack: () => void;
  onAddToCart: (p: Product, t: Tariff) => void;
  cartCount: number;
  onGoCart: () => void;
}) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-violet-100/65"
      >
        <span className="text-lg">←</span> Назад к каталогу
      </button>

      <SectionCard className="overflow-hidden p-0">
        <div className="relative h-56 w-full overflow-hidden">
          <PlatformBadge platform={product.platform} />
          {product.video ? (
            <video
              src={product.video}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <ProductImage src={product.image} title={product.title} />
          )}
        </div>
        <div className="p-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-violet-100/70">
            {categories.find((c) => c.id === product.category)?.title}
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-white">{product.title}</h1>
          <p className="mt-1 text-sm text-violet-100/55">{product.short}</p>
          <p className="mt-4 text-sm leading-6 text-violet-100/70">{product.description}</p>

          {product.note && (
            <div className="mt-4 rounded-2xl border border-violet-300/20 bg-violet-500/10 px-4 py-3 text-[13px] leading-5 text-violet-100/80">
              {product.note}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {product.features.map((f) => (
              <span
                key={f}
                className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-violet-50/80"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </SectionCard>

      {product.infoUrl && (
        <p className="px-1 text-[13px] leading-5 text-violet-100/60">
          Более подробно ознакомиться с товаром вы можете тут:{" "}
          <a
            href={product.infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-violet-300 underline underline-offset-2"
          >
            перейти
          </a>
        </p>
      )}

      <SectionCard>
        <h2 className="text-xl font-semibold text-white">Выбери тариф</h2>
        <p className="mt-1 text-sm text-violet-100/55">
          Тариф добавится в корзину. Оплатишь в разделе «Корзина».
        </p>
        <div className="mt-4 space-y-3">
          {product.tariffs.map((tariff) => (
            <div
              key={tariff.id}
              className="overflow-hidden rounded-[22px] border border-white/10 bg-black/25"
            >
              <div className="px-4 pt-3">
                <div className="text-base font-semibold text-white">{tariff.title}</div>
                <div className="text-xs text-violet-100/55">{tariff.subtitle}</div>
              </div>
              <button
                type="button"
                onClick={() => onAddToCart(product, tariff)}
                className="mt-3 grid w-full grid-cols-3 overflow-hidden border-t border-white/10 active:scale-[0.99]"
              >
                <div className="col-span-2 flex items-center justify-center bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 py-3 text-base font-bold text-white">
                  {formatPrice(tariff.price)}
                </div>
                <div className="col-span-1 flex items-center justify-center gap-1.5 bg-violet-500/20 py-3 text-xs font-semibold text-violet-50">
                  {CART_ICON_URL ? (
                    <img src={CART_ICON_URL} alt="" className="h-4 w-4 object-contain" />
                  ) : (
                    <span className="text-base">🛒</span>
                  )}
                  <span>В корзину</span>
                </div>
              </button>
            </div>
          ))}
        </div>

        {cartCount > 0 && (
          <button
            type="button"
            onClick={onGoCart}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/30 bg-violet-500/15 px-4 py-3 text-sm font-semibold text-violet-100"
          >
            Перейти в корзину ({cartCount}) →
          </button>
        )}
      </SectionCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА КОРЗИНЫ
// ════════════════════════════════════════════════════════════════════════════
function CartPage({
  cart,
  cartTotal,
  cartCount,
  balance,
  onUpdateQty,
  onRemove,
  selectedMethod,
  onPickMethod,
  onClearCart,
  onCheckout,
  onGoCatalog,
}: {
  cart: CartItem[];
  cartTotal: number;
  cartCount: number;
  balance: number;
  onUpdateQty: (id: number, d: number) => void;
  onRemove: (id: number) => void;
  selectedMethod: PayMethodId;
  onPickMethod: (m: PayMethodId) => void;
  onClearCart: () => void;
  onCheckout: (m: PayMethodId) => void;
  onGoCatalog: () => void;
}) {
  if (cart.length === 0) {
    return (
      <div className="space-y-5">
        <SectionCard>
          <p className="text-xs uppercase tracking-[0.35em] text-violet-200/55">YUKI cart</p>
          <h2 className="mt-3 text-3xl font-semibold text-white">Корзина</h2>
          <p className="mt-2 text-sm leading-6 text-violet-100/55">
            Сейчас пусто. Добавь товар в корзину со страницы товара.
          </p>
        </SectionCard>

        <SectionCard className="text-center">
          <div className="relative mx-auto h-24 w-24">
            <span className="yuki-pulse-ring absolute inset-0 rounded-full border border-violet-300/20 bg-violet-500/10" />
            <span
              className="yuki-pulse-ring absolute inset-0 rounded-full border border-violet-300/15 bg-violet-500/5"
              style={{ animationDelay: "0.8s" }}
            />
            <div className="yuki-pulse-dot relative flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/5 text-3xl text-violet-200/70 backdrop-blur-md">
              {CART_BIG_ICON_URL ? (
                <img
                  src={CART_BIG_ICON_URL}
                  alt=""
                  className="h-12 w-12 object-contain opacity-80"
                />
              ) : (
                "🛒"
              )}
            </div>
          </div>
          <h3 className="mt-6 text-2xl font-semibold text-white">Корзина пуста</h3>
          <button
            type="button"
            onClick={onGoCatalog}
            className="mt-5 rounded-full border border-violet-300/20 bg-violet-500/10 px-5 py-3 text-sm font-semibold text-violet-100"
          >
            В каталог
          </button>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard>
        <p className="text-xs uppercase tracking-[0.35em] text-violet-200/55">YUKI cart</p>
        <h2 className="mt-3 text-3xl font-semibold text-white">Корзина</h2>
        <p className="mt-2 text-sm leading-6 text-violet-100/55">
          В корзине {cartCount} {cartCount === 1 ? "позиция" : "позиций"} на сумму{" "}
          {formatPrice(cartTotal)}.
        </p>
      </SectionCard>

      <div className="space-y-3">
        {cart.map((item) => (
          <SectionCard key={item.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-base font-semibold text-white">{item.title}</div>
                <div className="mt-1 text-xs text-violet-100/55">Тариф: {item.tariffTitle}</div>
                <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/25 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.id, -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-base font-semibold text-violet-100 active:scale-95"
                  >
                    −
                  </button>
                  <span className="min-w-[20px] text-center text-sm font-semibold text-white">
                    {item.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.id, +1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-base font-semibold text-violet-100 active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
                  {formatPrice(item.price * item.qty)}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="text-[11px] text-violet-200/55 underline-offset-2 hover:underline"
                >
                  убрать
                </button>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      {/* Выбор метода оплаты */}
      <SectionCard>
        <h3 className="text-lg font-semibold text-white">Способ оплаты</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {payMethods.map((m) => {
            const active = m.id === selectedMethod;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPickMethod(m.id)}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs transition active:scale-95 ${
                  active
                    ? "border-violet-300/50 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/[0.04] text-violet-100/75"
                }`}
              >
                {m.logo && (
                  <img src={m.logo} alt={m.title} className="h-8 w-8 object-contain" />
                )}
                <div className="flex-1">
                  <div className="font-semibold">{m.title}</div>
                  <div className="text-[10px] text-violet-100/55">{m.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Итого */}
      <SectionCard className="bg-[linear-gradient(135deg,rgba(168,85,247,0.18),rgba(99,102,241,0.12))]">
        <div className="flex items-center justify-between text-sm text-violet-100/60">
          <span>Позиций</span>
          <span className="text-white">{cartCount}</span>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-violet-100/60">
          <span>На балансе</span>
          <span className="text-white">{formatPrice(balance)}</span>
        </div>
        <div className="mt-4 h-px bg-white/10" />
        <div className="mt-4 flex items-center justify-between text-2xl font-bold text-white">
          <span>Итого</span>
          <span>{formatPrice(cartTotal)}</span>
        </div>
        <button
          type="button"
          onClick={() => onCheckout(selectedMethod)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white shadow-[0_14px_40px_rgba(168,85,247,0.4)]"
        >
          Перейти к оплате · {formatPrice(cartTotal)}
        </button>
        <button
          type="button"
          onClick={onClearCart}
          className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-violet-100/80"
        >
          Очистить корзину
        </button>
      </SectionCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ЭКРАН ОПЛАТЫ (с разными стадиями)
// ════════════════════════════════════════════════════════════════════════════
function PaymentScreen({
  flow,
  onClose,
  onCryptoPick,
  onIPaid,
  onBackToCatalog,
  onGoToOrders,
}: {
  flow: {
    method: PayMethodId;
    amount: number;
    cryptoKind?: CryptoKindId;
    stage: "crypto-choose" | "address" | "waiting" | "failed";
    orderId?: number;
  };
  onClose: () => void;
  onCryptoPick: (k: CryptoKindId) => void;
  onIPaid: () => void;
  onBackToCatalog: () => void;
  onGoToOrders: () => void;
}) {
  const method = payMethods.find((m) => m.id === flow.method)!;

  // ─── Стадия 1: Выбор крипты ───
  if (flow.stage === "crypto-choose") {
    return <CryptoChooseScreen flow={flow} onPick={onCryptoPick} onClose={onClose} />;
  }

  // ─── Стадия 2: Адрес/реквизиты + таймер ───
  if (flow.stage === "address") {
    return (
      <AddressScreen
        method={method}
        amount={flow.amount}
        cryptoKind={flow.cryptoKind}
        onClose={onClose}
        onIPaid={onIPaid}
      />
    );
  }

  // ─── Стадия 3: Ожидание подтверждения ───
  if (flow.stage === "waiting") {
    return <WaitingScreen onBackToCatalog={onBackToCatalog} onGoToOrders={onGoToOrders} />;
  }

  return null;
}

// ─── Экран выбора крипты ───
function CryptoChooseScreen({
  flow,
  onPick,
  onClose,
}: {
  flow: { amount: number };
  onPick: (k: CryptoKindId) => void;
  onClose: () => void;
}) {
  const [selectedKind, setSelectedKind] = useState<CryptoKindId | null>(null);
  const coin = selectedKind ? cryptoKinds.find((c) => c.id === selectedKind) : null;
  const { rubPerUnit, loading } = useCryptoRate(coin?.coingeckoId ?? null);

  const cryptoAmount =
    rubPerUnit && rubPerUnit > 0 ? (flow.amount / rubPerUnit).toFixed(coin?.id === "btc" ? 8 : 4) : null;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-violet-100/65"
      >
        <span className="text-lg">←</span> Отмена
      </button>

      <SectionCard>
        <p className="text-xs uppercase tracking-[0.35em] text-violet-200/55">YUKI · Crypto</p>
        <h2 className="mt-3 text-2xl font-bold text-white">Выберите валюту</h2>
        <p className="mt-2 text-sm text-violet-100/55">
          Сумма к оплате: <span className="text-white">{formatPrice(flow.amount)}</span>
        </p>

        <div className="mt-5 space-y-3">
          {cryptoKinds.map((c) => {
            const active = selectedKind === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedKind(c.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 transition active:scale-[0.98] ${
                  active
                    ? "border-violet-300/50 bg-violet-500/15"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  {c.logo ? (
                    <img src={c.logo} alt={c.symbol} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs font-bold text-violet-100/70">{c.symbol}</span>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-base font-semibold text-white">{c.title}</div>
                  <div className="text-xs text-violet-100/55">{c.symbol}</div>
                </div>
                {active && <span className="text-xl text-violet-300">✓</span>}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Сумма в выбранной крипте */}
      {selectedKind && (
        <SectionCard>
          <div className="text-xs uppercase tracking-[0.28em] text-violet-200/55">К оплате</div>
          {loading ? (
            <div className="mt-3 flex items-center gap-3">
              <div className="yuki-spin h-6 w-6 rounded-full border-2 border-violet-300/30 border-t-violet-300" />
              <span className="text-sm text-violet-100/65">Расчёт курса…</span>
            </div>
          ) : cryptoAmount ? (
            <div className="mt-3 text-3xl font-bold text-white">
              {cryptoAmount} <span className="text-violet-300">{coin?.symbol}</span>
            </div>
          ) : (
            <div className="mt-3 text-sm text-red-300/80">
              Не удалось получить курс. Попробуйте ещё раз.
            </div>
          )}
          <div className="mt-1 text-xs text-violet-100/45">
            ≈ {formatPrice(flow.amount)} по курсу CoinGecko
          </div>
        </SectionCard>
      )}

      <button
        type="button"
        disabled={!selectedKind || !cryptoAmount}
        onClick={() => selectedKind && onPick(selectedKind)}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-semibold transition ${
          selectedKind && cryptoAmount
            ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 text-white shadow-[0_14px_40px_rgba(168,85,247,0.4)] active:scale-[0.99]"
            : "cursor-not-allowed border border-white/10 bg-white/5 text-violet-100/40"
        }`}
      >
        {selectedKind
          ? `Оплатить в ${cryptoKinds.find((c) => c.id === selectedKind)?.symbol}`
          : "Выберите валюту"}
      </button>
    </div>
  );
}

// ─── Экран адреса оплаты + таймер ───
function AddressScreen({
  method,
  amount,
  cryptoKind,
  onClose,
  onIPaid,
}: {
  method: PayMethod;
  amount: number;
  cryptoKind?: CryptoKindId;
  onClose: () => void;
  onIPaid: () => void;
}) {
  const [secLeft, setSecLeft] = useState(PAYMENT_TIMER_SECONDS);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (secLeft <= 0) return;
    const t = window.setInterval(() => setSecLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [secLeft > 0]);

  const isCrypto = method.id === "crypto";
  const isSbp = method.id === "sbp";
  const address = isCrypto ? PAYMENT_CRYPTO_ADDRESS : PAYMENT_PHONE_NUMBER;
  const coin = cryptoKind ? cryptoKinds.find((c) => c.id === cryptoKind) : null;

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  // % таймера для прогресс-бара
  const pct = (secLeft / PAYMENT_TIMER_SECONDS) * 100;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-violet-100/65"
      >
        <span className="text-lg">←</span> Отмена
      </button>

      <SectionCard className="overflow-hidden bg-[linear-gradient(135deg,rgba(168,85,247,0.18),rgba(99,102,241,0.12))]">
        <div className="flex items-center gap-3">
          {method.logo && (
            <img src={method.logo} alt={method.title} className="h-10 w-10 object-contain" />
          )}
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-violet-200/55">Оплата</div>
            <div className="text-xl font-bold text-white">
              {method.title}
              {coin && (
                <span className="ml-2 text-violet-300">· {coin.symbol}</span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 text-3xl font-black text-white">{formatPrice(amount)}</div>
      </SectionCard>

      <SectionCard>
        <p className="text-sm text-violet-100/70">
          {isCrypto
            ? "Переводите строго по данному адресу:"
            : isSbp
              ? "Переведите указанную сумму на номер:"
              : "Реквизиты для оплаты:"}
        </p>
        <div className="mt-3 break-all rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-mono font-semibold text-sky-300">
          {address}
        </div>
        <button
          type="button"
          onClick={copy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/30 bg-violet-500/15 px-4 py-3 text-sm font-semibold text-violet-100 active:scale-95"
        >
          {copied ? "✓ Скопировано" : "📋 Скопировать"}
        </button>

        {coin && (
          <p className="mt-3 text-xs text-violet-100/55">
            Оплата в <span className="text-white">{coin.title} ({coin.symbol})</span>.
          </p>
        )}
      </SectionCard>

      {/* Таймер */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.3em] text-violet-200/55">
            Время на оплату
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              secLeft < 60 ? "text-red-300" : "text-white"
            }`}
          >
            {formatTime(secLeft)}
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </SectionCard>

      <div className="space-y-3">
        <button
          type="button"
          onClick={onIPaid}
          disabled={secLeft <= 0}
          className={`w-full rounded-2xl px-5 py-4 text-base font-semibold transition ${
            secLeft > 0
              ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 text-white shadow-[0_14px_40px_rgba(168,85,247,0.4)] active:scale-[0.99]"
              : "cursor-not-allowed border border-white/10 bg-white/5 text-violet-100/40"
          }`}
        >
          Я оплатил
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base font-semibold text-violet-100"
        >
          Отменить оплату
        </button>
      </div>
    </div>
  );
}

// ─── Экран ожидания подтверждения ───
function WaitingScreen({
  onBackToCatalog,
  onGoToOrders,
}: {
  onBackToCatalog: () => void;
  onGoToOrders: () => void;
}) {
  return (
    <div className="space-y-5 pt-8">
      <div className="flex flex-col items-center text-center">
        <div className="relative h-32 w-32">
          <span className="yuki-pulse-ring absolute inset-0 rounded-full border border-violet-300/30 bg-violet-500/10" />
          <span
            className="yuki-pulse-ring absolute inset-0 rounded-full border border-violet-300/20 bg-violet-500/5"
            style={{ animationDelay: "0.8s" }}
          />
          <div className="absolute inset-4 flex items-center justify-center">
            <div className="yuki-spin h-16 w-16 rounded-full border-4 border-violet-300/20 border-t-violet-400" />
          </div>
        </div>
        <h2 className="mt-8 text-2xl font-bold text-white">Ожидание подтверждения</h2>
        <p className="mt-3 max-w-xs text-sm leading-6 text-violet-100/65">
          Платёж проверяется. За статусом оплаты вы можете проследить в разделе{" "}
          <button
            type="button"
            onClick={onGoToOrders}
            className="font-semibold text-violet-300 underline underline-offset-2"
          >
            Заказы
          </button>
          .
        </p>
      </div>

      <div className="space-y-3 pt-4">
        <button
          type="button"
          onClick={onGoToOrders}
          className="w-full rounded-2xl border border-violet-300/30 bg-violet-500/15 px-5 py-4 text-base font-semibold text-violet-100"
        >
          Перейти в Заказы
        </button>
        <button
          type="button"
          onClick={onBackToCatalog}
          className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white"
        >
          Вернуться в каталог
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА ЗАКАЗОВ
// ════════════════════════════════════════════════════════════════════════════
function OrdersPage({
  orders,
  viewOrderId,
  onView,
  onClose,
  onOpenSupport,
}: {
  orders: OrderItem[];
  viewOrderId: number | null;
  onView: (id: number) => void;
  onClose: () => void;
  onOpenSupport: () => void;
}) {
  const pending = orders.filter((o) => o.status === "pending");
  const completed = orders.filter((o) => o.status === "completed");
  const failed = orders.filter((o) => o.status === "failed");

  const viewOrder = viewOrderId ? orders.find((o) => o.id === viewOrderId) : null;

  if (viewOrder) {
    return (
      <OrderDetailPage order={viewOrder} onClose={onClose} onSupport={onOpenSupport} />
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard>
        <p className="text-xs uppercase tracking-[0.35em] text-violet-200/55">YUKI orders</p>
        <h2 className="mt-3 text-3xl font-semibold text-white">Заказы</h2>
        <p className="mt-2 text-sm leading-6 text-violet-100/55">
          Все твои оформленные заказы. Незавершённые — в обработке, завершённые — готовы.
        </p>
      </SectionCard>

      {orders.length === 0 && (
        <SectionCard className="text-center text-violet-100/60">Заказов ещё нет</SectionCard>
      )}

      {pending.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-1">
            <h3 className="text-lg font-semibold text-white">Незавершённые</h3>
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-violet-100/45">{pending.length}</span>
          </div>
          {pending.map((o) => (
            <OrderRow key={o.id} order={o} onClick={() => onView(o.id)} />
          ))}
        </>
      )}

      {failed.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-1 pt-2">
            <h3 className="text-lg font-semibold text-white">С ошибкой</h3>
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-violet-100/45">{failed.length}</span>
          </div>
          {failed.map((o) => (
            <OrderRow key={o.id} order={o} onClick={() => onView(o.id)} />
          ))}
        </>
      )}

      {completed.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-1 pt-2">
            <h3 className="text-lg font-semibold text-white">Завершённые</h3>
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-violet-100/45">{completed.length}</span>
          </div>
          {completed.map((o) => (
            <OrderRow key={o.id} order={o} onClick={() => onView(o.id)} />
          ))}
        </>
      )}
    </div>
  );
}

function OrderRow({ order, onClick }: { order: OrderItem; onClick: () => void }) {
  const statusText: Record<OrderStatus, string> = {
    pending: "В обработке",
    completed: "Выполнен",
    failed: "Ошибка",
  };
  const statusColor: Record<OrderStatus, string> = {
    pending: "text-amber-300",
    completed: "text-fuchsia-300",
    failed: "text-red-300",
  };
  const dot: OrderStatus = order.status;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-[22px] border border-white/10 bg-white/[0.045] p-4 text-left transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-base font-semibold text-white">
            {order.items[0]?.title}
            {order.items.length > 1 && (
              <span className="ml-1 text-xs text-violet-100/55">
                и ещё {order.items.length - 1}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <StatusDot kind={dot} />
            <span className={`font-semibold ${statusColor[order.status]}`}>
              {statusText[order.status]}
            </span>
            <span className="text-violet-100/45">
              · {new Date(order.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
          {formatPrice(order.total)}
        </div>
      </div>
    </button>
  );
}

function OrderDetailPage({
  order,
  onClose,
  onSupport,
}: {
  order: OrderItem;
  onClose: () => void;
  onSupport: () => void;
}) {
  const methodTitle = payMethods.find((m) => m.id === order.method)?.title || order.method;

  // Failed → специальный экран
  if (order.status === "failed") {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm text-violet-100/65"
        >
          <span className="text-lg">←</span> К заказам
        </button>

        <SectionCard className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-3xl">
            ✕
          </div>
          <h2 className="mt-4 text-2xl font-bold text-white">Ошибка с оплатой</h2>
          <p className="mt-3 text-sm leading-6 text-violet-100/65">
            К сожалению, оплата не была подтверждена. Возможно, средства не пришли вовремя или
            возникла техническая проблема. Попробуйте оплатить ещё раз или напишите в поддержку —
            мы разберёмся.
          </p>
        </SectionCard>

        <SectionCard>
          <h3 className="text-base font-semibold text-white">Детали заказа</h3>
          <div className="mt-3 space-y-2 text-sm text-violet-100/70">
            <div className="flex justify-between">
              <span>Способ</span>
              <span className="text-white">{methodTitle}</span>
            </div>
            <div className="flex justify-between">
              <span>Сумма</span>
              <span className="text-white">{formatPrice(order.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Дата</span>
              <span className="text-white">
                {new Date(order.createdAt).toLocaleString("ru-RU")}
              </span>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white"
          >
            Повторить платёж
          </button>
          <button
            type="button"
            onClick={onSupport}
            className="w-full rounded-2xl border border-violet-300/30 bg-violet-500/15 px-5 py-4 text-base font-semibold text-violet-100"
          >
            Написать в поддержку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-violet-100/65"
      >
        <span className="text-lg">←</span> К заказам
      </button>

      <SectionCard>
        <div className="flex items-center gap-2">
          <StatusDot kind={order.status} />
          <span
            className={`text-sm font-semibold ${
              order.status === "completed" ? "text-fuchsia-300" : "text-amber-300"
            }`}
          >
            {order.status === "completed" ? "Выполнен" : "В обработке"}
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-bold text-white">Заказ #{order.id.toString().slice(-6)}</h2>
        <div className="mt-1 text-xs text-violet-100/55">
          {new Date(order.createdAt).toLocaleString("ru-RU")}
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-base font-semibold text-white">Позиции</h3>
        <div className="mt-3 space-y-2">
          {order.items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <div className="text-white">{it.title}</div>
                <div className="text-xs text-violet-100/55">
                  {it.tariffTitle} × {it.qty}
                </div>
              </div>
              <div className="text-white">{formatPrice(it.price * it.qty)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 h-px bg-white/10" />
        <div className="mt-3 flex justify-between text-base font-bold text-white">
          <span>Итого</span>
          <span>{formatPrice(order.total)}</span>
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-base font-semibold text-white">Оплата</h3>
        <div className="mt-3 space-y-2 text-sm text-violet-100/70">
          <div className="flex justify-between">
            <span>Способ</span>
            <span className="text-white">{methodTitle}</span>
          </div>
          {order.cryptoKind && (
            <div className="flex justify-between">
              <span>Валюта</span>
              <span className="text-white">
                {cryptoKinds.find((c) => c.id === order.cryptoKind)?.symbol}
              </span>
            </div>
          )}
        </div>
      </SectionCard>

      {order.status === "completed" && (
        <SectionCard className="bg-[linear-gradient(135deg,rgba(168,85,247,0.18),rgba(99,102,241,0.12))]">
          <h3 className="text-base font-semibold text-white">Информация по товару</h3>
          <p className="mt-2 text-sm leading-5 text-violet-100/70">
            Здесь будет файл, ключ активации и подробная инструкция. Скоро добавим полный
            функционал — сейчас связь через поддержку.
          </p>
          <button
            type="button"
            onClick={onSupport}
            className="mt-4 w-full rounded-2xl border border-violet-300/30 bg-violet-500/15 px-5 py-3 text-sm font-semibold text-violet-100"
          >
            Связаться с поддержкой
          </button>
        </SectionCard>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА БАЛАНСА
// ════════════════════════════════════════════════════════════════════════════
function BalancePage({
  balance,
  selectedPayMethod,
  setSelectedPayMethod,
  topUpAmount,
  setTopUpAmount,
  onTopUp,
}: {
  balance: number;
  selectedPayMethod: PayMethodId;
  setSelectedPayMethod: (m: PayMethodId) => void;
  topUpAmount: string;
  setTopUpAmount: (v: string) => void;
  onTopUp: (rub: number) => void;
}) {
  const method = payMethods.find((m) => m.id === selectedPayMethod)!;
  const parsed = Number(topUpAmount);
  const isValid = Number.isFinite(parsed) && parsed > 0;
  const rubPreview = method.unit === "⭐" && isValid ? Math.round(parsed * STARS_TO_RUB) : null;

  return (
    <div className="space-y-5">
      <SectionCard className="overflow-hidden bg-[linear-gradient(135deg,rgba(168,85,247,0.25),rgba(99,102,241,0.18))]">
        <p className="text-xs uppercase tracking-[0.35em] text-violet-200/65">Твой баланс</p>
        <div className="mt-3 text-5xl font-black tracking-tight text-white">
          {formatPrice(balance)}
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-xl font-semibold text-white">Способ пополнения</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {payMethods.map((m) => {
            const active = m.id === selectedPayMethod;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedPayMethod(m.id);
                  setTopUpAmount("");
                }}
                className={`overflow-hidden rounded-[22px] border p-4 text-left transition active:scale-[0.98] ${
                  active
                    ? "border-violet-300/50 bg-gradient-to-br " +
                      m.accent +
                      " shadow-[0_0_30px_rgba(168,85,247,0.25)]"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex h-16 w-16 items-center justify-start">
                  {m.logo ? (
                    <img
                      src={m.logo}
                      alt={m.title}
                      className="h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
                    />
                  ) : (
                    <span className="text-[11px] uppercase tracking-wider text-violet-100/35">
                      logo
                    </span>
                  )}
                </div>
                <div className="mt-3 text-base font-semibold text-white">{m.title}</div>
                <div className="mt-1 text-[11px] text-violet-100/55">{m.hint}</div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Сумма</h3>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-violet-100/65">
            {method.title}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-[22px] border border-white/10 bg-black/30 px-4 py-3">
          <input
            type="number"
            inputMode="numeric"
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            placeholder="0"
            className="flex-1 bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-white/25"
          />
          <span className="text-2xl font-semibold text-violet-200/80">{method.unit}</span>
        </div>
        <p className="mt-2 text-[12px] text-violet-100/45">
          Введите сумму для пополнения.
        </p>
        {rubPreview !== null && (
          <p className="mt-1 text-[12px] text-violet-200/80">
            ≈ {formatPrice(rubPreview)} на баланс
          </p>
        )}

        <button
          type="button"
          disabled={!isValid}
          onClick={() => {
            if (!isValid) return;
            const rub = method.unit === "⭐" ? Math.round(parsed * STARS_TO_RUB) : Math.round(parsed);
            onTopUp(rub);
          }}
          className={`mt-5 w-full rounded-2xl px-5 py-4 text-base font-semibold transition ${
            isValid
              ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 text-white shadow-[0_12px_36px_rgba(168,85,247,0.4)] active:scale-[0.99]"
              : "cursor-not-allowed border border-white/10 bg-white/5 text-violet-100/40"
          }`}
        >
          Пополнить через {method.title}
        </button>
      </SectionCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// СТРАНИЦА ПРОФИЛЯ
// ════════════════════════════════════════════════════════════════════════════
function ProfilePage({
  user,
  avatarLetter,
  balance,
  ordersCount,
  isAdmin,
  onGoBalance,
  onGoOrders,
  onGoAdmin,
}: {
  user: TelegramUser;
  avatarLetter: string;
  balance: number;
  ordersCount: number;
  isAdmin: boolean;
  onGoBalance: () => void;
  onGoOrders: () => void;
  onGoAdmin: () => void;
}) {
  return (
    <div className="space-y-5">
      <SectionCard className="text-center">
        {user.photo_url ? (
          <img
            src={user.photo_url}
            alt={user.first_name || "YUKI user"}
            className="mx-auto h-24 w-24 rounded-full border-4 border-violet-400/25 object-cover shadow-[0_0_40px_rgba(168,85,247,0.22)]"
          />
        ) : (
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-3xl font-black shadow-[0_0_40px_rgba(168,85,247,0.25)]">
            {avatarLetter}
          </div>
        )}
        <h2 className="mt-4 text-3xl font-semibold text-white">
          {user.first_name || "Пользователь YUKI"}
        </h2>
        <div className="mt-2 text-sm text-violet-100/55">@{user.username || "yuki_soft_user"}</div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <button
            type="button"
            onClick={onGoBalance}
            className="rounded-[24px] border border-white/10 bg-white/5 p-4 transition active:scale-95"
          >
            <div className="text-[11px] uppercase tracking-[0.28em] text-violet-100/45">
              Баланс
            </div>
            <div className="mt-2 text-xl font-semibold text-white">{formatPrice(balance)}</div>
          </button>
          <button
            type="button"
            onClick={onGoOrders}
            className="rounded-[24px] border border-white/10 bg-white/5 p-4 transition active:scale-95"
          >
            <div className="text-[11px] uppercase tracking-[0.28em] text-violet-100/45">
              Заказов
            </div>
            <div className="mt-2 text-xl font-semibold text-white">{ordersCount}</div>
          </button>
        </div>
      </SectionCard>

      {isAdmin && (
        <button
          type="button"
          onClick={onGoAdmin}
          className="block w-full rounded-[24px] border border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/25 to-violet-500/20 p-4 text-left shadow-[0_0_30px_rgba(232,121,249,0.2)]"
        >
          <div className="text-[11px] uppercase tracking-[0.28em] text-fuchsia-200">
            Только для тебя
          </div>
          <div className="mt-2 text-xl font-semibold text-white">⚡ Открыть админ-панель</div>
          <div className="mt-1 text-xs text-violet-100/65">
            Управление заказами в обработке
          </div>
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// АДМИН-ПАНЕЛЬ
// ════════════════════════════════════════════════════════════════════════════
function AdminPage({
  orders,
  onApprove,
  onReject,
}: {
  orders: OrderItem[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const pending = orders.filter((o) => o.status === "pending");
  const completed = orders.filter((o) => o.status === "completed");

  // Статистика
  const totalOrdersCount = orders.length;
  const completedRevenue = completed.reduce((sum, o) => sum + o.total, 0);
  const pendingAmount = pending.reduce((sum, o) => sum + o.total, 0);
  const uniqueUsers = new Set(orders.map((o) => o.username.toLowerCase())).size;

  return (
    <div className="space-y-5">
      <SectionCard className="bg-[linear-gradient(135deg,rgba(232,121,249,0.18),rgba(99,102,241,0.12))]">
        <p className="text-xs uppercase tracking-[0.35em] text-fuchsia-200/80">YUKI · admin</p>
        <h2 className="mt-3 text-3xl font-semibold text-white">Админ-панель</h2>
        <p className="mt-2 text-sm leading-6 text-violet-100/70">
          Управление заказами. Принимай или отклоняй после проверки реквизитов.
        </p>
      </SectionCard>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-3">
        <SectionCard className="p-4">
          <div className="text-[10px] uppercase tracking-[0.25em] text-violet-200/55">
            Всего заказов
          </div>
          <div className="mt-2 text-2xl font-black text-white">{totalOrdersCount}</div>
          <div className="mt-1 text-[11px] text-violet-100/55">
            от {uniqueUsers} {uniqueUsers === 1 ? "юзера" : "юзеров"}
          </div>
        </SectionCard>

        <SectionCard className="p-4">
          <div className="text-[10px] uppercase tracking-[0.25em] text-violet-200/55">
            Выручка
          </div>
          <div className="mt-2 text-2xl font-black text-fuchsia-300">
            {formatPrice(completedRevenue)}
          </div>
          <div className="mt-1 text-[11px] text-violet-100/55">
            {completed.length} {completed.length === 1 ? "выполнен" : "выполнено"}
          </div>
        </SectionCard>

        <SectionCard className="col-span-2 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(232,121,249,0.10))] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
                В обработке
              </div>
              <div className="mt-2 text-2xl font-black text-white">{pending.length}</div>
              <div className="mt-1 text-[11px] text-violet-100/55">
                ждут подтверждения
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
                Сумма
              </div>
              <div className="mt-2 text-2xl font-black text-amber-200">
                {formatPrice(pendingAmount)}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {pending.length === 0 ? (
        <SectionCard className="text-center text-violet-100/60">
          Нет заказов в обработке
        </SectionCard>
      ) : (
        pending.map((o) => {
          const m = payMethods.find((mm) => mm.id === o.method);
          return (
            <SectionCard key={o.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-violet-100/55">@{o.username}</div>
                  <div className="mt-1 text-base font-semibold text-white">
                    Заказ #{o.id.toString().slice(-6)}
                  </div>
                  <div className="mt-1 text-xs text-violet-100/55">
                    {new Date(o.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white">
                  {formatPrice(o.total)}
                </div>
              </div>

              <div className="mt-3 space-y-1 text-sm text-violet-100/70">
                {o.items.map((it, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {it.title} — {it.tariffTitle} × {it.qty}
                    </span>
                    <span className="text-white">{formatPrice(it.price * it.qty)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-violet-100/55">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                  {m?.title}
                </span>
                {o.cryptoKind && (
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                    {cryptoKinds.find((c) => c.id === o.cryptoKind)?.symbol}
                  </span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onReject(o.id)}
                  className="rounded-2xl border border-red-400/30 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 active:scale-95"
                >
                  Отклонить
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(o.id)}
                  className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(168,85,247,0.4)] active:scale-95"
                >
                  Принять
                </button>
              </div>
            </SectionCard>
          );
        })
      )}
    </div>
  );
}
