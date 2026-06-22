import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createOrder as apiCreateOrder,
  fetchOrders as apiFetchOrders,
  pingApi,
  resetAllOrders as apiResetAllOrders,
  resetTestOrders as apiResetTestOrders,
  updateOrderStatus as apiUpdateOrderStatus,
} from "./api";
import { cn } from "./utils/cn";

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
  | "minecraft"
  | "fortnite"
  | "ios"
  | "telegram"
  | "microsoft"
  | "apple"
  | "google"
  | "ai"
  | "vpn"
  | "subscriptions"
  | "accounts"
  | "digital-cards";
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
  kind?: "order" | "topup";
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
const formatPrice = (value: number) => `${money.format(Math.round(value))} ₽`;

const STARS_TO_RUB = 1.6; // фоллбэк-курс, если парсинг xvestor не сработал

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

// 💬 Ссылка на поддержку
const SUPPORT_URL = "";

// 💳 Реквизиты для оплаты
const PAYMENT_TRANSFER_PHONE_NUMBER = "+7 (900) 000-00-00";
const PAYMENT_CRYPTOBOT_REQUISITE = "@CryptoBot";
const PAYMENT_STARS_REQUISITE = "Telegram Stars invoice";
const PAYMENT_CRYPTO_ADDRESSES: Record<CryptoKindId, string> = {
  btc: "BTC_ADDRESS_HERE",
  ton: "TON_ADDRESS_HERE",
  usdt: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
};
const PAYMENT_CRYPTO_NETWORKS: Record<CryptoKindId, string> = {
  btc: "Bitcoin network",
  ton: "TON network",
  usdt: "USDT network",
};
const PAYMENT_TIMER_SECONDS = 10 * 60; // 10 минут

// Лимиты пополнения (в рублях)
const TOPUP_LIMIT_STANDARD = 700; // перевод, звёзды
const TOPUP_LIMIT_CRYPTO = 1500; // криптобот, крипта
const TOPUP_ORDER_TITLE = "Пополнение баланса";

// ════════════════════════════════════════════════════════════════════════════
// КАТЕГОРИИ (iconUrl — место под твои PNG-иконки)
// ════════════════════════════════════════════════════════════════════════════
const categories: {
  id: CategoryId;
  title: string;
  short: string;
  icon: string;
  iconUrl: string; // ← вставь сюда прямую ссылку на PNG-иконку
}[] = [
  { id: "all", title: "YUKI Soft", short: "Все товары", icon: "✦", iconUrl: "" },
  { id: "standoff2", title: "Standoff 2", short: "Игровой софт", icon: "🎯", iconUrl: "" },
  { id: "cs2", title: "CS2", short: "Конфиги и утилиты", icon: "⚡", iconUrl: "" },
  { id: "valorant", title: "Valorant", short: "Настройки и наборы", icon: "💎", iconUrl: "" },
  { id: "brawlstars", title: "Brawl Stars", short: "Мобильные товары", icon: "🌟", iconUrl: "" },
  { id: "minecraft", title: "Minecraft", short: "Серверы и ресурсы", icon: "⛏️", iconUrl: "" },
  { id: "fortnite", title: "Fortnite", short: "Карты и подписки", icon: "🔫", iconUrl: "" },
  { id: "ios", title: "iOS / подписи", short: "Сертификаты", icon: "📱", iconUrl: "" },
  { id: "telegram", title: "Telegram", short: "Premium, Stars", icon: "✈️", iconUrl: "" },
  { id: "microsoft", title: "Microsoft", short: "Windows, Office", icon: "🪟", iconUrl: "" },
  { id: "apple", title: "Apple", short: "Apple ID, iCloud", icon: "🍏", iconUrl: "" },
  { id: "google", title: "Google", short: "Play, One, Gmail", icon: "🔎", iconUrl: "" },
  { id: "ai", title: "AI / нейросети", short: "ChatGPT, Claude", icon: "🧠", iconUrl: "" },
  { id: "vpn", title: "VPN / прокси", short: "Доступ и приватность", icon: "🔒", iconUrl: "" },
  { id: "subscriptions", title: "Подписки", short: "Nitro, сервисы", icon: "⭐", iconUrl: "" },
  { id: "accounts", title: "Аккаунты", short: "Настройка и защита", icon: "👤", iconUrl: "" },
  { id: "digital-cards", title: "Цифровые карты", short: "Gift, Steam, Play", icon: "💳", iconUrl: "" },
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
    image: "/images/products/standoff-yuki-ipa.svg",
    video: "", // ← вставь сюда ссылку на MP4
    note: "После покупки вы получите iPA файл + ключ софта (инструкции по установке прилагаются). Также вы получите всю необходимую информацию по поводу обновлений.",
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
    id: "s2-config-kit",
    category: "standoff2",
    title: "Standoff 2 Config Kit",
    short: "Набор настроек и инструкций",
    description:
      "Комплект безопасных настроек, чеклист оптимизации и инструкция для комфортной игры на iOS.",
    image: "/images/products/standoff-config-kit.svg",
    video: "",
    note: "В набор входит инструкция, рекомендации по графике и готовый чеклист для устройства.",
    infoUrl: "",
    platform: "iOS",
    features: ["Настройки", "Чеклист", "iOS", "Гайд"],
    tariffs: [
      { id: "month", title: "Basic", subtitle: "набор", price: 250 },
      { id: "lifetime", title: "Full", subtitle: "расширенный", price: 590 },
    ],
  },
  {
    id: "cs2-performance-pack",
    category: "cs2",
    title: "CS2 Performance Pack",
    short: "FPS, графика, запуск",
    description:
      "Готовый набор легальных конфигов и параметров запуска для стабильного FPS и аккуратной графики.",
    image: "/images/products/cs2-performance-pack.svg",
    video: "",
    note: "Не вмешивается в игровые файлы. Вы получите файлы настроек и инструкцию.",
    infoUrl: "",
    platform: "Desktop",
    features: ["FPS", "Launch", "Config", "Guide"],
    tariffs: [
      { id: "month", title: "Standard", subtitle: "основной", price: 350 },
      { id: "lifetime", title: "Max", subtitle: "полный", price: 790 },
    ],
  },
  {
    id: "cs2-crosshair-pack",
    category: "cs2",
    title: "CS2 Crosshair Pack",
    short: "Пак прицелов и биндов",
    description:
      "Подборка прицелов, биндов и быстрых пресетов для разных ролей и разрешений.",
    image: "/images/products/cs2-crosshair-pack.svg",
    video: "",
    note: "После покупки вы получите кодовые пресеты и короткую инструкцию по установке.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Crosshair", "Binds", "Presets", "Guide"],
    tariffs: [
      { id: "trial", title: "Lite", subtitle: "10 прицелов", price: 190 },
      { id: "month", title: "Pro", subtitle: "40 прицелов", price: 390 },
    ],
  },
  {
    id: "valorant-performance-pack",
    category: "valorant",
    title: "Valorant Performance Pack",
    short: "Оптимизация и профили",
    description:
      "Набор профилей графики, рекомендаций по Windows и чеклист для стабильного FPS.",
    image: "/images/products/valorant-performance-pack.svg",
    video: "",
    note: "Без запрещённых функций. Только настройки, профили и инструкция.",
    infoUrl: "",
    platform: "Desktop",
    features: ["FPS", "Windows", "Profiles", "Guide"],
    tariffs: [
      { id: "month", title: "Standard", subtitle: "пак", price: 390 },
      { id: "lifetime", title: "Full", subtitle: "полный", price: 890 },
    ],
  },
  {
    id: "valorant-crosshair-pack",
    category: "valorant",
    title: "Valorant Crosshair Pack",
    short: "Прицелы и профили",
    description:
      "Подборка минималистичных прицелов, цветовых профилей и рекомендаций по чувствительности.",
    image: "/images/products/valorant-crosshair-pack.svg",
    video: "",
    note: "Выдаётся в виде списка кодов и короткого гайда.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Crosshair", "Sensitivity", "Colors", "Guide"],
    tariffs: [
      { id: "trial", title: "Mini", subtitle: "15 профилей", price: 150 },
      { id: "month", title: "Pro", subtitle: "50 профилей", price: 350 },
    ],
  },
  {
    id: "brawlstars-creator-kit",
    category: "brawlstars",
    title: "Brawl Stars Creator Kit",
    short: "Оформление и шаблоны",
    description:
      "Пак шаблонов для клипов, превью, иконок и оформления контента по Brawl Stars.",
    image: "/images/products/brawlstars-creator-kit.svg",
    video: "",
    note: "Подходит для Telegram, TikTok и YouTube Shorts. Файлы выдаются архивом.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Templates", "Preview", "Icons", "Archive"],
    tariffs: [
      { id: "month", title: "Basic", subtitle: "шаблоны", price: 290 },
      { id: "lifetime", title: "Creator", subtitle: "полный пак", price: 790 },
    ],
  },
  {
    id: "brawlstars-gems-card",
    category: "brawlstars",
    title: "Brawl Stars Gems Card",
    short: "Пополнение под запрос",
    description:
      "Помощь с подбором цифровой карты или способа пополнения для вашего региона.",
    image: "/images/products/brawlstars-gems-card.svg",
    video: "",
    note: "Перед оплатой уточни регион аккаунта и желаемый номинал.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Регион", "Карта", "Подарок", "Поддержка"],
    tariffs: [
      { id: "trial", title: "500 ₽", subtitle: "номинал", price: 550 },
      { id: "month", title: "1000 ₽", subtitle: "номинал", price: 1090 },
    ],
  },
  {
    id: "ios-cert-personal",
    category: "ios",
    title: "Сертификат iOS | Personal",
    short: "Личный сертификат подписи",
    description:
      "Персональный сертификат для подписи iOS-приложений. Стабильная работа, быстрая выдача после оплаты.",
    image: "/images/products/ios-cert-personal.svg",
    video: "",
    note: "После покупки вы получите инструкцию, данные сертификата и помощь с первым запуском.",
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
    image: "/images/products/ios-cert-business.svg",
    video: "",
    note: "Подходит для командных проектов. Перед покупкой можно уточнить ограничения и сроки выдачи в поддержке.",
    infoUrl: "",
    platform: "iOS",
    features: ["Enterprise", "Без лимитов", "Поддержка 24/7", "Гарантия"],
    tariffs: [
      { id: "month", title: "30 дней", subtitle: "Базовый", price: 1500 },
      { id: "lifetime", title: "365 дней", subtitle: "Годовой", price: 9900 },
    ],
  },
  {
    id: "minecraft-server-pack",
    category: "minecraft",
    title: "Minecraft Server Pack",
    short: "Сборка сервера под ключ",
    description:
      "Базовая сборка сервера: плагины, структура, настройки, права и инструкция по запуску.",
    image: "/images/products/minecraft-server-pack.svg",
    video: "",
    note: "После оплаты уточним версию Java/Bedrock и нужный формат сервера.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Plugins", "Setup", "Guide", "Support"],
    tariffs: [
      { id: "month", title: "Start", subtitle: "база", price: 690 },
      { id: "extended", title: "Pro", subtitle: "расширенный", price: 1490 },
    ],
  },
  {
    id: "minecraft-resource-pack",
    category: "minecraft",
    title: "Minecraft Resource Pack",
    short: "Ресурспак и оформление",
    description:
      "Готовые ресурспаки, иконки, оформление меню и визуальный стиль для сервера или сборки.",
    image: "/images/products/minecraft-resource-pack.svg",
    video: "",
    note: "Файлы выдаются архивом. Можно уточнить тематику перед оплатой.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Textures", "Icons", "Style", "Archive"],
    tariffs: [
      { id: "trial", title: "Mini", subtitle: "малый пак", price: 250 },
      { id: "month", title: "Pack", subtitle: "полный", price: 650 },
    ],
  },
  {
    id: "fortnite-vbucks-card",
    category: "fortnite",
    title: "Fortnite V-Bucks Card",
    short: "Цифровой номинал",
    description:
      "Подбор и выдача цифровой карты или кода для пополнения Fortnite под нужный регион.",
    image: "/images/products/fortnite-vbucks-card.svg",
    video: "",
    note: "Перед оплатой уточни регион аккаунта Epic Games.",
    infoUrl: "",
    platform: "Desktop",
    features: ["V-Bucks", "Code", "Region", "Gift"],
    tariffs: [
      { id: "month", title: "1000 V-Bucks", subtitle: "карта", price: 990 },
      { id: "extended", title: "2800 V-Bucks", subtitle: "карта", price: 2490 },
    ],
  },
  {
    id: "fortnite-crew",
    category: "fortnite",
    title: "Fortnite Crew",
    short: "Подписка Crew",
    description:
      "Помощь с оформлением Fortnite Crew или подарочного формата, если доступен для региона.",
    image: "/images/products/fortnite-crew.svg",
    video: "",
    note: "Формат выдачи зависит от региона. Перед оплатой можно уточнить в поддержке.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Crew", "Region", "Gift", "Support"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Crew", price: 1290 },
    ],
  },
  {
    id: "telegram-premium",
    category: "telegram",
    title: "Telegram Premium",
    short: "Премиум для аккаунта Telegram",
    description:
      "Оформление Telegram Premium на выбранный срок. Подходит для личного аккаунта или подарка.",
    image: "/images/products/telegram-premium.svg",
    video: "",
    note: "После оплаты заявка уйдёт на проверку. Для выдачи понадобится username получателя.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Premium", "Подарок", "Быстрая выдача", "Поддержка"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Старт", price: 399 },
      { id: "extended", title: "3 месяца", subtitle: "Выгодно", price: 1090 },
      { id: "lifetime", title: "12 месяцев", subtitle: "Год", price: 3990 },
    ],
  },
  {
    id: "telegram-stars-pack",
    category: "telegram",
    title: "Telegram Stars Pack",
    short: "Пакеты Stars для Telegram",
    description:
      "Пакеты Telegram Stars для подарков, контента и внутренних покупок в Telegram.",
    image: "/images/products/telegram-stars-pack.svg",
    video: "",
    note: "Укажи получателя после оплаты. Количество Stars зависит от выбранного тарифа.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Stars", "Подарок", "Telegram", "Выдача"],
    tariffs: [
      { id: "trial", title: "150 Stars", subtitle: "Мини", price: 240 },
      { id: "month", title: "500 Stars", subtitle: "Стандарт", price: 790 },
      { id: "extended", title: "1000 Stars", subtitle: "Больше", price: 1550 },
    ],
  },
  {
    id: "telegram-channel-starter",
    category: "telegram",
    title: "Telegram Channel Starter",
    short: "Настройка канала и бота",
    description:
      "Оформление базового Telegram-канала: аватар, описание, кнопки, структура постов и стартовый чеклист.",
    image: "/images/products/telegram-channel-starter.svg",
    video: "",
    note: "Для сложного брендинга и бота лучше написать в поддержку до оплаты.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Канал", "Бот", "Оформление", "Чеклист"],
    tariffs: [
      { id: "month", title: "Start", subtitle: "база", price: 690 },
      { id: "extended", title: "Pro", subtitle: "оформление", price: 1490 },
    ],
  },
  {
    id: "windows-key",
    category: "microsoft",
    title: "Windows Key",
    short: "Ключ активации Windows",
    description:
      "Цифровой ключ и инструкция по активации Windows для личного устройства.",
    image: "/images/products/windows-key.svg",
    video: "",
    note: "Перед оплатой уточни нужную редакцию и регион.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Windows", "Key", "Guide", "Support"],
    tariffs: [
      { id: "month", title: "Home", subtitle: "ключ", price: 890 },
      { id: "extended", title: "Pro", subtitle: "ключ", price: 1190 },
    ],
  },
  {
    id: "office-key",
    category: "microsoft",
    title: "Microsoft Office Key",
    short: "Ключ Office",
    description:
      "Ключ и инструкция для офисного пакета Microsoft Office под личное устройство.",
    image: "/images/products/office-key.svg",
    video: "",
    note: "Уточни нужную версию перед покупкой.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Office", "Key", "Activation", "Guide"],
    tariffs: [
      { id: "month", title: "Standard", subtitle: "ключ", price: 790 },
      { id: "extended", title: "Plus", subtitle: "ключ + помощь", price: 1190 },
    ],
  },
  {
    id: "apple-gift-card",
    category: "apple",
    title: "Apple Gift Card",
    short: "Подарочная карта Apple",
    description:
      "Цифровая карта Apple под нужный регион для покупок и подписок.",
    image: "/images/products/apple-gift-card.svg",
    video: "",
    note: "Перед оплатой обязательно уточни регион Apple ID.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Apple", "Gift", "Region", "Code"],
    tariffs: [
      { id: "month", title: "10$", subtitle: "карта", price: 1090 },
      { id: "extended", title: "25$", subtitle: "карта", price: 2690 },
    ],
  },
  {
    id: "icloud-plus",
    category: "apple",
    title: "iCloud+ Setup",
    short: "Подписка и настройка iCloud",
    description:
      "Помощь с подбором тарифа iCloud+, настройкой хранилища и базовой безопасностью Apple ID.",
    image: "/images/products/icloud-plus.svg",
    video: "",
    note: "Не передавай пароль в чат. Дадим инструкцию и проведём по шагам.",
    infoUrl: "",
    platform: "iOS",
    features: ["iCloud", "Storage", "Security", "Guide"],
    tariffs: [
      { id: "month", title: "Setup", subtitle: "настройка", price: 390 },
      { id: "extended", title: "Setup+", subtitle: "сопровождение", price: 790 },
    ],
  },
  {
    id: "google-play-card",
    category: "google",
    title: "Google Play Card",
    short: "Подарочная карта Google",
    description:
      "Цифровая карта Google Play под нужный регион для приложений, игр и подписок.",
    image: "/images/products/google-play-card.svg",
    video: "",
    note: "Перед покупкой уточни страну аккаунта Google.",
    infoUrl: "",
    platform: "Android",
    features: ["Google Play", "Code", "Region", "Gift"],
    tariffs: [
      { id: "month", title: "10$", subtitle: "карта", price: 1090 },
      { id: "extended", title: "25$", subtitle: "карта", price: 2690 },
    ],
  },
  {
    id: "google-one",
    category: "google",
    title: "Google One Setup",
    short: "Хранилище и настройка",
    description:
      "Помощь с настройкой Google One, хранилища, резервных копий и семейного доступа.",
    image: "/images/products/google-one.svg",
    video: "",
    note: "Не просим пароль. Работаем через пошаговую инструкцию.",
    infoUrl: "",
    platform: "Android",
    features: ["Cloud", "Backup", "Family", "Guide"],
    tariffs: [
      { id: "month", title: "Setup", subtitle: "настройка", price: 390 },
      { id: "extended", title: "Setup+", subtitle: "сопровождение", price: 790 },
    ],
  },
  {
    id: "chatgpt-plus-access",
    category: "ai",
    title: "ChatGPT Plus Access",
    short: "AI-подписка для работы",
    description:
      "Помощь с доступом к AI-инструментам для учёбы, работы, кода, текстов и автоматизации.",
    image: "/images/products/chatgpt-plus-access.svg",
    video: "",
    note: "Перед покупкой уточни доступность сервиса и формат выдачи. Региональные ограничения могут отличаться.",
    infoUrl: "",
    platform: "Desktop",
    features: ["AI", "Тексты", "Код", "Работа"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Plus", price: 1990 },
      { id: "extended", title: "3 месяца", subtitle: "Plus", price: 5490 },
    ],
  },
  {
    id: "claude-pro-access",
    category: "ai",
    title: "Claude Pro Access",
    short: "AI для текстов и анализа",
    description:
      "Помощь с доступом к Claude Pro для больших текстов, документов, анализа и рабочих задач.",
    image: "/images/products/claude-pro-access.svg",
    video: "",
    note: "Формат выдачи и доступность уточняются перед покупкой.",
    infoUrl: "",
    platform: "Desktop",
    features: ["AI", "Docs", "Analysis", "Work"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Pro", price: 1990 },
      { id: "extended", title: "3 месяца", subtitle: "Pro", price: 5490 },
    ],
  },
  {
    id: "midjourney-plan",
    category: "ai",
    title: "Midjourney Plan",
    short: "Генерация изображений",
    description:
      "Доступ к AI-генерации изображений для аватарок, обложек, концептов и визуалов магазина.",
    image: "/images/products/midjourney-plan.svg",
    video: "",
    note: "После оплаты уточним формат доступа и нужный план. Можно заказать вместе с дизайном авы.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Images", "AI", "Design", "Concept"],
    tariffs: [
      { id: "month", title: "Basic", subtitle: "1 месяц", price: 1290 },
      { id: "extended", title: "Standard", subtitle: "1 месяц", price: 2490 },
    ],
  },
  {
    id: "perplexity-pro",
    category: "ai",
    title: "Perplexity Pro",
    short: "AI-поиск и ресёрч",
    description:
      "Помощь с доступом к AI-поиску для учёбы, ресёрча, документов и рабочих задач.",
    image: "/images/products/perplexity-pro.svg",
    video: "",
    note: "Перед покупкой уточни формат доступа и срок.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Research", "AI", "Search", "Docs"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Pro", price: 1490 },
      { id: "extended", title: "3 месяца", subtitle: "Pro", price: 3990 },
    ],
  },
  {
    id: "wireguard-vpn",
    category: "vpn",
    title: "WireGuard VPN",
    short: "VPN-ключ и инструкция",
    description:
      "VPN-ключ для личного устройства, инструкция по установке и рекомендации по безопасному использованию.",
    image: "/images/products/wireguard-vpn.svg",
    video: "",
    note: "После покупки вы получите данные подключения и инструкцию для вашего устройства.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["WireGuard", "Key", "Guide", "Support"],
    tariffs: [
      { id: "month", title: "30 дней", subtitle: "1 устройство", price: 350 },
      { id: "extended", title: "90 дней", subtitle: "1 устройство", price: 890 },
      { id: "lifetime", title: "365 дней", subtitle: "год", price: 2490 },
    ],
  },
  {
    id: "residential-proxy",
    category: "vpn",
    title: "Residential Proxy Pack",
    short: "Прокси под задачи",
    description:
      "Подбор прокси под конкретную задачу: доступ, тесты, работа с сервисами и приватность.",
    image: "/images/products/residential-proxy.svg",
    video: "",
    note: "Перед оплатой уточни страну, срок и нужный тип прокси.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Proxy", "Region", "Setup", "Support"],
    tariffs: [
      { id: "trial", title: "1 день", subtitle: "тест", price: 150 },
      { id: "month", title: "30 дней", subtitle: "пак", price: 790 },
    ],
  },
  {
    id: "discord-nitro",
    category: "subscriptions",
    title: "Discord Nitro",
    short: "Подписка Nitro",
    description:
      "Оформление Discord Nitro на аккаунт. Подходит для личного профиля или подарка другу.",
    image: "/images/products/discord-nitro.svg",
    video: "",
    note: "После оплаты понадобится Discord username или gift-формат, если он доступен.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Nitro", "Подарок", "Аккаунт", "Поддержка"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Nitro", price: 690 },
      { id: "extended", title: "3 месяца", subtitle: "Nitro", price: 1890 },
    ],
  },
  {
    id: "spotify-premium",
    category: "subscriptions",
    title: "Spotify Premium",
    short: "Музыкальная подписка",
    description:
      "Помощь с оформлением музыкальной подписки под регион и нужный срок.",
    image: "/images/products/spotify-premium.svg",
    video: "",
    note: "Перед оплатой уточни аккаунт и регион.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Music", "Premium", "Region", "Support"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Premium", price: 390 },
      { id: "extended", title: "3 месяца", subtitle: "Premium", price: 990 },
    ],
  },
  {
    id: "youtube-premium",
    category: "subscriptions",
    title: "YouTube Premium",
    short: "Видео и музыка без рекламы",
    description:
      "Помощь с оформлением YouTube Premium или семейного доступа под подходящий регион.",
    image: "/images/products/youtube-premium.svg",
    video: "",
    note: "Формат зависит от региона аккаунта Google.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["YouTube", "Music", "Family", "Region"],
    tariffs: [
      { id: "month", title: "1 месяц", subtitle: "Premium", price: 490 },
      { id: "extended", title: "3 месяца", subtitle: "Premium", price: 1290 },
    ],
  },
  {
    id: "account-starter-pack",
    category: "accounts",
    title: "Account Starter Pack",
    short: "Google / Apple / Microsoft",
    description:
      "Помощь с подготовкой аккаунта: базовая настройка, безопасность, резервные данные и рекомендации.",
    image: "/images/products/account-starter-pack.svg",
    video: "",
    note: "Не продаём украденные аккаунты. Только легальная помощь с настройкой и сопровождением.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Настройка", "Безопасность", "Резерв", "Гайд"],
    tariffs: [
      { id: "month", title: "Basic", subtitle: "1 аккаунт", price: 390 },
      { id: "extended", title: "Family", subtitle: "до 3 аккаунтов", price: 990 },
    ],
  },
  {
    id: "secure-mail-pack",
    category: "accounts",
    title: "Secure Mail Pack",
    short: "Почта и безопасность",
    description:
      "Настройка резервной почты, 2FA, восстановления и чеклист безопасности для аккаунтов.",
    image: "/images/products/secure-mail-pack.svg",
    video: "",
    note: "Пароли не передаются в чат. Работаем через инструкцию и сопровождение.",
    infoUrl: "",
    platform: "Desktop",
    features: ["2FA", "Mail", "Recovery", "Checklist"],
    tariffs: [
      { id: "month", title: "Basic", subtitle: "1 аккаунт", price: 290 },
      { id: "extended", title: "Pack", subtitle: "до 3 аккаунтов", price: 690 },
    ],
  },
  {
    id: "virtual-card",
    category: "digital-cards",
    title: "Virtual Card Setup",
    short: "Виртуальная карта под сервисы",
    description:
      "Помощь с подбором и настройкой виртуальной карты для цифровых сервисов и подписок.",
    image: "/images/products/virtual-card.svg",
    video: "",
    note: "Перед покупкой уточни сервис, регион и валюту.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Card", "Region", "Setup", "Support"],
    tariffs: [
      { id: "month", title: "Setup", subtitle: "настройка", price: 590 },
      { id: "extended", title: "Setup+", subtitle: "сопровождение", price: 990 },
    ],
  },
  {
    id: "gift-card-bundle",
    category: "digital-cards",
    title: "Gift Card Bundle",
    short: "Подарочные карты",
    description:
      "Подбор подарочной карты под нужный сервис: Apple, Google, Steam, Xbox, PlayStation и другие.",
    image: "/images/products/gift-card-bundle.svg",
    video: "",
    note: "Перед оплатой уточни сервис, регион и номинал.",
    infoUrl: "",
    platform: "iOS/Android",
    features: ["Gift", "Region", "Code", "Support"],
    tariffs: [
      { id: "trial", title: "500 ₽", subtitle: "номинал", price: 550 },
      { id: "month", title: "1000 ₽", subtitle: "номинал", price: 1090 },
      { id: "extended", title: "2500 ₽", subtitle: "номинал", price: 2690 },
    ],
  },
  {
    id: "steam-wallet-card",
    category: "digital-cards",
    title: "Steam Wallet Card",
    short: "Пополнение Steam",
    description:
      "Цифровой номинал или помощь с пополнением Steam Wallet под регион аккаунта.",
    image: "/images/products/steam-wallet-card.svg",
    video: "",
    note: "Перед оплатой уточни регион Steam.",
    infoUrl: "",
    platform: "Desktop",
    features: ["Steam", "Wallet", "Region", "Gift"],
    tariffs: [
      { id: "trial", title: "500 ₽", subtitle: "wallet", price: 550 },
      { id: "month", title: "1000 ₽", subtitle: "wallet", price: 1090 },
      { id: "extended", title: "2500 ₽", subtitle: "wallet", price: 2690 },
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
// КРИПТО-ВАЛЮТЫ
// ════════════════════════════════════════════════════════════════════════════
type CryptoKindId = "btc" | "ton" | "usdt";

type CryptoKind = {
  id: CryptoKindId;
  title: string;
  symbol: string;
  logo: string; // ← вставь сюда прямую ссылку на лого
  coingeckoId: string;
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

const CART_ICON_URL = "https://i.ibb.co/Lz9rtkKw/5-E583-D59-B90-B-446-B-8037-426157-B97-B51.png";

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
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-white/10 bg-[#130d27] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl",
        className,
      )}
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
  if (icon === "cart") {
    if (CART_ICON_URL) {
      return (
        <img
          src={CART_ICON_URL}
          alt=""
          className={`h-8 w-8 object-contain transition ${active ? "opacity-100" : "opacity-70"}`}
        />
      );
    }
    return <span className="text-[28px] leading-none">🛒</span>;
  }
  return <span className="text-[24px] leading-none">{icon}</span>;
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

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const isTopUpOrder = (order: Pick<OrderItem, "kind" | "items">) =>
  order.kind === "topup" || order.items[0]?.title === TOPUP_ORDER_TITLE;

const getOrderTitle = (order: OrderItem) => {
  if (isTopUpOrder(order)) return TOPUP_ORDER_TITLE;
  return order.items[0]?.title || "Заказ";
};

// ════════════════════════════════════════════════════════════════════════════
// ХУК парсинга курса крипты (CoinGecko)
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
        if (typeof rate === "number" && rate > 0) setRubPerUnit(rate);
        else setError("Не удалось получить курс");
      })
      .catch(() => setError("Сеть недоступна"))
      .finally(() => setLoading(false));
  }, [coinId]);

  return { rubPerUnit, loading, error };
}

// ════════════════════════════════════════════════════════════════════════════
// ХУК парсинга курса TG Stars (xvestor.ru)
// ════════════════════════════════════════════════════════════════════════════
function useStarsRate() {
  const [rubPerStar, setRubPerStar] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Пробуем xvestor, при неудаче — фоллбэк
    fetch("https://xvestor.ru/converter/tgstars/rub")
      .then(async (r) => {
        const text = await r.text();
        // Ищем число вида 1.6 в тексте (примерный парсинг)
        const m = text.match(/(?:1,\d+|1\.\d+)/);
        if (m && !cancelled) {
          const v = parseFloat(m[0].replace(",", "."));
          if (v > 0) setRubPerStar(v);
          else setRubPerStar(STARS_TO_RUB);
        } else if (!cancelled) {
          setRubPerStar(STARS_TO_RUB);
        }
      })
      .catch(() => {
        if (!cancelled) setRubPerStar(STARS_TO_RUB);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rubPerStar, loading, error };
}

// ════════════════════════════════════════════════════════════════════════════
// ОСНОВНОЙ КОМПОНЕНТ
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("catalog");
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("all");
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Payment flow (для корзины и для пополнения)
  const [paymentFlow, setPaymentFlow] = useState<{
    method: PayMethodId;
    amount: number;
    cryptoKind?: CryptoKindId;
    stage: "crypto-choose" | "address" | "waiting" | "failed";
    orderId?: number;
    kind: "order" | "topup";
    source?: "cart" | "direct";
    items?: OrderItem["items"];
  } | null>(null);

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem("yuki_welcome_dismissed");
  });
  const [welcomeDontShow, setWelcomeDontShow] = useState(false);

  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const s = window.localStorage.getItem("yuki_cart_pending");
      return s ? (JSON.parse(s) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  // Заказы не храним в localStorage: источник правды только Worker + Cloudflare KV.
  const [orders, setOrders] = useState<OrderItem[]>([]);

  const [balance, setBalance] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const saved = window.localStorage.getItem("yuki_balance_rub");
    if (saved !== null) {
      const p = Number(saved);
      return Number.isFinite(p) ? p : 0;
    }
    return 0;
  });

  const [topUpAmount, setTopUpAmount] = useState("");
  const [selectedPayMethod, setSelectedPayMethod] = useState<PayMethodId>("sbp");
  const [directBuy, setDirectBuy] = useState<{ product: Product; tariff: Tariff } | null>(null);

  const [user, setUser] = useState<TelegramUser>({ first_name: "YUKI user", username: "" });

  const [noFundsModal, setNoFundsModal] = useState<{ needed: number; title: string } | null>(null);

  const [viewOrderId, setViewOrderId] = useState<number | null>(null);
  const [showSupport, setShowSupport] = useState(false);

  const [apiReady, setApiReady] = useState(false);

  const [giftModal, setGiftModal] = useState<{
    message: string;
    balance: number;
  } | null>(null);

  // Сброс заказов (для тестовых юзеров) — показываем модалку подтверждения
  const [resetOrdersConfirm, setResetOrdersConfirm] = useState(false);
  const [resetAllOrdersConfirm, setResetAllOrdersConfirm] = useState(false);

  const mainRef = useRef<HTMLElement | null>(null);
  const pageKey = `${activeTab}|${openedProductId ?? ""}|${paymentFlow?.stage ?? ""}|${viewOrderId ?? ""}`;

  const scrollToContentTop = (behavior: ScrollBehavior = "auto") => {
    if (mainRef.current) mainRef.current.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  useEffect(() => {
    scrollToContentTop("auto");
    const raf = window.requestAnimationFrame(() => scrollToContentTop("auto"));
    const t = window.setTimeout(() => scrollToContentTop("auto"), 80);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [pageKey]);

  useEffect(() => {
    window.localStorage.setItem("yuki_balance_rub", String(balance));
  }, [balance]);
  useEffect(() => {
    window.localStorage.setItem("yuki_cart_pending", JSON.stringify(cart));
  }, [cart]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await pingApi();
      if (cancelled) return;
      setApiReady(ok);
      if (!ok) return;
      const fresh = await apiFetchOrders(user.username || "guest", isAdmin);
      if (!cancelled && fresh) setOrders(fresh as OrderItem[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.username, isAdmin]);

  useEffect(() => {
    if (!apiReady) return;
    const t = window.setInterval(async () => {
      const fresh = await apiFetchOrders(user.username || "guest", isAdmin);
      if (fresh) setOrders(fresh as OrderItem[]);
    }, 10000);
    return () => window.clearInterval(t);
  }, [apiReady, user.username, isAdmin]);

  const visibleProducts = useMemo(() => {
    if (selectedCategory === "all") return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  const openedProduct = useMemo(
    () => products.find((p) => p.id === openedProductId) ?? null,
    [openedProductId],
  );

  const userOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.username.toLowerCase() === (user.username || "guest").toLowerCase(),
      ),
    [orders, user.username],
  );

  const userTopUpPayments = useMemo(
    () => userOrders.filter(isTopUpOrder),
    [userOrders],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const username = (user.username || "guest").toLowerCase();
    if (!username) return;

    const key = `yuki_credited_topups_${username}`;
    let creditedIds: string[] = [];
    try {
      creditedIds = JSON.parse(window.localStorage.getItem(key) || "[]") as string[];
    } catch {
      creditedIds = [];
    }

    const credited = new Set(creditedIds);
    const readyTopUps = orders.filter(
      (order) =>
        isTopUpOrder(order) &&
        order.status === "completed" &&
        order.username.toLowerCase() === username &&
        !credited.has(String(order.id)),
    );

    if (readyTopUps.length === 0) return;

    const amount = readyTopUps.reduce((sum, order) => sum + order.total, 0);
    readyTopUps.forEach((order) => credited.add(String(order.id)));
    window.localStorage.setItem(key, JSON.stringify([...credited]));
    setBalance((prev) => prev + amount);
    setNotice(`Баланс пополнен на ${formatPrice(amount)}`);
  }, [orders, user.username]);

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const avatarLetter = (user.first_name || "Y").trim().charAt(0).toUpperCase();

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

  // Старт оплаты корзины
  const startCheckout = (method: PayMethodId) => {
    if (cart.length === 0) return;
    vibrate("medium");
    const items = cart.map((i) => ({
      title: i.title,
      tariffTitle: i.tariffTitle,
      qty: i.qty,
      price: i.price,
    }));
    if (method === "crypto") {
      setPaymentFlow({ method, amount: cartTotal, stage: "crypto-choose", kind: "order", source: "cart", items });
    } else {
      setPaymentFlow({ method, amount: cartTotal, stage: "address", kind: "order", source: "cart", items });
    }
  };

  const startDirectCheckout = (product: Product, tariff: Tariff) => {
    vibrate("medium");
    const items = [
      {
        title: product.title,
        tariffTitle: tariff.title,
        qty: 1,
        price: tariff.price,
      },
    ];
    const stage = selectedPayMethod === "crypto" ? "crypto-choose" : "address";
    setDirectBuy(null);
    setPaymentFlow({
      method: selectedPayMethod,
      amount: tariff.price,
      stage,
      kind: "order",
      source: "direct",
      items,
    });
  };

  // Юзер нажал "Я оплатил" (корзина)
  const handleIPaid = async () => {
    if (!paymentFlow) return;
    vibrate("medium");
    const baseOrder: OrderItem = {
      id: Date.now(),
      createdAt: Date.now(),
      username: user.username || "guest",
      items:
        paymentFlow.items ??
        cart.map((i) => ({
          title: i.title,
          tariffTitle: i.tariffTitle,
          qty: i.qty,
          price: i.price,
        })),
      total: paymentFlow.amount,
      method: paymentFlow.method,
      cryptoKind: paymentFlow.cryptoKind,
      status: "pending",
      kind: "order",
    };

    if (!apiReady) {
      setNotice("KV API недоступен. Заказ не сохранён, попробуй позже.");
      return;
    }

    const created = await apiCreateOrder(user.username || "guest", {
      username: user.username || "guest",
      items: baseOrder.items,
      total: baseOrder.total,
      method: baseOrder.method,
      cryptoKind: baseOrder.cryptoKind,
      kind: "order",
    });

    if (!created) {
      setNotice("Не удалось записать заказ в Cloudflare KV");
      return;
    }

    setOrders((prev) => [created as OrderItem, ...prev]);
    if (paymentFlow.source !== "direct") setCart([]);
    setPaymentFlow({ ...paymentFlow, stage: "waiting", orderId: created.id });
  };

  // Оплата пополнения — юзер нажал "Я оплатил"
  const handleTopUpIPaid = async () => {
    if (!paymentFlow) return;
    vibrate("medium");
    const topUpOrder: OrderItem = {
      id: Date.now(),
      createdAt: Date.now(),
      username: user.username || "guest",
      items: [
        {
          title: TOPUP_ORDER_TITLE,
          tariffTitle: payMethods.find((m) => m.id === paymentFlow.method)?.title || "Пополнение",
          qty: 1,
          price: paymentFlow.amount,
        },
      ],
      total: paymentFlow.amount,
      method: paymentFlow.method,
      cryptoKind: paymentFlow.cryptoKind,
      status: "pending",
      kind: "topup",
    };

    if (!apiReady) {
      setNotice("KV API недоступен. Заявка на пополнение не сохранена.");
      return;
    }

    const created = await apiCreateOrder(user.username || "guest", {
      username: user.username || "guest",
      items: topUpOrder.items,
      total: topUpOrder.total,
      method: topUpOrder.method,
      cryptoKind: topUpOrder.cryptoKind,
      kind: "topup",
    });

    if (!created) {
      setNotice("Не удалось записать пополнение в Cloudflare KV");
      return;
    }

    setOrders((prev) => [created as OrderItem, ...prev]);
    setTopUpAmount("");
    setPaymentFlow({ ...paymentFlow, stage: "waiting", orderId: created.id });
  };

  // Админка: принять/отклонить заказ
  const adminUpdateOrder = async (id: number, status: OrderStatus) => {
    vibrate("medium");
    if (!apiReady) {
      setNotice("KV API недоступен. Статус не изменён.");
      return;
    }

    const updated = await apiUpdateOrderStatus(user.username || "", id, status);
    if (!updated) {
      setNotice("Не удалось обновить статус в Cloudflare KV");
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === id ? (updated as OrderItem) : o)));
    setNotice(
      status === "completed"
        ? "Платёж помечен как выполненный"
        : status === "failed"
          ? "Платёж помечен как ошибка"
          : "Платёж в обработке",
    );
  };

  // Сброс заказов для тестовых юзеров
  const handleResetTestOrders = async () => {
    vibrate("medium");
    if (!apiReady) {
      setNotice("KV API недоступен. Сброс невозможен.");
      return;
    }

    const removed = await apiResetTestOrders(user.username || "");
    if (removed === null) {
      setNotice("Не удалось сбросить тестовые заказы в Cloudflare KV");
      return;
    }

    const fresh = await apiFetchOrders(user.username || "", isAdmin);
    if (fresh) setOrders(fresh as OrderItem[]);
    setResetOrdersConfirm(false);
    setNotice(`Сброшено тестовых заявок: ${removed}`);
  };

  const handleResetAllOrders = async () => {
    vibrate("heavy");
    if (!apiReady) {
      setNotice("KV API недоступен. Полный сброс невозможен.");
      return;
    }

    const removed = await apiResetAllOrders(user.username || "");
    if (removed === null) {
      setNotice("Не удалось сбросить все заказы в Cloudflare KV");
      return;
    }

    setOrders([]);
    setResetAllOrdersConfirm(false);
    setNotice(`Полностью сброшено заказов: ${removed}`);
  };

  // ════════════════════════════════════════════════════════════════════════
  // РЕНДЕР
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#05010d] text-white">
      <style>{`
        @keyframes yukiPulse {
          0%, 100% { transform: scale(1); opacity: 0.55; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
        @keyframes yukiRing {
          0% { transform: scale(0.85); opacity: 0.4; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes yukiSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes yukiPageIn {
          0%   { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes yukiFadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes yukiShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .yuki-pulse-dot { animation: yukiPulse 2.6s ease-in-out infinite; }
        .yuki-pulse-ring { animation: yukiRing 2.6s ease-out infinite; }
        .yuki-spin { animation: yukiSpin 1.4s linear infinite; }
        .yuki-page { animation: yukiPageIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .yuki-fade { animation: yukiFadeIn 0.4s ease-out both; }
        .yuki-shimmer {
          background: linear-gradient(90deg, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0.35) 50%, rgba(168,85,247,0.15) 100%);
          background-size: 200% 100%;
          animation: yukiShimmer 1.6s ease-in-out infinite;
        }

        button, a, [role="button"] {
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
                      background-color 0.28s ease,
                      border-color 0.28s ease,
                      color 0.28s ease,
                      box-shadow 0.28s ease,
                      opacity 0.28s ease;
        }
        img, svg, span, div {
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
                      opacity 0.28s ease,
                      background-color 0.3s ease;
        }
        .yuki-scroll { scroll-behavior: smooth; }
        .yuki-modal-bg { animation: yukiFadeIn 0.35s ease-out both; }
        .yuki-modal-card { animation: yukiPageIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden">
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
                  mini shop
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
            {paymentFlow ? (
              paymentFlow.kind === "topup" ? (
                <TopUpPaymentScreen
                  flow={paymentFlow}
                  onClose={() => setPaymentFlow(null)}
                  onCryptoPick={(kind) =>
                    setPaymentFlow({ ...paymentFlow, cryptoKind: kind, stage: "address" })
                  }
                  onIPaid={handleTopUpIPaid}
                  onGoToOrders={() => {
                    setPaymentFlow(null);
                    setActiveTab("orders");
                  }}
                  onGoToBalance={() => {
                    setPaymentFlow(null);
                    setActiveTab("balance");
                  }}
                />
              ) : (
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
              )
            ) : openedProduct ? (
              <ProductPage
                product={openedProduct}
                onBack={() => {
                  vibrate("light");
                  setOpenedProductId(null);
                }}
                onAddToCart={handleAddToCart}
                onOpenBuyNow={(product, tariff) => setDirectBuy({ product, tariff })}
                cartCount={cartCount}
                onGoCart={() => {
                  setOpenedProductId(null);
                  setActiveTab("cart");
                }}
              />
            ) : (
              <>
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
                      scrollToContentTop("auto");
                      setOpenedProductId(id);
                      window.setTimeout(() => scrollToContentTop("auto"), 0);
                    }}
                  />
                )}

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

                {activeTab === "orders" && (
                  <OrdersPage
                    orders={userOrders}
                    viewOrderId={viewOrderId}
                    onView={(id) => setViewOrderId(id)}
                    onClose={() => setViewOrderId(null)}
                    onOpenSupport={() => setShowSupport(true)}
                  />
                )}

                {activeTab === "balance" && (
                  <BalancePage
                    balance={balance}
                    topUpPayments={userTopUpPayments}
                    selectedPayMethod={selectedPayMethod}
                    setSelectedPayMethod={setSelectedPayMethod}
                    topUpAmount={topUpAmount}
                    setTopUpAmount={setTopUpAmount}
                    onTopUp={(rub) => {
                      vibrate("medium");
                      // Запускаем payment flow для пополнения
                      const method = selectedPayMethod;
                      if (method === "crypto") {
                        setPaymentFlow({ method, amount: rub, stage: "crypto-choose", kind: "topup" });
                      } else {
                        setPaymentFlow({ method, amount: rub, stage: "address", kind: "topup" });
                      }
                    }}
                  />
                )}

                {activeTab === "profile" && (
                  <ProfilePage
                    user={user}
                    avatarLetter={avatarLetter}
                    balance={balance}
                    ordersCount={userOrders.length}
                    isAdmin={isAdmin}
                    onGoBalance={() => setActiveTab("balance")}
                    onGoOrders={() => setActiveTab("orders")}
                    onGoAdmin={() => setActiveTab("admin")}
                  />
                )}

                {activeTab === "admin" && isAdmin && (
                  <AdminPage
                    orders={orders}
                    apiReady={apiReady}
                    onApprove={(id) => adminUpdateOrder(id, "completed")}
                    onReject={(id) => adminUpdateOrder(id, "failed")}
                    onResetTestOrders={() => setResetOrdersConfirm(true)}
                    onResetAllOrders={() => setResetAllOrdersConfirm(true)}
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
                    className={`relative flex h-[68px] flex-col items-center justify-center rounded-[18px] px-1 py-2 text-center transition ${
                      isActive
                        ? "bg-gradient-to-b from-violet-500/35 to-indigo-500/15 text-white"
                        : "text-violet-100/60"
                    }`}
                  >
                    <span className="flex h-8 w-9 items-center justify-center">
                      <NavIcon icon={item.icon} active={isActive} />
                    </span>
                    <span className="mt-1 block h-3 text-[10px] font-medium leading-3">
                      {item.label}
                    </span>
                    {showBadge && (
                      <span className="absolute right-2 top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[9px] font-bold text-white shadow-[0_0_12px_rgba(232,121,249,0.7)]">
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

        {/* 🎁 Подарок */}
        {giftModal && (
          <Modal>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-4xl shadow-[0_0_60px_rgba(168,85,247,0.55)]">
              🎁
            </div>
            <h2 className="mt-5 text-center text-2xl font-bold text-white">У тебя подарок!</h2>
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

        {showSupport && (
          <Modal>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/20 text-2xl">
              💬
            </div>
            <h3 className="mt-4 text-center text-xl font-semibold text-white">Поддержка</h3>
            <p className="mt-2 text-center text-sm text-violet-100/65">
              Если возникли проблемы с оплатой или товаром — напиши в поддержку.
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

        {directBuy && (
          <Modal>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-2xl shadow-[0_0_40px_rgba(168,85,247,0.4)]">
              ₽
            </div>
            <h3 className="mt-5 text-center text-2xl font-bold text-white">Перейти к оплате?</h3>
            <p className="mt-3 text-center text-sm leading-6 text-violet-100/70">
              {directBuy.product.title} · {directBuy.tariff.title} на сумму{" "}
              <span className="font-semibold text-white">{formatPrice(directBuy.tariff.price)}</span>.
              Можно оплатить сразу или добавить в корзину и оплатить всё вместе позже.
            </p>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-violet-100/45">
                Способ оплаты
              </div>
              <div className="grid grid-cols-2 gap-2">
                {payMethods.map((method) => {
                  const active = selectedPayMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSelectedPayMethod(method.id)}
                      className={cn(
                        "flex min-h-[58px] items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs transition active:scale-95",
                        active
                          ? "border-violet-300/50 bg-violet-500/20 text-white"
                          : "border-white/10 bg-white/5 text-violet-100/65",
                      )}
                    >
                      {method.logo ? (
                        <img
                          src={method.logo}
                          alt={method.title}
                          className="h-8 w-8 shrink-0 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
                        />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-[10px] text-violet-100/45">
                          logo
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{method.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-violet-100/45">
                          {method.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => startDirectCheckout(directBuy.product, directBuy.tariff)}
                className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-5 py-4 text-base font-semibold text-white shadow-[0_12px_36px_rgba(168,85,247,0.4)]"
              >
                Оплатить сразу
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAddToCart(directBuy.product, directBuy.tariff);
                  setDirectBuy(null);
                }}
                className="w-full rounded-2xl border border-violet-300/30 bg-violet-500/15 px-5 py-4 text-base font-semibold text-violet-100"
              >
                Добавить в корзину
              </button>
              <button
                type="button"
                onClick={() => setDirectBuy(null)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-violet-100/75"
              >
                Отмена
              </button>
            </div>
          </Modal>
        )}

        {resetOrdersConfirm && (
          <Modal>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-2xl">
              ⚠️
            </div>
            <h3 className="mt-4 text-center text-xl font-semibold text-white">
              Сбросить тестовые заказы?
            </h3>
            <p className="mt-2 text-center text-sm text-violet-100/65">
              Будут удалены все заказы юзеров{" "}
              <span className="font-semibold text-violet-200">@samarskiyyyy</span> и{" "}
              <span className="font-semibold text-violet-200">@ceoclott</span>. Остальные заказы
              останутся.
            </p>
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={handleResetTestOrders}
                className="w-full rounded-2xl bg-gradient-to-r from-red-500 to-amber-500 px-5 py-4 text-base font-semibold text-white"
              >
                Да, сбросить
              </button>
              <button
                type="button"
                onClick={() => setResetOrdersConfirm(false)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base font-semibold text-violet-100"
              >
                Отмена
              </button>
            </div>
          </Modal>
        )}

        {resetAllOrdersConfirm && (
          <ResetAllOrdersModal
            ordersCount={orders.length}
            onConfirm={handleResetAllOrders}
            onCancel={() => setResetAllOrdersConfirm(false)}
          />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// МОДАЛКА
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

function ResetAllOrdersModal({
  ordersCount,
  onConfirm,
  onCancel,
}: {
  ordersCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [secLeft, setSecLeft] = useState(5);

  useEffect(() => {
    if (secLeft <= 0) return;
    const t = window.setTimeout(() => setSecLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [secLeft]);

  const canReset = secLeft === 0;

  return (
    <Modal>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-3xl">
        !
      </div>
      <h3 className="mt-4 text-center text-xl font-semibold text-white">Вы уверены?</h3>
      <p className="mt-3 text-center text-sm leading-6 text-violet-100/65">
        Это удалит <span className="font-semibold text-white">все заказы</span> и все заявки на
        пополнение из Cloudflare KV. Сейчас в базе: {ordersCount}.
      </p>
      <div className="mt-5 rounded-2xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-center text-sm text-red-100">
        Действие необратимое. Кнопка разблокируется через {secLeft} сек.
      </div>
      <div className="mt-6 space-y-3">
        <button
          type="button"
          disabled={!canReset}
          onClick={onConfirm}
          className={cn(
            "w-full rounded-2xl px-5 py-4 text-base font-semibold transition",
            canReset
              ? "bg-gradient-to-r from-red-500 to-amber-500 text-white shadow-[0_12px_36px_rgba(239,68,68,0.35)]"
              : "cursor-not-allowed border border-white/10 bg-white/5 text-violet-100/35",
          )}
        >
          {canReset ? "Да, удалить все заказы" : `Подождите ${secLeft} сек.`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base font-semibold text-violet-100"
        >
          Отмена
        </button>
      </div>
    </Modal>
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
      <SectionCard>
        <p className="text-xs uppercase tracking-[0.38em] text-violet-200/60">YUKI soft catalog</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-white">
          Выбери категорию
          <br />и открой товар
        </h1>
        <p className="mt-3 text-sm leading-6 text-violet-100/55">
          «YUKI Soft» — фильтр со всеми товарами. Остальные кнопки — фильтрация по разделам.
        </p>
      </SectionCard>

      <div className="grid grid-cols-2 gap-2">
        {categories.map((cat: any) => {
          const isActive = cat.id === selectedCategory;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onPickCategory(cat.id)}
              className={cn(
                "flex min-h-[58px] items-center gap-3 rounded-2xl border px-3 py-3 text-left text-sm transition active:scale-95",
                cat.id === "all" && "col-span-2",
                isActive
                  ? "border-violet-300/50 bg-gradient-to-r from-[#7c3aed] via-[#8b5cf6] to-[#a855f7] text-white shadow-[0_12px_30px_rgba(124,58,237,0.22)]"
                  : "border-white/10 bg-white/[0.04] text-violet-100/75",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-base">
                <CategoryIcon icon={cat.icon} iconUrl={cat.iconUrl} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{cat.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-violet-100/50">
                  {cat.short}
                </span>
              </span>
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
                className="block w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#130d27] text-left shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition active:scale-[0.99]"
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
// СТРАНИЦА ТОВАРА (с видео для YUKI iPA и примечанием)
// ════════════════════════════════════════════════════════════════════════════
function ProductPage({
  product,
  onBack,
  onAddToCart,
  onOpenBuyNow,
  cartCount,
  onGoCart,
}: {
  product: Product;
  onBack: () => void;
  onAddToCart: (p: Product, t: Tariff) => void;
  onOpenBuyNow: (p: Product, t: Tariff) => void;
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
        <SectionCard>
          <p className="text-sm leading-6 text-violet-100/70">
            Более подробно ознакомиться с товаром вы можете тут:{" "}
            <a
              href={product.infoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-violet-300 underline underline-offset-2"
            >
              перейти
            </a>
          </p>
        </SectionCard>
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
              {/* 2/3 — быстрая оплата, 1/3 — корзина */}
              <div className="mt-3 grid w-full grid-cols-3 overflow-hidden border-t border-white/10">
                <button
                  type="button"
                  onClick={() => onOpenBuyNow(product, tariff)}
                  className="col-span-2 flex items-center justify-center bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 py-3.5 text-base font-bold text-white active:scale-[0.99]"
                >
                  {formatPrice(tariff.price)}
                </button>
                <button
                  type="button"
                  onClick={() => onAddToCart(product, tariff)}
                  className="col-span-1 flex items-center justify-center gap-2 bg-violet-500/20 py-3.5 text-sm font-semibold text-violet-50 active:scale-[0.99]"
                >
                  {CART_ICON_URL ? (
                    <img src={CART_ICON_URL} alt="" className="h-8 w-8 shrink-0 object-contain" />
                  ) : (
                    <span className="text-[28px] leading-none">🛒</span>
                  )}
                  <span>В корзину</span>
                </button>
              </div>
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
              {CART_ICON_URL ? (
                <img
                  src={CART_ICON_URL}
                  alt=""
                  className="h-14 w-14 object-contain opacity-80 drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
                />
              ) : (
                <span className="text-[42px] leading-none">🛒</span>
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
// ЭКРАН ОПЛАТЫ ЗАКАЗА
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

  if (flow.stage === "crypto-choose") {
    return <CryptoChooseScreen flow={flow} onPick={onCryptoPick} onClose={onClose} />;
  }

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

  if (flow.stage === "waiting") {
    return <WaitingScreen onBackToCatalog={onBackToCatalog} onGoToOrders={onGoToOrders} />;
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// ЭКРАН ОПЛАТЫ ПОПОЛНЕНИЯ (упрощённый waiting)
// ════════════════════════════════════════════════════════════════════════════
function TopUpPaymentScreen({
  flow,
  onClose,
  onCryptoPick,
  onIPaid,
  onGoToOrders,
  onGoToBalance,
}: {
  flow: {
    method: PayMethodId;
    amount: number;
    cryptoKind?: CryptoKindId;
    stage: "crypto-choose" | "address" | "waiting" | "failed";
  };
  onClose: () => void;
  onCryptoPick: (k: CryptoKindId) => void;
  onIPaid: () => void;
  onGoToOrders: () => void;
  onGoToBalance: () => void;
}) {
  const method = payMethods.find((m) => m.id === flow.method)!;

  if (flow.stage === "crypto-choose") {
    return <CryptoChooseScreen flow={flow} onPick={onCryptoPick} onClose={onClose} />;
  }

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

  if (flow.stage === "waiting") {
    return (
      <WaitingScreen
        onBackToCatalog={onGoToBalance}
        onGoToOrders={onGoToOrders}
        backLabel="Вернуться к балансу"
        text="Заявка на пополнение создана. После проверки админом деньги автоматически зачислятся на баланс. Статус можно смотреть в разделе"
      />
    );
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
    rubPerUnit && rubPerUnit > 0
      ? (flow.amount / rubPerUnit).toFixed(coin?.id === "btc" ? 8 : 4)
      : null;

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
            <div className="mt-3 overflow-hidden rounded-xl">
              <div className="yuki-shimmer h-10 w-full rounded-xl" />
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
        onClick={() => selectedKind && cryptoAmount && onPick(selectedKind)}
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
  const isTransfer = method.id === "sbp";
  const isCryptoBot = method.id === "cryptobot";
  const coin = cryptoKind ? cryptoKinds.find((c) => c.id === cryptoKind) : null;
  const cryptoAddress = cryptoKind ? PAYMENT_CRYPTO_ADDRESSES[cryptoKind] : PAYMENT_CRYPTO_ADDRESSES.usdt;
  const cryptoNetwork = cryptoKind ? PAYMENT_CRYPTO_NETWORKS[cryptoKind] : PAYMENT_CRYPTO_NETWORKS.usdt;
  const requisite = isCrypto
    ? cryptoAddress
    : isTransfer
      ? PAYMENT_TRANSFER_PHONE_NUMBER
      : isCryptoBot
        ? PAYMENT_CRYPTOBOT_REQUISITE
        : PAYMENT_STARS_REQUISITE;
  const strictTitle = isCrypto
    ? `СТРОГО ${coin?.symbol ?? "CRYPTO"} НА ЭТОТ АДРЕС`
    : isTransfer
      ? "СТРОГО НА ЭТОТ НОМЕР"
      : isCryptoBot
        ? "СТРОГО ЧЕРЕЗ ЭТОТ CRYPTO BOT РЕКВИЗИТ"
        : "СТРОГО ЧЕРЕЗ ЭТОТ STARS РЕКВИЗИТ";
  const strictText = isCrypto
    ? `Отправляй только ${coin?.symbol ?? "выбранную валюту"}. Сеть: ${cryptoNetwork}. Другой адрес, сеть или валюта не засчитаются.`
    : isTransfer
      ? "Переводи только на номер ниже. Другой номер или реквизит не засчитается."
      : isCryptoBot
        ? "Оплата должна проходить только по реквизиту ниже. Другой инвойс или бот не засчитается."
        : "Оплата должна проходить только по реквизиту ниже. Другой способ Stars не засчитается.";
  const requisiteLabel = isCrypto
    ? "Адрес кошелька"
    : isTransfer
      ? "Номер телефона"
      : isCryptoBot
        ? "Crypto Bot реквизит"
        : "Stars реквизит";

  const copy = () => {
    navigator.clipboard?.writeText(requisite).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

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

      <SectionCard>
        <div className="flex items-center gap-3">
          {method.logo && (
            <img src={method.logo} alt={method.title} className="h-10 w-10 object-contain" />
          )}
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-violet-200/55">Оплата</div>
            <div className="text-xl font-bold text-white">
              {method.title}
              {coin && <span className="ml-2 text-violet-300">· {coin.symbol}</span>}
            </div>
          </div>
        </div>
        <div className="mt-4 text-3xl font-black text-white">{formatPrice(amount)}</div>
        {coin && (
          <p className="mt-2 text-xs text-violet-100/60">
            Оплата в <span className="text-white">{coin.title} ({coin.symbol})</span>
          </p>
        )}
      </SectionCard>

      <SectionCard>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-sm font-black text-violet-100">
            1
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-violet-200/55">
              Шаг первый
            </div>
            <h3 className="text-lg font-semibold text-white">Проверь сумму</h3>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-4">
          <div className="text-xs text-violet-100/50">К оплате</div>
          <div className="mt-1 text-3xl font-black text-white">{formatPrice(amount)}</div>
        </div>
      </SectionCard>

      <SectionCard className="border-red-300/30 bg-[#1a0b1d]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/20 text-sm font-black text-red-100">
            2
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-red-200/70">
              Важно
            </div>
            <h3 className="text-lg font-semibold text-white">{strictTitle}</h3>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-500/12 px-4 py-3 text-sm leading-5 text-red-100">
          {strictText}
        </div>

        <div className="mt-4">
          <div className="text-xs uppercase tracking-[0.25em] text-violet-200/55">
            {requisiteLabel}
          </div>
          <div className="mt-2 break-all rounded-2xl border border-sky-300/35 bg-sky-500/10 px-4 py-4 text-sm font-mono font-semibold leading-6 text-sky-200">
            {requisite}
          </div>
        </div>

        <button
          type="button"
          onClick={copy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(56,189,248,0.3)] active:scale-95"
        >
          {copied ? "✓ Скопировано" : "📋 Скопировать"}
        </button>
      </SectionCard>

      <SectionCard>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-sm font-black text-violet-100">
            3
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-violet-200/55">
                  Шаг третий
                </div>
                <h3 className="text-lg font-semibold text-white">Оплати и нажми кнопку</h3>
              </div>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  secLeft < 60 ? "text-red-300" : "text-white"
                }`}
              >
                {formatTime(secLeft)}
              </div>
            </div>
            <p className="mt-2 text-sm leading-5 text-violet-100/60">
              После перевода нажми «Я оплатил». Заявка уйдёт на проверку, статус будет в заказах.
            </p>
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
  backLabel = "Вернуться в каталог",
  text = "Платёж проверяется. За статусом оплаты вы можете проследить в разделе",
}: {
  onBackToCatalog: () => void;
  onGoToOrders: () => void;
  backLabel?: string;
  text?: string;
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
          {text}{" "}
          <button
            type="button"
            onClick={onGoToOrders}
            className="font-semibold text-violet-300 underline underline-offset-2"
          >
            Заказы
          </button>
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
          {backLabel}
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
    return <OrderDetailPage order={viewOrder} onClose={onClose} onSupport={onOpenSupport} />;
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-[22px] border border-white/10 bg-[#130d27] p-4 text-left transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-base font-semibold text-white">
            {getOrderTitle(order)}
            {!isTopUpOrder(order) && order.items.length > 1 && (
              <span className="ml-1 text-xs text-violet-100/55">
                и ещё {order.items.length - 1}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <StatusDot kind={order.status} />
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
  const topUp = isTopUpOrder(order);

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
          <h2 className="mt-4 text-2xl font-bold text-white">
            {topUp ? "Пополнение отклонено" : "Ошибка с оплатой"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-violet-100/65">
            {topUp
              ? "Заявка на пополнение не была подтверждена. Если деньги были списаны, напишите в поддержку."
              : "К сожалению, оплата не была подтверждена. Попробуйте оплатить ещё раз или напишите в поддержку."}
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
        <h2 className="mt-3 text-2xl font-bold text-white">
          {topUp ? "Пополнение" : "Заказ"} #{order.id.toString().slice(-6)}
        </h2>
        <div className="mt-1 text-xs text-violet-100/55">
          {new Date(order.createdAt).toLocaleString("ru-RU")}
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-base font-semibold text-white">
          {topUp ? "Заявка на пополнение" : "Позиции"}
        </h3>
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
          <h3 className="text-base font-semibold text-white">
            {topUp ? "Пополнение подтверждено" : "Информация по товару"}
          </h3>
          <p className="mt-2 text-sm leading-5 text-violet-100/70">
            {topUp
              ? "Средства зачисляются на баланс автоматически после подтверждения. Если баланс не обновился, перезапусти мини-апп или напиши в поддержку."
              : "Здесь будет файл, ключ активации и подробная инструкция. Скоро добавим полный функционал — сейчас связь через поддержку."}
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
// СТРАНИЦА БАЛАНСА (с лимитами)
// ════════════════════════════════════════════════════════════════════════════
function BalancePage({
  balance,
  topUpPayments,
  selectedPayMethod,
  setSelectedPayMethod,
  topUpAmount,
  setTopUpAmount,
  onTopUp,
}: {
  balance: number;
  topUpPayments: OrderItem[];
  selectedPayMethod: PayMethodId;
  setSelectedPayMethod: (m: PayMethodId) => void;
  topUpAmount: string;
  setTopUpAmount: (v: string) => void;
  onTopUp: (rub: number) => void;
}) {
  const method = payMethods.find((m) => m.id === selectedPayMethod)!;
  const parsed = Number(topUpAmount);
  const limit =
    selectedPayMethod === "crypto" || selectedPayMethod === "cryptobot"
      ? TOPUP_LIMIT_CRYPTO
      : TOPUP_LIMIT_STANDARD;

  // Для звёзд — курс
  const { rubPerStar, loading: starsLoading } = useStarsRate();

  // Если выбран звёзды и есть сумма — показываем эквивалент в рублях
  const starsRubPreview =
    selectedPayMethod === "stars" && Number.isFinite(parsed) && parsed > 0
      ? Math.round(parsed * (rubPerStar ?? STARS_TO_RUB))
      : null;

  const enteredRubAmount =
    selectedPayMethod === "stars"
      ? Math.round(parsed * (rubPerStar ?? STARS_TO_RUB))
      : Math.round(parsed);

  const isValid =
    Number.isFinite(parsed) && parsed > 0 && enteredRubAmount <= limit;

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
            Макс. {formatPrice(limit)}
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
          Лимит для {method.title.toLowerCase()} — {formatPrice(limit)}.
        </p>
        {starsLoading && selectedPayMethod === "stars" && (
          <div className="mt-1 text-[12px] text-violet-200/70">
            <span className="inline-block yuki-spin mr-1.5 h-3 w-3 rounded-full border-2 border-violet-300/30 border-t-violet-300 align-middle" />
            Считаем курс звёзд…
          </div>
        )}
        {starsRubPreview !== null && !starsLoading && (
          <p className="mt-1 text-[12px] text-violet-200/80">
            ≈ {formatPrice(starsRubPreview)} на баланс по курсу{" "}
            {rubPerStar ? rubPerStar.toFixed(2) : STARS_TO_RUB} ₽/⭐
          </p>
        )}
        {topUpAmount && !isValid && Number.isFinite(parsed) && enteredRubAmount > limit && (
          <p className="mt-1 text-[12px] text-red-300/80">
            Превышен лимит {formatPrice(limit)}
          </p>
        )}

        <button
          type="button"
          disabled={!isValid}
          onClick={() => {
            if (!isValid) return;
            onTopUp(enteredRubAmount);
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

      {topUpPayments.length > 0 && (
        <SectionCard>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-violet-200/55">
                YUKI payments
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">Платежи баланса</h3>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-violet-100/60">
              {topUpPayments.length}
            </span>
          </div>
          <p className="mt-2 text-sm leading-5 text-violet-100/55">
            Тут видно, что сейчас в обработке, что уже выполнено, а что отклонено.
          </p>
          <div className="mt-4 space-y-3">
            {topUpPayments.slice(0, 8).map((payment) => (
              <BalancePaymentRow key={payment.id} payment={payment} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function BalancePaymentRow({ payment }: { payment: OrderItem }) {
  const methodTitle = payMethods.find((m) => m.id === payment.method)?.title || payment.method;
  const statusText: Record<OrderStatus, string> = {
    pending: "В обработке",
    completed: "Выполнено",
    failed: "Ошибка",
  };
  const statusColor: Record<OrderStatus, string> = {
    pending: "text-amber-300",
    completed: "text-fuchsia-300",
    failed: "text-red-300",
  };
  const rowTone: Record<OrderStatus, string> = {
    pending: "border-amber-300/20 bg-amber-500/10",
    completed: "border-fuchsia-300/20 bg-fuchsia-500/10",
    failed: "border-red-300/20 bg-red-500/10",
  };

  return (
    <div className={`rounded-[22px] border p-4 ${rowTone[payment.status]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <StatusDot kind={payment.status} />
            <span className={`font-semibold ${statusColor[payment.status]}`}>
              {statusText[payment.status]}
            </span>
          </div>
          <div className="mt-2 text-base font-semibold text-white">
            Платёж #{payment.id.toString().slice(-6)}
          </div>
          <div className="mt-1 text-xs text-violet-100/55">
            {methodTitle}
            {payment.cryptoKind
              ? ` · ${cryptoKinds.find((c) => c.id === payment.cryptoKind)?.symbol ?? payment.cryptoKind}`
              : ""}
            {" · "}
            {new Date(payment.createdAt).toLocaleDateString("ru-RU")}
          </div>
        </div>
        <div className="shrink-0 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white">
          {formatPrice(payment.total)}
        </div>
      </div>
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
  apiReady,
  onApprove,
  onReject,
  onResetTestOrders,
  onResetAllOrders,
}: {
  orders: OrderItem[];
  apiReady: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onResetTestOrders: () => void;
  onResetAllOrders: () => void;
}) {
  const productOrders = orders.filter((o) => !isTopUpOrder(o));
  const topUpOrders = orders.filter(isTopUpOrder);
  const pendingProducts = productOrders.filter((o) => o.status === "pending");
  const pendingTopUps = topUpOrders.filter((o) => o.status === "pending");
  const pending = orders.filter((o) => o.status === "pending");
  const completed = orders.filter((o) => o.status === "completed");
  const failed = orders.filter((o) => o.status === "failed");

  const totalOrdersCount = orders.length;
  const completedRevenue = completed.reduce((sum, o) => sum + o.total, 0);
  const pendingAmount = pending.reduce((sum, o) => sum + o.total, 0);
  const pendingTopUpAmount = pendingTopUps.reduce((sum, o) => sum + o.total, 0);
  const uniqueUsers = new Set(orders.map((o) => o.username.toLowerCase())).size;

  return (
    <div className="space-y-5">
      <SectionCard className="bg-[linear-gradient(135deg,rgba(232,121,249,0.18),rgba(99,102,241,0.12))]">
        <p className="text-xs uppercase tracking-[0.35em] text-fuchsia-200/80">YUKI · admin</p>
        <h2 className="mt-3 text-3xl font-semibold text-white">Админ-панель</h2>
        <p className="mt-2 text-sm leading-6 text-violet-100/70">
          Доступ только для @samarskiyyyy и @ceoclott. Заказы и заявки на пополнение хранятся в общем списке.
        </p>
        <div
          className={cn(
            "mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
            apiReady
              ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-300/30 bg-red-500/10 text-red-200",
          )}
        >
          <StatusDot kind={apiReady ? "completed" : "failed"} />
          {apiReady ? "Cloudflare KV подключён" : "KV API недоступен"}
        </div>
      </SectionCard>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-3">
        <SectionCard className="p-4">
          <div className="text-[10px] uppercase tracking-[0.25em] text-violet-200/55">
            Всего заказов
          </div>
          <div className="mt-2 text-2xl font-black text-white">{totalOrdersCount}</div>
          <div className="mt-1 text-[11px] text-violet-100/55">
            {productOrders.length} товаров · {topUpOrders.length} пополнений
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
            от {uniqueUsers} {uniqueUsers === 1 ? "юзера" : "юзеров"}
          </div>
        </SectionCard>

        <SectionCard className="col-span-2 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(232,121,249,0.10))] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
                В обработке
              </div>
              <div className="mt-2 text-2xl font-black text-white">{pending.length}</div>
              <div className="mt-1 text-[11px] text-violet-100/55">ждут подтверждения</div>
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

        <SectionCard className="col-span-2 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(168,85,247,0.10))] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-sky-200/70">
                Заявки на пополнение
              </div>
              <div className="mt-2 text-2xl font-black text-white">{pendingTopUps.length}</div>
              <div className="mt-1 text-[11px] text-violet-100/55">
                ожидают решения
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.25em] text-sky-200/70">
                К зачислению
              </div>
              <div className="mt-2 text-2xl font-black text-sky-200">
                {formatPrice(pendingTopUpAmount)}
              </div>
            </div>
          </div>
        </SectionCard>

        {failed.length > 0 && (
          <SectionCard className="col-span-2 bg-[linear-gradient(135deg,rgba(239,68,68,0.15),rgba(232,121,249,0.08))] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-red-200/70">
                  С ошибкой
                </div>
                <div className="mt-2 text-2xl font-black text-red-300">{failed.length}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.25em] text-red-200/70">Сумма</div>
                <div className="mt-2 text-2xl font-black text-red-300">
                  {formatPrice(failed.reduce((s, o) => s + o.total, 0))}
                </div>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      {/* Кнопка сброса тестовых заказов */}
      <button
        type="button"
        onClick={onResetTestOrders}
        className="w-full rounded-[22px] border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 transition active:scale-[0.99]"
      >
        🧹 Сбросить заказы тестовых юзеров
      </button>

      <button
        type="button"
        onClick={onResetAllOrders}
        className="w-full rounded-[22px] border border-red-300/35 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition active:scale-[0.99]"
      >
        Полностью сбросить все заказы
      </button>

      {pending.length === 0 && completed.length === 0 && failed.length === 0 ? (
        <SectionCard className="text-center text-violet-100/60">Заказов пока нет</SectionCard>
      ) : (
        <>
          {pendingTopUps.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-1">
                <h3 className="text-lg font-semibold text-white">Заявки на пополнение</h3>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              {pendingTopUps.map((o) => (
                <AdminOrderRow key={o.id} order={o} onApprove={onApprove} onReject={onReject} />
              ))}
            </>
          )}

          {pendingProducts.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-1 pt-2">
                <h3 className="text-lg font-semibold text-white">Заказы в обработке</h3>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              {pendingProducts.map((o) => (
                <AdminOrderRow key={o.id} order={o} onApprove={onApprove} onReject={onReject} />
              ))}
            </>
          )}

          {failed.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-1 pt-2">
                <h3 className="text-lg font-semibold text-white">С ошибкой</h3>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              {failed.map((o) => (
                <AdminOrderRow key={o.id} order={o} onApprove={onApprove} onReject={onReject} />
              ))}
            </>
          )}

          {completed.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-1 pt-2">
                <h3 className="text-lg font-semibold text-white">Выполненные</h3>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              {completed.map((o) => (
                <AdminOrderRow key={o.id} order={o} onApprove={onApprove} onReject={onReject} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function AdminOrderRow({
  order,
  onApprove,
  onReject,
}: {
  order: OrderItem;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const m = payMethods.find((mm) => mm.id === order.method);
  const topUp = isTopUpOrder(order);
  return (
    <SectionCard key={order.id}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-violet-100/55">@{order.username}</div>
          <div className="mt-1 text-base font-semibold text-white">
            {topUp ? "Пополнение" : "Заказ"} #{order.id.toString().slice(-6)}
          </div>
          <div className="mt-1 text-xs text-violet-100/55">
            {new Date(order.createdAt).toLocaleString("ru-RU")}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white">
          {formatPrice(order.total)}
        </div>
      </div>

      {topUp ? (
        <div className="mt-3 rounded-2xl border border-sky-300/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Заявка на пополнение баланса на сумму{" "}
          <span className="font-semibold text-white">{formatPrice(order.total)}</span>.
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-sm text-violet-100/70">
          {order.items.map((it, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {it.title} — {it.tariffTitle} × {it.qty}
              </span>
              <span className="text-white">{formatPrice(it.price * it.qty)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-violet-100/55">
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
          {topUp ? "Пополнение" : "Покупка"} · {m?.title}
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
          {order.status === "pending" ? "В обработке" : order.status === "completed" ? "Выполнено" : "Ошибка"}
        </span>
        {order.cryptoKind && (
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
            {cryptoKinds.find((c) => c.id === order.cryptoKind)?.symbol}
          </span>
        )}
      </div>

      {order.status === "pending" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onReject(order.id)}
            className="rounded-2xl border border-red-400/30 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 active:scale-95"
          >
            Отклонить
          </button>
          <button
            type="button"
            onClick={() => onApprove(order.id)}
            className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(168,85,247,0.4)] active:scale-95"
          >
            Принять
          </button>
        </div>
      )}
    </SectionCard>
  );
}
