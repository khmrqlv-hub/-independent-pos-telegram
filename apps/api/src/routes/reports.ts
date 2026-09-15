import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireStaff} from "../security.js";
import {dailyBuckets, monthlyBuckets, productReport, reportRange, reportSummary} from "../services/reports.js";
import {createReportPdf} from "../services/report-pdf.js";

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

  app.get("/api/reports/day/pdf", async (request, reply) => {
    await requireStaff(request, "ADMIN");
    const {date} = dayQuery.parse(request.query);
    const range = await reportRange("day", date);
    const summary = await reportSummary(range);
    const pdf = await createReportPdf({title: "Отчёт за день",period: date,summary,products: await productReport(range,"revenue")});
    return reply.type("application/pdf").header("Content-Disposition",`inline; filename="day-${date}.pdf"`)
      .header("X-Report-Net-Profit",summary.netProfit).send(pdf);
  });
  app.get("/api/reports/month/pdf", async (request, reply) => {
    await requireStaff(request, "ADMIN");
    const {month} = monthQuery.parse(request.query);
    const range = await reportRange("month", month);
    const summary = await reportSummary(range);
    const pdf = await createReportPdf({title: "Отчёт за месяц",period: month,summary,
      products: await productReport(range,"revenue"),buckets: await dailyBuckets(range)});
    return reply.type("application/pdf").header("Content-Disposition",`inline; filename="month-${month}.pdf"`)
      .header("X-Report-Net-Profit",summary.netProfit).send(pdf);
  });
  app.get("/api/reports/year/pdf", async (request, reply) => {
    await requireStaff(request, "ADMIN");
    const {year} = yearQuery.parse(request.query);
    const range = await reportRange("year", year);
    const summary = await reportSummary(range);
    const pdf = await createReportPdf({title: "Отчёт за год",period: year,summary,
      products: await productReport(range,"revenue"),buckets: await monthlyBuckets(range)});
    return reply.type("application/pdf").header("Content-Disposition",`inline; filename="year-${year}.pdf"`)
      .header("X-Report-Net-Profit",summary.netProfit).send(pdf);
  });
}
