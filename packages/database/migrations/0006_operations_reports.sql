ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_quantity_change_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_quantity_change_check CHECK (
  (type = 'RETURN_NO_RESTOCK' AND quantity_change = 0)
  OR (type <> 'RETURN_NO_RESTOCK' AND quantity_change <> 0)
);

CREATE INDEX returns_sale_created_idx ON returns(original_sale_id, created_at DESC);
CREATE INDEX return_items_product_idx ON return_items(product_id);
CREATE INDEX expenses_category_created_idx ON expenses(category_id, created_at DESC);
CREATE INDEX inventory_sessions_status_created_idx ON inventory_sessions(status, created_at DESC);
CREATE INDEX inventory_items_product_idx ON inventory_items(product_id, session_id);
