import assert from "node:assert/strict";
import test from "node:test";
import {calculateFinancials, calculateSale, money} from "./money.js";

test("never parses floating point money", () => {
  assert.equal(money("125000"), 125000n);
  assert.throws(() => money("125000.50"));
  assert.throws(() => money("-1"));
});

test("fixed bargain is allocated exactly once", () => {
  const result = calculateSale([
    {productId: "a", quantity: 2, salePrice: 300000n, purchasePrice: 200000n},
    {productId: "b", quantity: 1, salePrice: 400000n, purchasePrice: 250000n},
  ], {type: "FIXED", amount: 100000n});
  assert.equal(result.originalTotal, 1000000n);
  assert.equal(result.discountAmount, 100000n);
  assert.equal(result.finalTotal, 900000n);
  assert.equal(result.lines.reduce((sum, line) => sum + line.finalTotal, 0n), 900000n);
});

test("percentage uses integer basis points", () => {
  const result = calculateSale([
    {productId: "a", quantity: 3, salePrice: 100001n, purchasePrice: 1n},
  ], {type: "PERCENT", basisPoints: 1250});
  assert.equal(result.discountAmount, 37500n);
  assert.equal(result.finalTotal, 262503n);
});

test("financial control produces 2,500,000 UZS", () => {
  const result = calculateFinancials({
    salesFinal: 10000000n,
    salesCost: 6000000n,
    returnsAmount: 500000n,
    returnedCost: 0n,
    damagedReturnCost: 300000n,
    regularExpenses: 1000000n,
  });
  assert.equal(result.netProfit, 2500000n);
});

test("a sellable return reverses its cost without double counting", () => {
  const result = calculateFinancials({
    salesFinal: 10000000n,
    salesCost: 6000000n,
    returnsAmount: 500000n,
    returnedCost: 300000n,
    damagedReturnCost: 0n,
    regularExpenses: 1000000n,
  });
  assert.equal(result.costOfGoods, 5700000n);
  assert.equal(result.netProfit, 2800000n);
});
