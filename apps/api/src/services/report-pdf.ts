import {fileURLToPath} from "node:url";
import PDFDocument from "pdfkit";

type Summary = Awaited<ReturnType<typeof import("./reports.js").reportSummary>>;
type Product = Awaited<ReturnType<typeof import("./reports.js").productReport>>[number];
type Bucket = {date?: string; month?: string; revenue: string};

const regularFont = fileURLToPath(import.meta.resolve("@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff"));
const boldFont = fileURLToPath(import.meta.resolve("@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff"));
const money = (value: string) => new Intl.NumberFormat("ru-RU").format(BigInt(value)) + " сум";

function row(doc: PDFKit.PDFDocument, label: string, value: string, strong = false) {
  const y = doc.y;
  doc.font(strong ? "NotoBold" : "Noto").fontSize(strong ? 11 : 9).text(label, 48, y, {width: 260});
  doc.text(value, 320, y, {width: 225, align: "right"});
  doc.moveDown(0.55);
}

export async function createReportPdf(input: {
  title: string;
  period: string;
  summary: Summary;
  products: Product[];
  buckets?: Bucket[];
}) {
  const doc = new PDFDocument({size: "A4",margin: 48,bufferPages: true,compress: false,info: {
    Title: input.title,Author: "Independent POS",Subject: input.period,
  }});
  doc.registerFont("Noto", regularFont);
  doc.registerFont("NotoBold", boldFont);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("NotoBold").fontSize(19).text("Independent POS", {align: "center"});
  doc.fontSize(15).text(input.title, {align: "center"});
  doc.font("Noto").fontSize(10).text(input.period, {align: "center"}).moveDown(1.2);
  row(doc,"Выручка до скидок",money(input.summary.originalRevenue));
  row(doc,"Торг / скидки",money(input.summary.discountAmount));
  row(doc,"Продажи после скидок",money(input.summary.salesRevenue));
  row(doc,"Возвраты",money(input.summary.returnsAmount));
  row(doc,"Фактическая выручка",money(input.summary.actualRevenue),true);
  row(doc,"Себестоимость",money(input.summary.costOfGoods));
  row(doc,"Валовая прибыль",money(input.summary.grossProfit));
  row(doc,"Расходы",money(input.summary.expenses));
  row(doc,"Чистая прибыль",money(input.summary.netProfit),true);
  row(doc,"Чеки",String(input.summary.checks));
  row(doc,"Проданные единицы",input.summary.units);
  row(doc,"Средний чек",money(input.summary.averageCheck));

  doc.moveDown().font("NotoBold").fontSize(12).text("Способы оплаты").moveDown(0.4);
  for (const payment of input.summary.payments) row(doc,payment.method,money(payment.net));

  if (input.buckets?.length) {
    doc.addPage().font("NotoBold").fontSize(13).text("Динамика периода").moveDown(0.5);
    for (const bucket of input.buckets) row(doc,bucket.date ?? bucket.month ?? "",money(bucket.revenue));
  }

  if (input.products.length) {
    doc.addPage().font("NotoBold").fontSize(13).text("Продажи по товарам").moveDown(0.6);
    for (const product of input.products) {
      if (doc.y > 735) doc.addPage();
      doc.font("NotoBold").fontSize(9).text(product.nameRu,48,doc.y,{width: 260});
      doc.font("Noto").text(`${product.units} шт. · ${money(product.revenue)}`,310,doc.y-11,{width:235,align:"right"});
      doc.fontSize(8).fillColor("#555555").text(`Себестоимость: ${money(product.cost)} · Прибыль: ${money(product.grossProfit)}`);
      doc.fillColor("#000000").moveDown(0.45);
    }
  }

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(pages.start + index);
    doc.font("Noto").fontSize(8).fillColor("#666666")
      .text(`${index + 1} / ${pages.count}`,48,806,{width:497,align:"center",lineBreak:false});
  }
  doc.end();
  return completed;
}
