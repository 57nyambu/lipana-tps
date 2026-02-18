-- ========== Configuration Seed Data ==========
-- Rule configurations and typology definitions for the Tazama pipeline
-- This uses the basic public deployment config (rule-901 only)
--
-- ADDING NEW RULES:
--   1. Insert a new row into `rule` with the rule config JSON (id, cfg, bands, exitConditions)
--   2. Add the rule to the `typology` config's "rules" array with weights (wghts)
--   3. Reference the rule in `network_map` under the typology's "rules" list
--   4. Deploy the corresponding rule processor pod (e.g. rule-902, rule-003)
--   The dashboard pipeline view auto-discovers new rule pods dynamically.
--

-- Insert rule configurations
INSERT INTO rule (configuration)
VALUES (
  '{"id":"901@1.0.0","cfg":"1.0.0","tenantId":"DEFAULT","desc":"Number of outgoing transactions - debtor","config":{"parameters":{"maxQueryRange":86400000},"exitConditions":[{"subRuleRef":".x00","reason":"Incoming transaction is unsuccessful"}],"bands":[{"subRuleRef":".01","upperLimit":2,"reason":"The debtor has performed one transaction to date"},{"subRuleRef":".02","lowerLimit":2,"upperLimit":3,"reason":"The debtor has performed two transactions to date"},{"subRuleRef":".03","lowerLimit":3,"reason":"The debtor has performed three or more transactions to date"}]}}'
)
ON CONFLICT DO NOTHING;

-- Insert typology configuration (single rule-901 typology)
INSERT INTO typology (configuration)
VALUES (
  '{"typology_name":"Typology-999-Rule-901","id":"typology-processor@1.0.0","cfg":"999-901@1.0.0","tenantId":"DEFAULT","workflow":{"alertThreshold":200,"interdictionThreshold":400,"flowProcessor":"EFRuP@1.0.0"},"rules":[{"id":"901@1.0.0","cfg":"1.0.0","termId":"v901at100at100","wghts":[{"ref":".err","wght":"0"},{"ref":".x00","wght":"100"},{"ref":".01","wght":"100"},{"ref":".02","wght":"200"},{"ref":".03","wght":"400"}]},{"id":"EFRuP@1.0.0","cfg":"none","termId":"vEFRuPat100atnone","wghts":[{"ref":".err","wght":"0"},{"ref":"override","wght":"0"},{"ref":"non-overridable-block","wght":"0"},{"ref":"overridable-block","wght":"0"},{"ref":"none","wght":"0"}]}],"expression":["Add","v901at100at100"]}'
)
ON CONFLICT DO NOTHING;

-- Insert network map (basic public deployment - pacs.002 with rule-901)
INSERT INTO network_map (configuration)
VALUES (
  '{"active":true,"name":"Public Network Map","cfg":"1.0.0","tenantId":"DEFAULT","messages":[{"id":"004@1.0.0","cfg":"1.0.0","txTp":"pacs.002.001.12","typologies":[{"id":"typology-processor@1.0.0","cfg":"999-901@1.0.0","tenantId":"DEFAULT","rules":[{"id":"EFRuP@1.0.0","cfg":"none"},{"id":"901@1.0.0","cfg":"1.0.0"}]}]}]}'
);
