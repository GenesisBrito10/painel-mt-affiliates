-- Regra de link MIRROR: CPA da casa = CPA do próprio usuário na casa de referência.
ALTER TYPE "LinkRuleType" ADD VALUE IF NOT EXISTS 'MIRROR';

-- Auditoria do CPA espelhado 1:1.
ALTER TYPE "LinkAssignmentRuleApplied" ADD VALUE IF NOT EXISTS 'MIRROR_REFERENCE';
