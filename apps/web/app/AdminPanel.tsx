"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";

type Language="ru"|"uz";
type Category={id:string;nameRu:string;nameUz:string;active:boolean};
type Product={id:string;sku:string;barcode:string|null;nameRu:string;nameUz:string;categoryId:string;salePrice:string;purchasePrice:string;quantity:number;minimumStock:number};
type Summary={originalRevenue:string;discountAmount:string;actualRevenue:string;returnsAmount:string;costOfGoods:string;grossProfit:string;expenses:string;netProfit:string;checks:number;averageCheck:string};
type User={id:string;login:string;displayName:string;role:"ADMIN"|"CASHIER";locale:Language;active:boolean};
type Audit={id:string;userName:string|null;action:string;entityType:string;entityId:string;createdAt:string};

async function api<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{credentials:"include",...init,headers:{"Content-Type":"application/json",...(init?.headers??{})}});const body=await response.json().catch(()=>({error:"Server error"})) as T&{error?:string};if(!response.ok)throw new Error(body.error??`HTTP ${response.status}`);return body;}
const money=(value:string,language:Language)=>new Intl.NumberFormat(language==="ru"?"ru-RU":"uz-UZ").format(BigInt(value))+" сум";
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tashkent",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

export function AdminPanel({language}:{language:Language}){
  const [tab,setTab]=useState<"dashboard"|"catalog"|"reports"|"users"|"audit">("dashboard");
  const [categories,setCategories]=useState<Category[]>([]); const [products,setProducts]=useState<Product[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null); const [users,setUsers]=useState<User[]>([]); const [audit,setAudit]=useState<Audit[]>([]);
  const [reportDate,setReportDate]=useState(today()); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const ru=language==="ru";
  const load=useCallback(async()=>{setMessage("");try{
    if(tab==="dashboard"){const data=await api<{day:string}>("/api/admin/dashboard");setReportDate(data.day);setSummary(await api<Summary>(`/api/reports/day?date=${data.day}`));}
    if(tab==="catalog"){const [c,p]=await Promise.all([api<{items:Category[]}>("/api/categories"),api<{items:Product[]}>("/api/admin/products")]);setCategories(c.items);setProducts(p.items);}
    if(tab==="reports")setSummary(await api<Summary>(`/api/reports/day?date=${reportDate}`));
    if(tab==="users")setUsers((await api<{items:User[]}>("/api/admin/users")).items);
    if(tab==="audit")setAudit((await api<{items:Audit[]}>("/api/admin/audit?limit=100")).items);
  }catch(error){setMessage(error instanceof Error?error.message:"Error");}},[tab,reportDate]);
  useEffect(()=>{void load();},[load]);
  async function submit(url:string,body:unknown,form:HTMLFormElement){if(busy)return;setBusy(true);setMessage("");try{await api(url,{method:"POST",body:JSON.stringify(body)});form.reset();setMessage(ru?"Сохранено":"Saqlandi");await load();}catch(error){setMessage(error instanceof Error?error.message:"Error");}finally{setBusy(false);}}
  const field=(form:FormData,name:string)=>String(form.get(name)??"").trim();
  function categorySubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);void submit("/api/admin/categories",{nameRu:field(f,"nameRu"),nameUz:field(f,"nameUz")},event.currentTarget);}
  function productSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);void submit("/api/admin/products",{sku:field(f,"sku"),barcode:field(f,"barcode")||null,nameRu:field(f,"nameRu"),nameUz:field(f,"nameUz"),categoryId:field(f,"categoryId"),salePrice:field(f,"salePrice"),purchasePrice:field(f,"purchasePrice"),minimumStock:Number(field(f,"minimumStock")||0)},event.currentTarget);}
  function userSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);void submit("/api/admin/users",{login:field(f,"login"),displayName:field(f,"displayName"),password:field(f,"password"),role:field(f,"role"),locale:field(f,"locale")},event.currentTarget);}
  async function restock(product:Product){const raw=window.prompt(ru?`Количество для ${product.nameRu}`:`${product.nameUz} miqdori`,"1");if(!raw)return;const quantity=Number(raw);if(!Number.isInteger(quantity)||quantity<=0){setMessage(ru?"Некорректное количество":"Noto‘g‘ri miqdor");return;}await api(`/api/admin/products/${product.id}/restock`,{method:"POST",body:JSON.stringify({quantity,purchasePrice:product.purchasePrice,note:"Admin UI restock"})});await load();}
  const labels=ru?{dashboard:"Сегодня",catalog:"Товары",reports:"Отчёты",users:"Пользователи",audit:"Аудит"}:{dashboard:"Bugun",catalog:"Mahsulotlar",reports:"Hisobotlar",users:"Foydalanuvchilar",audit:"Audit"};
  return <section className="adminArea">
    <nav className="adminTabs">{(Object.keys(labels) as Array<keyof typeof labels>).map(key=><button key={key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{labels[key]}</button>)}</nav>
    {message&&<div className="notice" role="status">{message}</div>}
    {(tab==="dashboard"||tab==="reports")&&<div>
      {tab==="reports"&&<div className="reportToolbar"><input type="date" value={reportDate} onChange={e=>setReportDate(e.target.value)}/><a className="buttonLink" href={`/api/reports/day/pdf?date=${reportDate}`} target="_blank">PDF</a></div>}
      {summary&&<div className="metricGrid">{[
        [ru?"Выручка":"Tushum",summary.actualRevenue],[ru?"Валовая прибыль":"Yalpi foyda",summary.grossProfit],[ru?"Расходы":"Xarajatlar",summary.expenses],[ru?"Чистая прибыль":"Sof foyda",summary.netProfit],[ru?"Торг":"Chegirma",summary.discountAmount],[ru?"Возвраты":"Qaytarish",summary.returnsAmount],[ru?"Чеки":"Cheklar",String(summary.checks)],[ru?"Средний чек":"O‘rtacha chek",summary.averageCheck]
      ].map(([label,value],i)=><article className={i===3?"metric accent":"metric"} key={label}><span>{label}</span><strong>{i===6?value:money(value!,language)}</strong></article>)}</div>}
    </div>}
    {tab==="catalog"&&<div className="adminColumns"><div>
      <form className="adminForm" onSubmit={categorySubmit}><h2>{ru?"Новая категория":"Yangi kategoriya"}</h2><input name="nameRu" placeholder="Русское название" required/><input name="nameUz" placeholder="O‘zbekcha nomi" required/><button className="primary" disabled={busy}>{ru?"Создать":"Yaratish"}</button></form>
      <form className="adminForm" onSubmit={productSubmit}><h2>{ru?"Новый товар":"Yangi mahsulot"}</h2><div className="formGrid"><input name="sku" placeholder="SKU" required/><input name="barcode" placeholder="Barcode"/><input name="nameRu" placeholder="Название RU" required/><input name="nameUz" placeholder="Nomi UZ" required/><select name="categoryId" required defaultValue=""><option value="" disabled>{ru?"Категория":"Kategoriya"}</option>{categories.filter(c=>c.active).map(c=><option value={c.id} key={c.id}>{ru?c.nameRu:c.nameUz}</option>)}</select><input name="salePrice" inputMode="numeric" placeholder={ru?"Цена продажи":"Sotuv narxi"} required/><input name="purchasePrice" inputMode="numeric" placeholder={ru?"Закупочная цена":"Xarid narxi"} required/><input name="minimumStock" inputMode="numeric" placeholder={ru?"Минимальный остаток":"Minimal qoldiq"}/></div><button className="primary" disabled={busy}>{ru?"Создать товар":"Mahsulot yaratish"}</button></form>
    </div><div className="adminList"><h2>{ru?"Остатки":"Qoldiqlar"}</h2>{products.map(p=><article key={p.id}><div><strong>{ru?p.nameRu:p.nameUz}</strong><small>{p.sku} · {money(p.salePrice,language)}</small></div><span className={p.quantity<=p.minimumStock?"warn":""}>{p.quantity}</span><button onClick={()=>void restock(p)}>+ {ru?"Поступление":"Kirim"}</button></article>)}</div></div>}
    {tab==="users"&&<div className="adminColumns"><form className="adminForm" onSubmit={userSubmit}><h2>{ru?"Новый пользователь":"Yangi foydalanuvchi"}</h2><input name="login" placeholder="Login" required/><input name="displayName" placeholder={ru?"Имя":"Ism"} required/><input name="password" type="password" minLength={10} placeholder={ru?"Пароль (10+ знаков)":"Parol (10+ belgi)"} required/><select name="role"><option>ADMIN</option><option>CASHIER</option></select><select name="locale"><option value="ru">Русский</option><option value="uz">O‘zbekcha</option></select><button className="primary" disabled={busy}>{ru?"Создать":"Yaratish"}</button></form><div className="adminList">{users.map(u=><article key={u.id}><div><strong>{u.displayName}</strong><small>{u.login} · {u.locale.toUpperCase()}</small></div><span>{u.role}</span><span>{u.active?"●":"○"}</span></article>)}</div></div>}
    {tab==="audit"&&<div className="auditTable">{audit.map(a=><article key={a.id}><time>{new Date(a.createdAt).toLocaleString(ru?"ru-RU":"uz-UZ")}</time><strong>{a.action}</strong><span>{a.userName??"system"}</span><small>{a.entityType} · {a.entityId}</small></article>)}</div>}
  </section>;
}
