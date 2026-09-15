import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireStaff} from "../security.js";
import {dailyBuckets, monthlyBuckets, productReport, reportRange, reportSummary} from "../services/reports.js";

const dayQuery = z.object({date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
const monthQuery = z.object({month: z.string().regex(/^\d{4}-\d{2}$/)});
const yearQuery = z.object({year: z.string().regex(/^\d{4}$/)});
const productsQuery = z.object({
  from: z.string().datetime({offset: true}),to: z.string().datetime({offset: true}),
  sort: z.enum(["quantity","revenue","profit"]).default("revenue"),
});

export async function reportRoutes(app: FastifyInstance) {
  app.get("/api/reports/day", async (request) => {
    await requireStaff(request, "ADMIN");
    const {date} = dayQuery.parse(request.query);
    return reportSummary(await reportRange("day", date));
  });
  app.get("/api/reports/month", async (request) => {
    await requireStaff(request, "ADMIN");
    const {month} = monthQuery.parse(request.query);
    const range = await reportRange("month", month);
    return {...await reportSummary(range), days: await dailyBuckets(range)};
  });
  app.get("/api/reports/year", async (request) => {
    await requireStaff(request, "ADMIN");
    const {year} = yearQuery.parse(request.query);
    const range = await reportRange("year", year);
    return {...await reportSummary(range), months: await monthlyBuckets(range)};
  });
  app.get("/api/reports/products", async (request) => {
    await requireStaff(request, "ADMIN");
    const input = productsQuery.parse(request.query);
    const range = {from: new Date(input.from),to: new Date(input.to)};
    if (range.from >= range.to) throw new z.ZodError([{code:"custom",path:["from"],message:"Invalid report period"}]);
    return {items: await productReport(range, input.sort)};
  });
}
