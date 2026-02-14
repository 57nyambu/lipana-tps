-- ========== DATABASE: configuration ==========
-- Tables: network_map, typology, rule

CREATE TABLE IF NOT EXISTS network_map (
    configuration jsonb NOT NULL,
    tenantId text GENERATED ALWAYS AS (configuration ->> 'tenantId') STORED
);

CREATE TABLE IF NOT EXISTS typology (
    configuration jsonb NOT NULL,
    typologyId text GENERATED ALWAYS AS (configuration ->> 'id') STORED,
    typologyCfg text GENERATED ALWAYS AS (configuration ->> 'cfg') STORED,
    tenantId text GENERATED ALWAYS AS (configuration ->> 'tenantId') STORED,
    PRIMARY KEY (typologyId, typologyCfg, tenantId)
);

CREATE TABLE IF NOT EXISTS rule (
    configuration jsonb NOT NULL,
    ruleId text GENERATED ALWAYS AS (configuration ->> 'id') STORED,
    ruleCfg text GENERATED ALWAYS AS (configuration ->> 'cfg') STORED,
    tenantId text GENERATED ALWAYS AS (configuration ->> 'tenantId') STORED,
    PRIMARY KEY (ruleId, ruleCfg, tenantId)
);
