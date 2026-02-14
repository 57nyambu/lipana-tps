-- ========== DATABASE: evaluation ==========
-- Tables: evaluation

CREATE TABLE IF NOT EXISTS evaluation (
    evaluation jsonb NOT NULL,
    messageId text GENERATED ALWAYS AS (
        evaluation -> 'transaction' -> 'FIToFIPmtSts' -> 'GrpHdr' ->> 'MsgId'
    ) STORED,
    tenantId text GENERATED ALWAYS AS (
        evaluation -> 'transaction' ->> 'TenantId'
    ) STORED,
    CONSTRAINT unique_msgid_evaluation UNIQUE (messageId, tenantId)
);
