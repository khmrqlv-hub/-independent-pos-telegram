import type {FastifyInstance} from "fastify";
import {productSearchInput} from "@pos/contracts";
import {sql} from "../db.js";
import {requireStaff} from "../security.js";

type ProductResult = {
  id: string; sku: string; barcode: string | null; nameRu: string; nameUz: string;
  categoryId: string; categoryRu: string; categoryUz: string; salePrice: string;
  quantity: number; minimumStock: number;
};

export async function productRoutes(app: FastifyInstance) {
  app.get("/api/products", async (request) => {
    await requireStaff(request);
    const input = productSearchInput.parse(request.query);
    const q = input.q;
    const pattern = `%${q}%`;
    let rows: ProductResult[];
    if (q && input.categoryId) {
      rows = await sql<ProductResult[]>`SELECT p.id,p.sku,p.barcode,p.name_ru "nameRu",p.name_uz "nameUz",
        p.category_id "categoryId",c.name_ru "categoryRu",c.name_uz "categoryUz",p.sale_price::text "salePrice",
        p.quantity,p.minimum_stock "minimumStock" FROM products p JOIN categories c ON c.id=p.category_id
        WHERE p.active=true AND p.category_id=${input.categoryId} AND (${input.cursor ?? null}::uuid IS NULL OR p.id>${input.cursor ?? null})
          AND (p.barcode=${q} OR p.sku ILIKE ${pattern} OR p.name_ru ILIKE ${pattern} OR p.name_uz ILIKE ${pattern})
        ORDER BY CASE WHEN p.barcode=${q} THEN 0 ELSE 1 END,p.id LIMIT ${input.limit}`;
    } else if (q) {
      rows = await sql<ProductResult[]>`SELECT p.id,p.sku,p.barcode,p.name_ru "nameRu",p.name_uz "nameUz",
        p.category_id "categoryId",c.name_ru "categoryRu",c.name_uz "categoryUz",p.sale_price::text "salePrice",
        p.quantity,p.minimum_stock "minimumStock" FROM products p JOIN categories c ON c.id=p.category_id
        WHERE p.active=true AND (${input.cursor ?? null}::uuid IS NULL OR p.id>${input.cursor ?? null})
          AND (p.barcode=${q} OR p.sku ILIKE ${pattern} OR p.name_ru ILIKE ${pattern} OR p.name_uz ILIKE ${pattern})
        ORDER BY CASE WHEN p.barcode=${q} THEN 0 ELSE 1 END,p.id LIMIT ${input.limit}`;
    } else if (input.categoryId) {
      rows = await sql<ProductResult[]>`SELECT p.id,p.sku,p.barcode,p.name_ru "nameRu",p.name_uz "nameUz",
        p.category_id "categoryId",c.name_ru "categoryRu",c.name_uz "categoryUz",p.sale_price::text "salePrice",
        p.quantity,p.minimum_stock "minimumStock" FROM products p JOIN categories c ON c.id=p.category_id
        WHERE p.active=true AND p.category_id=${input.categoryId} AND (${input.cursor ?? null}::uuid IS NULL OR p.id>${input.cursor ?? null})
        ORDER BY p.id LIMIT ${input.limit}`;
    } else {
      rows = await sql<ProductResult[]>`SELECT p.id,p.sku,p.barcode,p.name_ru "nameRu",p.name_uz "nameUz",
        p.category_id "categoryId",c.name_ru "categoryRu",c.name_uz "categoryUz",p.sale_price::text "salePrice",
        p.quantity,p.minimum_stock "minimumStock" FROM products p JOIN categories c ON c.id=p.category_id
        WHERE p.active=true AND (${input.cursor ?? null}::uuid IS NULL OR p.id>${input.cursor ?? null})
        ORDER BY p.id LIMIT ${input.limit}`;
    }
    return {items: rows, nextCursor: rows.length === input.limit ? rows.at(-1)?.id ?? null : null};
  });
}

