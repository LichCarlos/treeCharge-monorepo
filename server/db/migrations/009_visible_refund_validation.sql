SET search_path=charge,pg_catalog;
-- Deleted refunds retain their links for restore; only visible refunds require a visible original.
CREATE OR REPLACE FUNCTION validate_financial_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w uuid:=NEW.workspace_id;
BEGIN
  IF EXISTS(SELECT 1 FROM charge.transactions t JOIN charge.visible_tree_nodes v ON v.id=t.id
    WHERE t.workspace_id=w AND t.direction='refund' AND NOT EXISTS(SELECT 1 FROM charge.transaction_refund_links r WHERE r.refund_id=t.id)) THEN
    RAISE EXCEPTION 'refund requires original expense' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM charge.transaction_refund_links r
    JOIN charge.transactions f ON f.id=r.refund_id JOIN charge.visible_tree_nodes visible_refund ON visible_refund.id=f.id JOIN charge.transactions o ON o.id=r.original_id
    WHERE r.workspace_id=w AND (f.direction<>'refund' OR o.direction<>'expense' OR f.ledger_id<>o.ledger_id
      OR f.occurred_on<o.occurred_on OR NOT EXISTS(SELECT 1 FROM charge.visible_tree_nodes WHERE id=o.id))) THEN
    RAISE EXCEPTION 'refund original invalid' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT r.original_id FROM charge.transaction_refund_links r JOIN charge.transactions f ON f.id=r.refund_id
    JOIN charge.visible_tree_nodes v ON v.id=f.id JOIN charge.transactions o ON o.id=r.original_id
    WHERE r.workspace_id=w GROUP BY r.original_id,o.amount_minor HAVING sum(f.amount_minor)>o.amount_minor) THEN
    RAISE EXCEPTION 'refund exceeds original' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT t.ledger_id FROM charge.transactions t JOIN charge.visible_tree_nodes v ON v.id=t.id
    WHERE t.workspace_id=w AND t.direction IN ('deposit','withdrawal') GROUP BY t.ledger_id
    HAVING sum(CASE WHEN t.direction='deposit' THEN t.amount_minor ELSE -t.amount_minor END)<0) THEN
    RAISE EXCEPTION 'savings balance negative' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM charge.savings_source_links l JOIN charge.transactions s ON s.id=l.savings_transaction_id
    JOIN charge.transactions o ON o.id=l.source_transaction_id WHERE l.workspace_id=w
    AND (s.direction<>'deposit' OR o.direction<>'income')) THEN RAISE EXCEPTION 'invalid savings source direction' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT l.source_transaction_id FROM charge.savings_source_links l JOIN charge.transactions t ON t.id=l.source_transaction_id
    WHERE l.workspace_id=w GROUP BY l.source_transaction_id,t.amount_minor HAVING sum(l.amount_minor)>t.amount_minor)
    OR EXISTS(SELECT l.savings_transaction_id FROM charge.savings_source_links l JOIN charge.transactions t ON t.id=l.savings_transaction_id
    WHERE l.workspace_id=w GROUP BY l.savings_transaction_id,t.amount_minor HAVING sum(l.amount_minor)>t.amount_minor) THEN
    RAISE EXCEPTION 'savings source overallocated' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
