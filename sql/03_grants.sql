-- ============================================
-- Service Parcellaire LPSG — Droits d'accès
-- Pour pg_featureserv (rôle read_only)
-- ============================================

-- Remplacer "mon_schema" par votre schéma

GRANT USAGE ON SCHEMA mon_schema TO read_only;
GRANT SELECT ON ALL TABLES IN SCHEMA mon_schema TO read_only;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mon_schema TO read_only;
