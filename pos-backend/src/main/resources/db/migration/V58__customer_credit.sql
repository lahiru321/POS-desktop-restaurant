-- Customer store-credit ("buy now, pay later on account") + accounts-receivable ledger.
--
-- Adds a per-customer credit account: an admin-set maximum limit and a live
-- outstanding balance. Sales rung up with the CREDIT payment method charge the
-- customer's account (up to their limit); repayments reduce the balance. The
-- whole feature is gated per tenant by the STORE_CREDIT feature flag.
--
-- Mirrors the loyalty design (V56): a denormalized running total on customers
-- kept in lock-step with an append-only ledger table that is the audit source
-- of truth. credit_limit = 0 means the customer may not buy on credit.

ALTER TABLE customers ADD COLUMN credit_limit   NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN credit_balance NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    -- Set for a CHARGE (the credit sale); null for repayments and manual adjustments.
    sale_id UUID REFERENCES sales(id),
    -- CHARGE (+, credit sale), REPAYMENT (-, customer pays down), ADJUST (+/- manual correction).
    type VARCHAR(20) NOT NULL,
    -- Signed: positive increases the amount owed (CHARGE), negative reduces it (REPAYMENT).
    amount NUMERIC(12, 2) NOT NULL,
    -- The customer's resulting outstanding balance after this entry was applied.
    balance_after NUMERIC(12, 2) NOT NULL,
    -- Repayments only: how the customer paid (CASH / CARD / ONLINE).
    payment_method VARCHAR(20),
    -- Cash repayments: links to the open drawer so end-of-shift reconciliation
    -- counts the cash-in. Null for non-cash repayments, charges and adjustments.
    cash_session_id UUID,
    description VARCHAR(255),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_credit_tx_tenant_customer ON credit_transactions(tenant_id, customer_id, created_at DESC);
CREATE INDEX idx_credit_tx_session ON credit_transactions(cash_session_id);

-- Desktop installs are provisioned once with the full feature set (see
-- SuperAdminTenantService.provisionFromSeed), which now includes STORE_CREDIT.
-- Backfill it onto any tenant already provisioned by an earlier build so the
-- feature is available without a super-admin trip to toggle it on.
UPDATE tenant_configurations
SET features_enabled = features_enabled || '["STORE_CREDIT"]'::jsonb
WHERE NOT (features_enabled @> '["STORE_CREDIT"]'::jsonb);
