-- ========== DATABASE: event_history ==========
-- Tables: account, entity, account_holder, condition,
--         governed_as_creditor_account_by, governed_as_creditor_by,
--         governed_as_debtor_account_by, governed_as_debtor_by,
--         transaction (9 tables total)

CREATE TABLE IF NOT EXISTS account (
    id varchar NOT NULL,
    tenantId text NOT NULL,
    PRIMARY KEY (id, tenantId)
);

CREATE TABLE IF NOT EXISTS entity (
    id varchar NOT NULL,
    tenantId text NOT NULL,
    creDtTm timestamptz NOT NULL,
    PRIMARY KEY (id, tenantId)
);

CREATE TABLE IF NOT EXISTS account_holder (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    tenantId text NOT NULL,
    creDtTm timestamptz NOT NULL,
    FOREIGN KEY (source, tenantId) REFERENCES entity (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES account (id, tenantId),
    PRIMARY KEY (source, destination, tenantId)
);

CREATE TABLE IF NOT EXISTS condition (
    id varchar GENERATED ALWAYS AS (condition ->> 'condId') STORED,
    tenantId text GENERATED ALWAYS AS (condition ->> 'tenantId') STORED,
    condition jsonb NOT NULL,
    PRIMARY KEY (id, tenantId)
);

CREATE TABLE IF NOT EXISTS governed_as_creditor_account_by (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    evtTp text [] NOT NULL,
    incptnDtTm timestamptz NOT NULL,
    xprtnDtTm timestamptz,
    tenantId text NOT NULL,
    FOREIGN KEY (source, tenantId) REFERENCES account (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES condition (id, tenantId),
    PRIMARY KEY (source, destination, tenantId)
);

CREATE TABLE IF NOT EXISTS governed_as_creditor_by (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    evtTp TEXT [] NOT NULL,
    incptnDtTm timestamptz NOT NULL,
    xprtnDtTm timestamptz,
    tenantId text NOT NULL,
    FOREIGN KEY (source, tenantId) REFERENCES entity (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES condition (id, tenantId),
    PRIMARY KEY (source, destination, tenantId)
);

CREATE TABLE IF NOT EXISTS governed_as_debtor_account_by (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    evtTp TEXT [] NOT NULL,
    incptnDtTm timestamptz NOT NULL,
    xprtnDtTm timestamptz,
    tenantId text NOT NULL,
    FOREIGN KEY (source, tenantId) REFERENCES account (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES condition (id, tenantId),
    PRIMARY KEY (source, destination, tenantId)
);

CREATE TABLE IF NOT EXISTS governed_as_debtor_by (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    evtTp TEXT [] NOT NULL,
    incptnDtTm timestamptz NOT NULL,
    xprtnDtTm timestamptz,
    tenantId text NOT NULL,
    FOREIGN KEY (source, tenantId) REFERENCES entity (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES condition (id, tenantId),
    PRIMARY KEY (source, destination, tenantId)
);

/* transaction_relationship */
CREATE TABLE IF NOT EXISTS transaction (
    source varchar NOT NULL,
    destination varchar NOT NULL,
    transaction jsonb NOT NULL,
    endToEndId text GENERATED ALWAYS AS (transaction->>'EndToEndId') STORED,
    amt numeric(18, 2) GENERATED ALWAYS AS ((transaction->>'Amt')::numeric(18, 2)) STORED,
    ccy varchar GENERATED ALWAYS AS (transaction->>'Ccy') STORED,
    msgId varchar GENERATED ALWAYS AS (transaction->>'MsgId') STORED,
    creDtTm text GENERATED ALWAYS AS (transaction->>'CreDtTm') STORED,
    txTp varchar GENERATED ALWAYS AS (transaction->>'TxTp') STORED,
    txSts varchar GENERATED ALWAYS AS (transaction->>'TxSts') STORED,
    tenantId text GENERATED ALWAYS AS (transaction->>'TenantId') STORED,
    CONSTRAINT unique_msgid UNIQUE (msgId, tenantId),
    FOREIGN KEY (source, tenantId) REFERENCES account (id, tenantId),
    FOREIGN KEY (destination, tenantId) REFERENCES account (id, tenantId),
    PRIMARY KEY (endToEndId, txTp, tenantId)
);

CREATE INDEX IF NOT EXISTS idx_tr_cre_dt_tm ON transaction (creDtTm, tenantId);
CREATE INDEX IF NOT EXISTS idx_tr_source_txtp_credttm ON transaction (source, txtp, creDtTm, tenantId);
CREATE INDEX IF NOT EXISTS idx_tr_pacs002_accc ON transaction (endtoendid, creDtTm, tenantId)
WHERE txtp = 'pacs.002.001.12' AND txsts = 'ACCC';
CREATE INDEX IF NOT EXISTS idx_tr_dest_txtp_txsts_credttm ON transaction (
    destination, txtp, txsts, creDtTm DESC
) INCLUDE (source);
