-- 0022: durable sales-funnel milestones.
--
-- Status alone loses history: once a row reads "sold" nothing remembered that
-- it passed through accepted and pitched, so the product could not answer
-- "which findings actually turn into client conversations". These columns
-- record the FIRST time each milestone was reached.
--
-- Additive only: existing rows keep their exact meaning, and no milestone is
-- invented for them. A pre-funnel sold row keeps its sold_amount/sold_at and
-- reads as "sold, intermediate milestones unknown" — historical unknown means
-- unknown. See core/salesFunnel.ts for how unknown stages are measured.
ALTER TABLE opportunities ADD COLUMN accepted_at TEXT;
ALTER TABLE opportunities ADD COLUMN proposal_prepared_at TEXT;
ALTER TABLE opportunities ADD COLUMN pitched_at TEXT;
ALTER TABLE opportunities ADD COLUMN lost_at TEXT;
ALTER TABLE opportunities ADD COLUMN dismissed_at TEXT;

-- Index for close-rate / funnel measurement over client-decided outcomes.
-- Dismissed is deliberately absent: an internal rejection is not a client loss.
CREATE INDEX IF NOT EXISTS idx_opp_funnel
  ON opportunities (workspace_id, status)
  WHERE status IN ('sold', 'lost');
