-- ========== DATABASE: raw_history ==========
-- Tables: pacs002, pacs008, pain001, pain013

CREATE TABLE IF NOT EXISTS pacs002 (
    document jsonb NOT NULL,
    creDtTm text GENERATED ALWAYS AS (document -> 'FIToFIPmtSts' -> 'GrpHdr' ->> 'CreDtTm') STORED,
    messageId text GENERATED ALWAYS AS (document -> 'FIToFIPmtSts' -> 'GrpHdr' ->> 'MsgId') STORED,
    endToEndId text GENERATED ALWAYS AS (document -> 'FIToFIPmtSts' -> 'TxInfAndSts' ->> 'OrgnlEndToEndId') STORED,
    tenantId text GENERATED ALWAYS AS (document ->> 'TenantId') STORED,
    CONSTRAINT unique_msgid_pacs002 UNIQUE (messageId, tenantId),
    CONSTRAINT message_id_not_null CHECK (messageId IS NOT NULL),
    CONSTRAINT cre_dt_tm CHECK (creDtTm IS NOT NULL),
    PRIMARY KEY (endToEndId, tenantId)
);

CREATE TABLE IF NOT EXISTS pacs008 (
    document jsonb NOT NULL,
    creDtTm text GENERATED ALWAYS AS (document -> 'FIToFICstmrCdtTrf' -> 'GrpHdr' ->> 'CreDtTm') STORED,
    messageId text GENERATED ALWAYS AS (document -> 'FIToFICstmrCdtTrf' -> 'GrpHdr' ->> 'MsgId') STORED,
    endToEndId text GENERATED ALWAYS AS (document -> 'FIToFICstmrCdtTrf' -> 'CdtTrfTxInf' -> 'PmtId' ->> 'EndToEndId') STORED,
    debtorAccountId text GENERATED ALWAYS AS (document -> 'FIToFICstmrCdtTrf' -> 'CdtTrfTxInf' -> 'DbtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    creditorAccountId text GENERATED ALWAYS AS (document -> 'FIToFICstmrCdtTrf' -> 'CdtTrfTxInf' -> 'CdtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    tenantId text GENERATED ALWAYS AS (document ->> 'TenantId') STORED,
    CONSTRAINT unique_msgid_e2eid_pacs008 UNIQUE (messageId, tenantId),
    CONSTRAINT message_id_not_null CHECK (messageId IS NOT NULL),
    CONSTRAINT cre_dt_tm CHECK (creDtTm IS NOT NULL),
    CONSTRAINT dbtr_acct_id_not_null CHECK (debtorAccountId IS NOT NULL),
    CONSTRAINT cdtr_acct_id_not_null CHECK (creditorAccountId IS NOT NULL),
    PRIMARY KEY (endToEndId, tenantId)
);

CREATE INDEX IF NOT EXISTS idx_pacs008_dbtr_acct_id ON pacs008 (debtorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pacs008_cdtr_acct_id ON pacs008 (creditorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pacs008_credttm ON pacs008 (creDtTm, tenantId);

CREATE TABLE IF NOT EXISTS pain001 (
    document jsonb NOT NULL,
    creDtTm text GENERATED ALWAYS AS (document -> 'CstmrCdtTrfInitn' -> 'GrpHdr' ->> 'CreDtTm') STORED,
    messageId text GENERATED ALWAYS AS (document -> 'CstmrCdtTrfInitn' -> 'GrpHdr' ->> 'MsgId') STORED,
    endToEndId text GENERATED ALWAYS AS (document -> 'CstmrCdtTrfInitn' -> 'PmtInf' -> 'CdtTrfTxInf' -> 'PmtId' ->> 'EndToEndId') STORED,
    debtorAccountId text GENERATED ALWAYS AS (document -> 'CstmrCdtTrfInitn' -> 'PmtInf' -> 'DbtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    creditorAccountId text GENERATED ALWAYS AS (document -> 'CstmrCdtTrfInitn' -> 'PmtInf' -> 'CdtTrfTxInf' -> 'CdtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    tenantId text GENERATED ALWAYS AS (document ->> 'TenantId') STORED,
    CONSTRAINT unique_msgid_e2eid_pain001 UNIQUE (messageId, tenantId),
    CONSTRAINT message_id_not_null CHECK (messageId IS NOT NULL),
    CONSTRAINT cre_dt_tm CHECK (creDtTm IS NOT NULL),
    CONSTRAINT dbtr_acct_id_not_null CHECK (debtorAccountId IS NOT NULL),
    CONSTRAINT cdtr_acct_id_not_null CHECK (creditorAccountId IS NOT NULL),
    PRIMARY KEY (endToEndId, tenantId)
);

CREATE INDEX IF NOT EXISTS idx_pain001_dbtr_acct_id ON pain001 (debtorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pain001_cdtr_acct_id ON pain001 (creditorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pain001_credttm ON pain001 (creDtTm, tenantId);

CREATE TABLE IF NOT EXISTS pain013 (
    document jsonb NOT NULL,
    creDtTm text GENERATED ALWAYS AS (document -> 'CdtrPmtActvtnReq' -> 'GrpHdr' ->> 'CreDtTm') STORED,
    messageId text GENERATED ALWAYS AS (document -> 'CdtrPmtActvtnReq' -> 'GrpHdr' ->> 'MsgId') STORED,
    endToEndId text GENERATED ALWAYS AS (document -> 'CdtrPmtActvtnReq' -> 'PmtInf' -> 'CdtTrfTxInf' -> 'PmtId' ->> 'EndToEndId') STORED,
    debtorAccountId text GENERATED ALWAYS AS (document -> 'CdtrPmtActvtnReq' -> 'PmtInf' -> 'DbtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    creditorAccountId text GENERATED ALWAYS AS (document -> 'CdtrPmtActvtnReq' -> 'PmtInf' -> 'CdtTrfTxInf' -> 'CdtrAcct' -> 'Id' -> 'Othr' -> 0 ->> 'Id') STORED,
    tenantId text GENERATED ALWAYS AS (document ->> 'TenantId') STORED,
    CONSTRAINT unique_msgid_e2eid_pain013 UNIQUE (messageId, tenantId),
    CONSTRAINT message_id_not_null CHECK (messageId IS NOT NULL),
    CONSTRAINT cre_dt_tm CHECK (creDtTm IS NOT NULL),
    CONSTRAINT dbtr_acct_id_not_null CHECK (debtorAccountId IS NOT NULL),
    CONSTRAINT cdtr_acct_id_not_null CHECK (creditorAccountId IS NOT NULL),
    PRIMARY KEY (endToEndId, tenantId)
);

CREATE INDEX IF NOT EXISTS idx_pain013_dbtr_acct_id ON pain013 (debtorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pain013_cdtr_acct_id ON pain013 (creditorAccountId, tenantId);
CREATE INDEX IF NOT EXISTS idx_pain013_credttm ON pain013 (creDtTm, tenantId);
