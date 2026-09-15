import {sql} from "../db.js";

type Range = {from: Date; to: Date};

export async function reportRange(kind: "day" | "month" | "year", value: string): Promise<Range> {
  const interval = kind === "day" ? "1 day" : kind === "month" ? "1 month" : "1 year";
  const source = kind === "day" ? value : kind === "month" ? `${value}-01` : `${value}-01-01`;
  const rows = await sql<Range[]>`SELECT
    (${source}::date::timestamp AT TIME ZONE 'Asia/Tashkent') "from",
    ((${source}::date::timestamp + ${interval}::interval) AT TIME ZONE 'Asia/Tashkent') "to"`;
  return rows[0]!;
}

export async function reportSummary({from, to}: Range) {
  const rows = await sql<{
    originalRevenue: string; discountAmount: string; salesRevenue: string; returnsAmount: string;
    actualRevenue: string; salesCost: string; returnedCost: string; costOfGoods: string;
    grossProfit: string; expenses: string; netProfit: string; checks: number; units: string; averageCheck: string;
  }[]>`WITH sale_totals AS (
      SELECT coalesce(sum(original_total),0)::bigint original_revenue,
        coalesce(sum(discount_amount),0)::bigint discount_amount,
        coalesce(sum(final_total),0)::bigint sales_revenue,count(*)::int checks
      FROM sales WHERE created_at>=${from} AND created_at<${to}
    ), sold AS (
      SELECT coalesce(sum(si.purchase_price_at_sale*si.quantity),0)::bigint sales_cost,
        coalesce(sum(si.quantity),0)::bigint units
      FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.created_at>=${from} AND s.created_at<${to}
    ), returned AS (
      SELECT coalesce(sum(ri.amount),0)::bigint returns_amount,
        coalesce(sum(ri.cost_amount) FILTER(WHERE ri.restocked),0)::bigint returned_cost,
        coalesce(sum(ri.quantity),0)::bigint units
      FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.created_at>=${from} AND r.created_at<${to}
    ), spent AS (
      SELECT coalesce(sum(amount),0)::bigint expenses FROM expenses WHERE created_at>=${from} AND created_at<${to}
    )
    SELECT st.original_revenue::text "originalRevenue",st.discount_amount::text "discountAmount",
      st.sales_revenue::text "salesRevenue",r.returns_amount::text "returnsAmount",
      (st.sales_revenue-r.returns_amount)::text "actualRevenue",s.sales_cost::text "salesCost",
      r.returned_cost::text "returnedCost",(s.sales_cost-r.returned_cost)::text "costOfGoods",
      (st.sales_revenue-r.returns_amount-s.sales_cost+r.returned_cost)::text "grossProfit",
      e.expenses::text expenses,
      (st.sales_revenue-r.returns_amount-s.sales_cost+r.returned_cost-e.expenses)::text "netProfit",
      st.checks,(s.units-r.units)::text units,
      CASE WHEN st.checks=0 THEN '0' ELSE ((st.sales_revenue-r.returns_amount)/st.checks)::text END "averageCheck"
    FROM sale_totals st CROSS JOIN sold s CROSS JOIN returned r CROSS JOIN spent e`;

  const payments = await sql<{method: string; sales: string; returns: string; net: string}[]>`WITH methods AS (
      SELECT unnest(enum_range(NULL::payment_method)) method
    ), paid AS (
      SELECT sp.method,coalesce(sum(sp.amount),0)::bigint amount FROM sale_payments sp
      JOIN sales s ON s.id=sp.sale_id WHERE s.created_at>=${from} AND s.created_at<${to} GROUP BY sp.method
    ), refunded AS (
      SELECT s.payment_method method,coalesce(sum(ri.amount),0)::bigint amount FROM return_items ri
      JOIN returns r ON r.id=ri.return_id JOIN sales s ON s.id=r.original_sale_id
      WHERE r.created_at>=${from} AND r.created_at<${to} GROUP BY s.payment_method
    )
    SELECT m.method::text method,coalesce(p.amount,0)::text sales,coalesce(r.amount,0)::text returns,
      (coalesce(p.amount,0)-coalesce(r.amount,0))::text net FROM methods m
      LEFT JOIN paid p ON p.method=m.method LEFT JOIN refunded r ON r.method=m.method ORDER BY m.method`;
  return {...rows[0]!, from: from.toISOString(), to: to.toISOString(), payments};
}

export async function dailyBuckets({from, to}: Range) {
  return sql<{date: string; revenue: string}[]>`WITH days AS (
      SELECT generate_series((${from} AT TIME ZONE 'Asia/Tashkent')::date,
        ((${to} AT TIME ZONE 'Asia/Tashkent')::date-1),interval '1 day')::date bucket_date
    ), sold AS (
      SELECT (created_at AT TIME ZONE 'Asia/Tashkent')::date bucket_date,sum(final_total)::bigint amount FROM sales
      WHERE created_at>=${from} AND created_at<${to} GROUP BY 1
    ), refunded AS (
      SELECT (r.created_at AT TIME ZONE 'Asia/Tashkent')::date bucket_date,sum(ri.amount)::bigint amount
      FROM returns r JOIN return_items ri ON ri.return_id=r.id WHERE r.created_at>=${from} AND r.created_at<${to} GROUP BY 1
    ) SELECT to_char(d.bucket_date,'YYYY-MM-DD') "date",(coalesce(s.amount,0)-coalesce(r.amount,0))::text revenue
      FROM days d LEFT JOIN sold s ON s.bucket_date=d.bucket_date
      LEFT JOIN refunded r ON r.bucket_date=d.bucket_date ORDER BY d.bucket_date`;
}

export async function monthlyBuckets({from, to}: Range) {
  return sql<{month: string; revenue: string}[]>`WITH months AS (
      SELECT generate_series(date_trunc('month',${from} AT TIME ZONE 'Asia/Tashkent'),
        date_trunc('month',(${to} AT TIME ZONE 'Asia/Tashkent')-interval '1 second'),interval '1 month') bucket_month
    ), sold AS (
      SELECT date_trunc('month',created_at AT TIME ZONE 'Asia/Tashkent') bucket_month,sum(final_total)::bigint amount FROM sales
      WHERE created_at>=${from} AND created_at<${to} GROUP BY 1
    ), refunded AS (
      SELECT date_trunc('month',r.created_at AT TIME ZONE 'Asia/Tashkent') bucket_month,sum(ri.amount)::bigint amount
      FROM returns r JOIN return_items ri ON ri.return_id=r.id WHERE r.created_at>=${from} AND r.created_at<${to} GROUP BY 1
    ) SELECT to_char(m.bucket_month,'YYYY-MM') "month",(coalesce(s.amount,0)-coalesce(r.amount,0))::text revenue
      FROM months m LEFT JOIN sold s ON s.bucket_month=m.bucket_month
      LEFT JOIN refunded r ON r.bucket_month=m.bucket_month ORDER BY m.bucket_month`;
}

export async function productReport({from, to}: Range, sort: "quantity" | "revenue" | "profit") {
  const order = sort === "quantity" ? sql`4 DESC` : sort === "revenue" ? sql`5 DESC` : sql`7 DESC`;
  return sql<{
    productId: string; nameRu: string; nameUz: string; units: string; revenue: string;
    cost: string; grossProfit: string; averagePrice: string; returns: string;
  }[]>`WITH sold AS (
      SELECT si.product_id,max(si.product_name_ru_at_sale) name_ru,max(si.product_name_uz_at_sale) name_uz,
        sum(si.quantity)::bigint units,sum(si.line_final_total)::bigint revenue,
        sum(si.purchase_price_at_sale*si.quantity)::bigint cost
      FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.created_at>=${from} AND s.created_at<${to}
      GROUP BY si.product_id
    ), refunded AS (
      SELECT ri.product_id,sum(ri.quantity)::bigint units,sum(ri.amount)::bigint amount,
        sum(ri.cost_amount) FILTER(WHERE ri.restocked)::bigint returned_cost
      FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.created_at>=${from} AND r.created_at<${to}
      GROUP BY ri.product_id
    ) SELECT s.product_id "productId",s.name_ru "nameRu",s.name_uz "nameUz",
      (s.units-coalesce(r.units,0))::text units,(s.revenue-coalesce(r.amount,0))::text revenue,
      (s.cost-coalesce(r.returned_cost,0))::text cost,
      (s.revenue-coalesce(r.amount,0)-s.cost+coalesce(r.returned_cost,0))::text "grossProfit",
      CASE WHEN s.units-coalesce(r.units,0)=0 THEN '0'
        ELSE ((s.revenue-coalesce(r.amount,0))/(s.units-coalesce(r.units,0)))::text END "averagePrice",
      coalesce(r.amount,0)::text returns FROM sold s LEFT JOIN refunded r ON r.product_id=s.product_id
      ORDER BY ${order},s.product_id LIMIT 1000`;
}
