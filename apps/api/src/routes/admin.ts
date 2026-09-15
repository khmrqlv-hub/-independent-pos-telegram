import {randomUUID} from "node:crypto";
import {hash} from "bcryptjs";
import type {FastifyInstance, FastifyRequest} from "fastify";
import {z} from "zod";
import {sql} from "../db.js";
import {HttpError} from "../http-error.js";
import {assertSameOrigin, requireStaff, type StaffUser} from "../security.js";

const uuid = z.string().uuid();
const money = z.string().regex(/^(0|[1-9]\d*)$/).max(19);
const idParam = z.object({id: uuid});
const pageQuery = z.object({cursor:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(40)});
const categoryInput = z.object({nameRu:z.string().trim().min(1).max(200),nameUz:z.string().trim().min(1).max(200)});
const productInput = z.object({
  sku:z.string().trim().min(1).max(100),barcode:z.string().trim().min(1).max(200).nullable().optional(),
  nameRu:z.string().trim().min(1).max(300),nameUz:z.string().trim().min(1).max(300),categoryId:uuid,
  salePrice:money,purchasePrice:money,minimumStock:z.number().int().min(0).max(2_147_483_647).default(0),
});
const productUpdateInput = productInput.extend({active:z.boolean()});
const restockInput = z.object({quantity:z.number().int().positive().max(2_147_483_647),purchasePrice:money,note:z.string().trim().max(1000).optional()});
const userInput = z.object({login:z.string().trim().min(3).max(100),displayName:z.string().trim().min(1).max(200),
  password:z.string().min(10).max(128),role:z.enum(["ADMIN","CASHIER"]),locale:z.enum(["ru","uz"])});
const userUpdateInput = z.object({displayName:z.string().trim().min(1).max(200),role:z.enum(["ADMIN","CASHIER"]),
  locale:z.enum(["ru","uz"]),active:z.boolean(),password:z.string().min(10).max(128).optional()});

const meta = (request: FastifyRequest) => ({ip:request.ip,userAgent:request.headers["user-agent"] ?? null,requestId:request.id});
async function audit(transaction: any, actor: StaffUser, request: FastifyRequest, action: string, entityType: string,
  entityId: string, oldData: unknown, newData: unknown) {
  const m=meta(request);
  await transaction`INSERT INTO audit_log(user_id,action,entity_type,entity_id,old_data,new_data,ip,user_agent,request_id)
    VALUES(${actor.id},${action},${entityType},${entityId},${oldData ? transaction.json(oldData as never):null},
      ${newData ? transaction.json(newData as never):null},${m.ip},${m.userAgent},${m.requestId})`;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/categories", async (request) => {
    await requireStaff(request);
    return {items:await sql`SELECT id,name_ru "nameRu",name_uz "nameUz",active FROM categories ORDER BY active DESC,name_ru`};
  });

  app.post("/api/admin/categories", async (request) => {
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const input=categoryInput.parse(request.body);
    return sql.begin(async transaction => {
      const [created]=await transaction<{id:string}[]>`INSERT INTO categories(name_ru,name_uz) VALUES(${input.nameRu},${input.nameUz}) RETURNING id`;
      await audit(transaction,actor,request,"CREATE_CATEGORY","category",created!.id,null,input);
      return {id:created!.id};
    });
  });

  app.post("/api/admin/categories/:id/archive", async (request) => {
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const {id}=idParam.parse(request.params);
    const [old]=await sql<{active:boolean}[]>`SELECT active FROM categories WHERE id=${id}`;
    if (!old) throw new HttpError(404,"Category not found","NOT_FOUND");
    await sql.begin(async transaction=>{await transaction`UPDATE categories SET active=false,updated_at=now() WHERE id=${id}`;
      await audit(transaction,actor,request,"ARCHIVE_CATEGORY","category",id,old,{active:false});});
    return {ok:true};
  });

  app.post("/api/admin/products", async (request) => {
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const input=productInput.parse(request.body);
    return sql.begin(async transaction=>{
      const [created]=await transaction<{id:string}[]>`INSERT INTO products(sku,barcode,name_ru,name_uz,category_id,sale_price,purchase_price,minimum_stock)
        SELECT ${input.sku},${input.barcode||null},${input.nameRu},${input.nameUz},${input.categoryId},${input.salePrice},${input.purchasePrice},${input.minimumStock}
        WHERE EXISTS(SELECT 1 FROM categories WHERE id=${input.categoryId} AND active=true) RETURNING id`;
      if (!created) throw new HttpError(400,"Active category not found","CATEGORY_INVALID");
      await audit(transaction,actor,request,"CREATE_PRODUCT","product",created.id,null,input);
      return {id:created.id};
    });
  });

  app.get("/api/admin/products", async request=>{await requireStaff(request,"ADMIN"); return {items:await sql`SELECT p.id,p.sku,p.barcode,p.name_ru "nameRu",p.name_uz "nameUz",p.category_id "categoryId",p.sale_price::text "salePrice",p.purchase_price::text "purchasePrice",p.quantity,p.minimum_stock "minimumStock",p.active FROM products p ORDER BY p.active DESC,p.updated_at DESC LIMIT 100`};});

  app.post("/api/admin/products/:id/update", async (request) => {
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const {id}=idParam.parse(request.params); const input=productUpdateInput.parse(request.body);
    return sql.begin(async transaction=>{
      const [old]=await transaction<Record<string,unknown>[]>`SELECT sku,barcode,name_ru,sale_price::text,purchase_price::text,active FROM products WHERE id=${id} FOR UPDATE`;
      if (!old) throw new HttpError(404,"Product not found","NOT_FOUND");
      await transaction`UPDATE products SET sku=${input.sku},barcode=${input.barcode||null},name_ru=${input.nameRu},name_uz=${input.nameUz},
        category_id=${input.categoryId},sale_price=${input.salePrice},purchase_price=${input.purchasePrice},minimum_stock=${input.minimumStock},active=${input.active},updated_at=now() WHERE id=${id}`;
      const action=old.sale_price!==input.salePrice?"CHANGE_PRICE":old.purchase_price!==input.purchasePrice?"CHANGE_PURCHASE_PRICE":"UPDATE_PRODUCT";
      await audit(transaction,actor,request,action,"product",id,old,input); return {ok:true};
    });
  });

  app.post("/api/admin/products/:id/restock", async (request) => {
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const {id}=idParam.parse(request.params); const input=restockInput.parse(request.body);
    return sql.begin(async transaction=>{
      const [product]=await transaction<{quantity:number;purchasePrice:string}[]>`SELECT quantity,purchase_price::text "purchasePrice" FROM products WHERE id=${id} AND active=true FOR UPDATE`;
      if (!product) throw new HttpError(404,"Product not found","NOT_FOUND");
      const after=product.quantity+input.quantity;
      if (after>2_147_483_647) throw new HttpError(400,"Stock limit exceeded","STOCK_LIMIT");
      await transaction`UPDATE products SET quantity=${after},purchase_price=${input.purchasePrice},stock_version=stock_version+1,updated_at=now() WHERE id=${id}`;
      await transaction`INSERT INTO stock_movements(product_id,type,quantity_change,quantity_before,quantity_after,user_id,reason)
        VALUES(${id},'RESTOCK',${input.quantity},${product.quantity},${after},${actor.id},${input.note??null})`;
      await audit(transaction,actor,request,"STOCK_ADJUSTMENT","product",id,product,{quantity:after,purchasePrice:input.purchasePrice});
      return {quantity:after};
    });
  });

  app.get("/api/admin/users", async request=>{await requireStaff(request,"ADMIN"); return {items:await sql`SELECT id,login,email,phone,display_name "displayName",role,locale,active,created_at "createdAt" FROM users ORDER BY created_at DESC`};});
  app.post("/api/admin/users", async request=>{
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const input=userInput.parse(request.body); const passwordHash=await hash(input.password,12);
    return sql.begin(async transaction=>{const [created]=await transaction<{id:string}[]>`INSERT INTO users(login,display_name,role,locale) VALUES(${input.login},${input.displayName},${input.role},${input.locale}) RETURNING id`;
      await transaction`INSERT INTO password_credentials(user_id,password_hash) VALUES(${created!.id},${passwordHash})`;
      await audit(transaction,actor,request,"USER_CREATE","user",created!.id,null,{...input,password:undefined}); return {id:created!.id};});
  });
  app.post("/api/admin/users/:id/update", async request=>{
    assertSameOrigin(request); const actor=await requireStaff(request,"ADMIN"); const {id}=idParam.parse(request.params); const input=userUpdateInput.parse(request.body);
    if (id===actor.id && (!input.active || input.role!=="ADMIN")) throw new HttpError(400,"You cannot remove your own admin access","SELF_LOCKOUT");
    const passwordHash=input.password?await hash(input.password,12):null;
    await sql.begin(async transaction=>{const [old]=await transaction<Record<string,unknown>[]>`SELECT display_name,role,locale,active FROM users WHERE id=${id} FOR UPDATE`;
      if(!old) throw new HttpError(404,"User not found","NOT_FOUND");
      await transaction`UPDATE users SET display_name=${input.displayName},role=${input.role},locale=${input.locale},active=${input.active},updated_at=now() WHERE id=${id}`;
      if(passwordHash) await transaction`INSERT INTO password_credentials(user_id,password_hash) VALUES(${id},${passwordHash}) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,changed_at=now()`;
      if(!input.active) await transaction`DELETE FROM sessions WHERE user_id=${id}`;
      await audit(transaction,actor,request,old.role!==input.role?"ROLE_CHANGE":"USER_UPDATE","user",id,old,{...input,password:undefined});}); return {ok:true};
  });

  app.get("/api/admin/audit", async request=>{await requireStaff(request,"ADMIN"); const input=pageQuery.parse(request.query);
    const items=await sql`SELECT a.id::text,u.display_name "userName",a.action,a.entity_type "entityType",a.entity_id "entityId",a.old_data "oldData",a.new_data "newData",a.ip::text,a.created_at "createdAt"
      FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.id>${input.cursor} ORDER BY a.id DESC LIMIT ${input.limit}`; return {items};});

  app.get("/api/admin/sales", async request=>{await requireStaff(request,"ADMIN"); const input=pageQuery.parse(request.query);
    return {items:await sql`SELECT s.id,s.receipt_number::text "receiptNumber",u.display_name "cashierName",s.created_at "createdAt",s.payment_method "paymentMethod",s.final_total::text "finalTotal",
      COALESCE((SELECT sum(r.amount) FROM return_items r JOIN returns x ON x.id=r.return_id WHERE x.original_sale_id=s.id),0)::text "returnedAmount"
      FROM sales s JOIN users u ON u.id=s.cashier_id WHERE s.receipt_number>${input.cursor} ORDER BY s.receipt_number DESC LIMIT ${input.limit}`};});

  app.get("/api/admin/dashboard", async request=>{await requireStaff(request,"ADMIN"); const today=await sql<{day:string}[]>`SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date::text day`;
    const day=today[0]!.day; const [stock]=await sql<{low:number;out:number}[]>`SELECT count(*) FILTER(WHERE quantity<=minimum_stock)::int low,count(*) FILTER(WHERE quantity=0)::int out FROM products WHERE active=true`;
    return {day,stock,recentSales:(await sql`SELECT receipt_number::text "receiptNumber",final_total::text "finalTotal",created_at "createdAt" FROM sales ORDER BY created_at DESC LIMIT 8`)};
  });
}
