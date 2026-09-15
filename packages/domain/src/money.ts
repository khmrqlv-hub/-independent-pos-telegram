export type Money = bigint;

const MONEY_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export function money(value: string | bigint): Money {
  const parsed = typeof value === "bigint"
    ? value
    : MONEY_PATTERN.test(value) ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > MAX_BIGINT) throw new Error("Invalid money amount");
  return parsed;
}

export function formatUzs(value: Money, locale: "ru" | "uz" = "ru"): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
    maximumFractionDigits: 0,
  }).format(value) + " сум";
}

export type Discount =
  | {type: "NONE"}
  | {type: "FIXED"; amount: Money}
  | {type: "PERCENT"; basisPoints: number};

export interface PricedLine {
  productId: string;
  quantity: number;
  salePrice: Money;
  purchasePrice: Money;
}

export interface CalculatedLine extends PricedLine {
  originalTotal: Money;
  discountAmount: Money;
  finalTotal: Money;
  costTotal: Money;
}

function discountTotal(originalTotal: Money, discount: Discount): Money {
  if (discount.type === "NONE") return 0n;
  if (discount.type === "FIXED") {
    if (discount.amount < 0n || discount.amount > originalTotal) throw new Error("Invalid discount");
    return discount.amount;
  }
  if (!Number.isInteger(discount.basisPoints) || discount.basisPoints < 0 || discount.basisPoints > 10_000) {
    throw new Error("Invalid discount percentage");
  }
  return originalTotal * BigInt(discount.basisPoints) / 10_000n;
}

export function calculateSale(lines: readonly PricedLine[], discount: Discount) {
  if (lines.length === 0) throw new Error("Sale requires at least one item");
  const ids = new Set<string>();
  const prepared = lines.map((line) => {
    if (!line.productId || ids.has(line.productId)) throw new Error("Duplicate product");
    ids.add(line.productId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Invalid quantity");
    if (line.salePrice < 0n || line.purchasePrice < 0n) throw new Error("Invalid price");
    const originalTotal = line.salePrice * BigInt(line.quantity);
    return {...line, originalTotal, costTotal: line.purchasePrice * BigInt(line.quantity)};
  });
  const originalTotal = prepared.reduce((sum, line) => sum + line.originalTotal, 0n);
  const discountAmount = discountTotal(originalTotal, discount);
  const ranked = prepared.map((line, index) => ({
    index,
    base: originalTotal === 0n ? 0n : line.originalTotal * discountAmount / originalTotal,
    remainder: originalTotal === 0n ? 0n : line.originalTotal * discountAmount % originalTotal,
    productId: line.productId,
  }));
  let unallocated = discountAmount - ranked.reduce((sum, item) => sum + item.base, 0n);
  ranked.sort((a, b) => a.remainder === b.remainder
    ? a.productId.localeCompare(b.productId)
    : a.remainder > b.remainder ? -1 : 1);
  const discounts = new Array<Money>(prepared.length).fill(0n);
  for (const item of ranked) {
    discounts[item.index] = item.base + (unallocated > 0n ? 1n : 0n);
    if (unallocated > 0n) unallocated -= 1n;
  }
  const calculated: CalculatedLine[] = prepared.map((line, index) => ({
    ...line,
    discountAmount: discounts[index] ?? 0n,
    finalTotal: line.originalTotal - (discounts[index] ?? 0n),
  }));
  const finalTotal = originalTotal - discountAmount;
  if (calculated.reduce((sum, line) => sum + line.finalTotal, 0n) !== finalTotal) {
    throw new Error("Discount allocation invariant failed");
  }
  return {
    lines: calculated,
    originalTotal,
    discountAmount,
    finalTotal,
    costTotal: calculated.reduce((sum, line) => sum + line.costTotal, 0n),
  };
}

export function calculateFinancials(input: {
  salesFinal: Money;
  salesCost: Money;
  returnsAmount: Money;
  returnedCost: Money;
  damagedReturnCost: Money;
  regularExpenses: Money;
}) {
  for (const value of Object.values(input)) if (value < 0n) throw new Error("Negative financial input");
  if (input.returnsAmount > input.salesFinal || input.returnedCost > input.salesCost) {
    throw new Error("Returns exceed sales");
  }
  const actualRevenue = input.salesFinal - input.returnsAmount;
  // Only merchandise actually accepted back into sellable stock reverses COGS.
  // A damaged/non-restocked return keeps its original cost in COGS; counting it
  // again as an expense would subtract the same loss twice.
  const costOfGoods = input.salesCost - input.returnedCost;
  const grossProfit = actualRevenue - costOfGoods;
  const expenses = input.regularExpenses;
  return {actualRevenue, costOfGoods, grossProfit, expenses, netProfit: grossProfit - expenses};
}
