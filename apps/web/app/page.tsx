"use client";

import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AdminPanel} from "./AdminPanel";

type Language = "ru" | "uz";
type Role = "ADMIN" | "CASHIER";
type User = {id: string; role: Role; displayName: string; locale: Language};
type Product = {
  id: string; sku: string; barcode: string | null; nameRu: string; nameUz: string;
  categoryRu: string; categoryUz: string; salePrice: string; quantity: number;
};
type CartLine = {product: Product; quantity: number};
type Receipt = {receiptNumber: string; createdAt: string; originalTotal: string; discountAmount: string; finalTotal: string; paymentMethod: string};

declare global {
  interface Window {
    Telegram?: {WebApp?: {initData: string; ready(): void; expand(): void}};
  }
}

const text = {
  ru: {title:"Касса", search:"Название, SKU или штрихкод", cart:"Корзина", empty:"Корзина пуста", qty:"Количество",
    price:"Цена", sum:"Сумма", subtotal:"Подытог", bargain:"Торг", total:"Итого", sell:"ПРОДАТЬ",
    login:"Логин / email / телефон", password:"Пароль", signIn:"Войти", cash:"Наличные", click:"Click", payme:"Payme",
    card:"Карта", transfer:"Перевод", other:"Другое", noStock:"Нет в наличии", offline:"Нет соединения. Продажа заблокирована.",
    checking:"Проверяем состояние операции…", unknownBarcode:"Штрихкод не найден", receipt:"Чек", print:"Печать", newSale:"Новый чек",
    logout:"Выйти", fixed:"Сумма", percent:"Процент", loading:"Загрузка…"},
  uz: {title:"Kassa", search:"Nomi, SKU yoki shtrix-kod", cart:"Savat", empty:"Savat bo‘sh", qty:"Miqdor",
    price:"Narx", sum:"Jami", subtotal:"Oraliq jami", bargain:"Savdolashuv", total:"To‘lov", sell:"SOTISH",
    login:"Login / email / telefon", password:"Parol", signIn:"Kirish", cash:"Naqd", click:"Click", payme:"Payme",
    card:"Karta", transfer:"O‘tkazma", other:"Boshqa", noStock:"Sotuvda yo‘q", offline:"Aloqa yo‘q. Sotuv bloklandi.",
    checking:"Operatsiya holatini tekshiryapmiz…", unknownBarcode:"Shtrix-kod topilmadi", receipt:"Chek", print:"Chop etish", newSale:"Yangi chek",
    logout:"Chiqish", fixed:"Summa", percent:"Foiz", loading:"Yuklanmoqda…"},
} as const;

const formatMoney = (value: bigint, language: Language) => new Intl.NumberFormat(language === "ru" ? "ru-RU" : "uz-UZ").format(value) + " сум";
type Translation = typeof text[keyof typeof text];
const paymentLabels = (t: Translation) => ({CASH:t.cash,CLICK:t.click,PAYME:t.payme,CARD:t.card,TRANSFER:t.transfer,OTHER:t.other});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {credentials:"include", ...init, headers:{"Content-Type":"application/json", ...(init?.headers ?? {})}});
  const body = await response.json().catch(() => ({error:"Invalid server response"})) as T & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export default function CashierPage() {
  const [language, setLanguage] = useState<Language>("ru");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountMode, setDiscountMode] = useState<"FIXED"|"PERCENT">("FIXED");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [view, setView] = useState<"pos"|"admin">("pos");
  const searchRef = useRef<HTMLInputElement>(null);
  const t = text[language];

  useEffect(() => {
    const storedLanguage = localStorage.getItem("pos-language");
    if (storedLanguage === "ru" || storedLanguage === "uz") setLanguage(storedLanguage);
    const storedCart = localStorage.getItem("pos-cart");
    if (storedCart) try { setCart(JSON.parse(storedCart) as CartLine[]); } catch { localStorage.removeItem("pos-cart"); }
    const telegram = window.Telegram?.WebApp;
    telegram?.ready(); telegram?.expand();
    const authenticate = telegram?.initData
      ? api<{user:User}>("/api/auth/telegram", {method:"POST", body:JSON.stringify({initData:telegram.initData})})
      : api<{user:User}>("/api/auth/session");
    authenticate.then((result) => {setUser(result.user); setLanguage(result.user.locale);}).catch(() => undefined).finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {localStorage.setItem("pos-language", language); document.documentElement.lang=language;}, [language]);
  useEffect(() => {localStorage.setItem("pos-cart", JSON.stringify(cart));}, [cart]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{items:Product[]}>(`/api/products?q=${encodeURIComponent(query)}&limit=40`, {signal:controller.signal})
        .then((result) => {
          setProducts(result.items);
          if (query && result.items.length === 1 && result.items[0]?.barcode === query) {
            addProduct(result.items[0]); setQuery(""); searchRef.current?.focus();
          }
        }).catch((error:Error) => {if (error.name !== "AbortError") setMessage(error.message);});
    }, query ? 220 : 0);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [query, user]);

  const addProduct = useCallback((product: Product) => {
    if (product.quantity <= 0) {setMessage(t.noStock); return;}
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id
        ? {...line, quantity: Math.min(line.quantity + 1, product.quantity)} : line);
      return [...current, {product, quantity:1}];
    });
  }, [t.noStock]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + BigInt(line.product.salePrice) * BigInt(line.quantity), 0n), [cart]);
  const discountAmount = useMemo(() => {
    const clean = discount.replace(",", ".");
    if (discountMode === "FIXED") return /^\d+$/.test(clean) ? BigInt(clean) : 0n;
    if (!/^\d{1,3}(\.\d{0,2})?$/.test(clean)) return 0n;
    const [whole="0", fraction=""] = clean.split(".");
    const points = BigInt(whole) * 100n + BigInt(fraction.padEnd(2,"0"));
    return subtotal * points / 10000n;
  }, [discount, discountMode, subtotal]);
  const safeDiscount = discountAmount > subtotal ? subtotal : discountAmount;

  const changeQuantity = (id:string, next:number) => setCart((current) => current
    .map((line) => line.product.id === id ? {...line, quantity:Math.min(Math.max(next,0),line.product.quantity)} : line)
    .filter((line) => line.quantity > 0));

  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{user:User}>("/api/auth/login", {method:"POST", body:JSON.stringify({identifier:form.get("identifier"),password:form.get("password")})});
      setUser(result.user); setLanguage(result.user.locale);
    } catch (error) {setMessage(error instanceof Error ? error.message : "Login failed");}
    finally {setBusy(false);}
  }

  async function sell() {
    if (busy || cart.length === 0) return;
    if (!navigator.onLine) {setMessage(t.offline); return;}
    setBusy(true); setMessage("");
    const storageKey = "pending-sale-idempotency";
    const idempotencyKey = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, idempotencyKey);
    const body = {
      idempotencyKey,
      items:cart.map((line) => ({productId:line.product.id,quantity:line.quantity,expectedSalePrice:line.product.salePrice})),
      discount:discountMode === "FIXED" ? {type:"FIXED",amount:safeDiscount.toString()} : {
        type:"PERCENT",basisPoints:Number((safeDiscount * 10000n) / (subtotal || 1n))
      },
      paymentMethod,
    };
    try {
      const result = await api<Receipt>("/api/sales", {method:"POST",body:JSON.stringify(body)});
      localStorage.removeItem(storageKey); setReceipt(result); setCart([]); setDiscount("0");
    } catch (error) {
      setMessage(!navigator.onLine ? t.checking : error instanceof Error ? error.message : t.checking);
    } finally {setBusy(false);}
  }

  async function logout() {
    await api("/api/auth/logout",{method:"POST",body:"{}"}).catch(() => undefined);
    setUser(null); setCart([]);
  }

  if (!authReady) return <main className="center"><div className="loader"/><p>{t.loading}</p></main>;
  if (!user) return <main className="center"><form className="loginCard" onSubmit={login}>
    <div className="brandMark">IP</div><h1>Independent POS</h1>
    <label>{t.login}<input name="identifier" autoComplete="username" required/></label>
    <label>{t.password}<input name="password" type="password" autoComplete="current-password" minLength={10} required/></label>
    {message && <p className="error" role="alert">{message}</p>}
    <button className="primary" disabled={busy}>{busy?t.loading:t.signIn}</button>
    <LanguageToggle language={language} setLanguage={setLanguage}/>
  </form></main>;

  return <main className="appShell">
    <header><div><span className="eyebrow">Independent POS</span><h1>{t.title}</h1></div>
      <div className="headerActions">{user.role==="ADMIN"&&<button className="ghost" onClick={()=>setView(view==="pos"?"admin":"pos")}>{view==="pos"?(language==="ru"?"Управление":"Boshqaruv"):t.title}</button>}<LanguageToggle language={language} setLanguage={setLanguage}/><button className="ghost" onClick={logout}>{t.logout}</button></div>
    </header>
    {view==="admin"&&user.role==="ADMIN"?<AdminPanel language={language}/>:<section className="workspace">
      <div className="catalogPanel">
        <label className="search"><span>⌕</span><input ref={searchRef} value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={t.search} autoFocus/></label>
        {message && <div className="notice" role="status">{message}</div>}
        <div className="productGrid">{products.map((product)=><button className="productCard" key={product.id} onClick={()=>addProduct(product)} disabled={product.quantity<=0}>
          <div className="productTop"><span className="sku">{product.sku}</span><span className={product.quantity<=0?"stock out":"stock"}>{product.quantity<=0?t.noStock:product.quantity}</span></div>
          <strong>{language==="ru"?product.nameRu:product.nameUz}</strong><small>{language==="ru"?product.categoryRu:product.categoryUz}</small>
          <b>{formatMoney(BigInt(product.salePrice),language)}</b>
        </button>)}</div>
      </div>
      <aside className="cartPanel"><h2>{t.cart}<span>{cart.reduce((sum,line)=>sum+line.quantity,0)}</span></h2>
        <div className="cartLines">{cart.length===0?<div className="emptyState">{t.empty}</div>:cart.map((line)=><article className="cartLine" key={line.product.id}>
          <div><strong>{language==="ru"?line.product.nameRu:line.product.nameUz}</strong><small>{line.product.sku}</small></div>
          <div className="quantity"><button onClick={()=>changeQuantity(line.product.id,line.quantity-1)}>−</button><input aria-label={t.qty} value={line.quantity} inputMode="numeric" onChange={(event)=>changeQuantity(line.product.id,Number(event.target.value)||0)}/><button onClick={()=>changeQuantity(line.product.id,line.quantity+1)}>+</button></div>
          <b>{formatMoney(BigInt(line.product.salePrice)*BigInt(line.quantity),language)}</b>
        </article>)}</div>
        <div className="checkout">
          <div className="totalRow"><span>{t.subtotal}</span><b>{formatMoney(subtotal,language)}</b></div>
          <div className="discountRow"><select value={discountMode} onChange={(event)=>setDiscountMode(event.target.value as "FIXED"|"PERCENT")}><option value="FIXED">{t.fixed}</option><option value="PERCENT">{t.percent}</option></select><input value={discount} onChange={(event)=>setDiscount(event.target.value)} inputMode="decimal" aria-label={t.bargain}/></div>
          <div className="totalRow grand"><span>{t.total}</span><b>{formatMoney(subtotal-safeDiscount,language)}</b></div>
          <div className="payments">{Object.entries(paymentLabels(t)).map(([value,label])=><button className={paymentMethod===value?"selected":""} key={value} onClick={()=>setPaymentMethod(value)}>{label}</button>)}</div>
          <button className="sellButton" onClick={sell} disabled={busy||cart.length===0}>{busy?t.checking:t.sell}</button>
        </div>
      </aside>
    </section>}
    {receipt&&<div className="modalBackdrop" role="presentation"><section className="receipt" role="dialog" aria-modal="true" aria-label={t.receipt}>
      <h2>{t.receipt} №{receipt.receiptNumber}</h2><time>{new Date(receipt.createdAt).toLocaleString(language==="ru"?"ru-RU":"uz-UZ")}</time>
      <div className="receiptTotal">{formatMoney(BigInt(receipt.finalTotal),language)}</div>
      <p>{paymentLabels(t)[receipt.paymentMethod as keyof ReturnType<typeof paymentLabels>]}</p>
      <div className="receiptActions"><button onClick={()=>window.print()}>{t.print}</button><button className="primary" onClick={()=>{setReceipt(null);searchRef.current?.focus();}}>{t.newSale}</button></div>
    </section></div>}
  </main>;
}

function LanguageToggle({language,setLanguage}:{language:Language;setLanguage:(language:Language)=>void}) {
  return <div className="languageToggle"><button className={language==="ru"?"active":""} onClick={()=>setLanguage("ru")} type="button">RU</button><button className={language==="uz"?"active":""} onClick={()=>setLanguage("uz")} type="button">O‘Z</button></div>;
}
