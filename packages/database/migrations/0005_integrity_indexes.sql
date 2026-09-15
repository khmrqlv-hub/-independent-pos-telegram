CREATE INDEX products_category_active_idx ON products(category_id, id) WHERE active;
CREATE INDEX products_low_stock_idx ON products(quantity, minimum_stock) WHERE active;
CREATE INDEX products_name_ru_trgm_idx ON products USING gin(name_ru gin_trgm_ops);
CREATE INDEX products_name_uz_trgm_idx ON products USING gin(name_uz gin_trgm_ops);
CREATE INDEX sales_created_id_idx ON sales(created_at, id);
CREATE INDEX sales_cashier_created_idx ON sales(cashier_id, created_at);
CREATE INDEX sale_items_product_sale_idx ON sale_items(product_id, sale_id);
CREATE INDEX sale_payments_sale_idx ON sale_payments(sale_id);
CREATE INDEX stock_movements_product_created_idx ON stock_movements(product_id, created_at, id);
CREATE INDEX stock_movements_reference_idx ON stock_movements(reference_id);
CREATE INDEX returns_sale_idx ON returns(original_sale_id);
CREATE INDEX returns_created_idx ON returns(created_at, id);
CREATE INDEX return_items_sale_item_idx ON return_items(sale_item_id);
CREATE INDEX expenses_created_idx ON expenses(created_at, id);
CREATE INDEX audit_log_created_idx ON audit_log(created_at, id);
CREATE INDEX backup_runs_created_idx ON backup_runs(created_at DESC);

CREATE OR REPLACE FUNCTION forbid_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical records are append-only';
END $$;

CREATE TRIGGER sales_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER sale_items_immutable BEFORE UPDATE OR DELETE ON sale_items FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER sale_payments_immutable BEFORE UPDATE OR DELETE ON sale_payments FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER returns_immutable BEFORE UPDATE OR DELETE ON returns FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER return_items_immutable BEFORE UPDATE OR DELETE ON return_items FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER expenses_immutable BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();

CREATE OR REPLACE FUNCTION verify_sale_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_sale uuid;
  stored sales%ROWTYPE;
  line_original numeric;
  line_discount numeric;
  line_final numeric;
  paid numeric;
BEGIN
  IF TG_TABLE_NAME = 'sales' THEN
    target_sale := NEW.id;
  ELSE
    target_sale := NEW.sale_id;
  END IF;
  SELECT * INTO stored FROM sales WHERE id = target_sale;
  SELECT coalesce(sum(line_original_total),0), coalesce(sum(line_discount),0), coalesce(sum(line_final_total),0)
    INTO line_original, line_discount, line_final FROM sale_items WHERE sale_id = target_sale;
  SELECT coalesce(sum(amount),0) INTO paid FROM sale_payments WHERE sale_id = target_sale;
  IF stored.original_total <> line_original OR stored.discount_amount <> line_discount
    OR stored.final_total <> line_final OR stored.final_total <> paid THEN
    RAISE EXCEPTION 'Sale totals mismatch for %', target_sale;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER sales_total_check AFTER INSERT ON sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_sale_totals();
CREATE CONSTRAINT TRIGGER sale_items_total_check AFTER INSERT ON sale_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_sale_totals();
CREATE CONSTRAINT TRIGGER sale_payments_total_check AFTER INSERT ON sale_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_sale_totals();

CREATE OR REPLACE FUNCTION verify_return_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sold_quantity integer;
  sold_product uuid;
  total_returned bigint;
BEGIN
  SELECT quantity, product_id INTO sold_quantity, sold_product FROM sale_items WHERE id = NEW.sale_item_id FOR UPDATE;
  IF sold_quantity IS NULL OR sold_product <> NEW.product_id THEN RAISE EXCEPTION 'Return sale item mismatch'; END IF;
  SELECT coalesce(sum(quantity),0) INTO total_returned FROM return_items WHERE sale_item_id = NEW.sale_item_id;
  IF total_returned > sold_quantity THEN RAISE EXCEPTION 'Return quantity exceeds sold quantity'; END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER return_quantity_check AFTER INSERT ON return_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_return_quantity();
