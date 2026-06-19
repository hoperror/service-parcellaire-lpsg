-- ============================================
-- Service Parcellaire LPSG — Fonctions PL/pgSQL
-- Le Pré-Saint-Gervais (93061)
-- ============================================

-- Remplacer "mon_schema" par votre schéma

-- 1. GÉOCODAGE INTERNE
CREATE OR REPLACE FUNCTION mon_schema.geocode_adresse(adresse_input TEXT)
RETURNS TABLE (
    adresse_trouvee TEXT,
    geom geometry(Point, 2154)
) AS $$
DECLARE
    v_numero INTEGER;
    v_voie TEXT;
BEGIN
    v_numero := (regexp_match(trim(adresse_input), '^\s*(\d+)'))[1]::INTEGER;
    v_voie := trim(regexp_replace(trim(adresse_input), '^\s*\d+\s*', ''));
    v_voie := upper(v_voie);
    v_voie := replace(replace(replace(replace(replace(v_voie, 
        'É','E'), 'È','E'), 'Ê','E'), 'À','A'), 'Ô','O');

    RETURN QUERY
    SELECT concat(a.numero, ' ', a.nom_voie)::TEXT, a.geom
    FROM mon_schema.adresse_ban a
    WHERE a.numero = v_numero AND a.nom_afnor ILIKE '%' || v_voie || '%'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT concat(a.numero, ' ', a.nom_voie)::TEXT, a.geom
        FROM mon_schema.adresse_ban a
        WHERE a.nom_afnor ILIKE '%' || v_voie || '%'
        ORDER BY abs(a.numero - coalesce(v_numero, a.numero)) ASC
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT concat(a.numero, ' ', a.nom_voie)::TEXT, a.geom
        FROM mon_schema.adresse_ban a
        WHERE a.nom_afnor ILIKE ALL (
            SELECT '%' || unnest(string_to_array(v_voie, ' ')) || '%'
        )
        ORDER BY abs(a.numero - coalesce(v_numero, a.numero)) ASC
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- 2. RECHERCHE DE PARCELLE
CREATE OR REPLACE FUNCTION mon_schema.trouver_parcelle(point_input geometry(Point, 2154))
RETURNS TABLE (
    gid INTEGER, id_parcelle TEXT, section TEXT, numero TEXT,
    contenance INTEGER, surface_m2 DOUBLE PRECISION, geom geometry
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.gid, p.id::TEXT, p.section::TEXT, p.numero::TEXT,
           p.contenance, ST_Area(p.geom), p.geom
    FROM mon_schema.parcelle p
    WHERE ST_Contains(p.geom, point_input)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT p.gid, p.id::TEXT, p.section::TEXT, p.numero::TEXT,
               p.contenance, ST_Area(p.geom), p.geom
        FROM mon_schema.parcelle p
        WHERE ST_DWithin(p.geom, point_input, 50)
        ORDER BY ST_Distance(p.geom, point_input) ASC
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- 3. STATISTIQUES BÂTIMENTS
CREATE OR REPLACE FUNCTION mon_schema.stats_batiments(p_geom geometry)
RETURNS TABLE (
    nb_batiments INTEGER, surface_batie_m2 DOUBLE PRECISION, ratio_bati DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(b.cleabs)::INTEGER,
        COALESCE(SUM(ST_Area(ST_Intersection(b.geom, p_geom))), 0),
        CASE WHEN ST_Area(p_geom) > 0 
             THEN COALESCE(SUM(ST_Area(ST_Intersection(b.geom, p_geom))), 0) / ST_Area(p_geom)
             ELSE 0 END
    FROM mon_schema.batiment b
    WHERE ST_Intersects(b.geom, p_geom);
END;
$$ LANGUAGE plpgsql STABLE;


-- 4. HISTORIQUE DVF
CREATE OR REPLACE FUNCTION mon_schema.historique_dvf(
    parcelle_id TEXT, agrege BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    date_mutation DATE, nature_mutation TEXT, valeur_fonciere DOUBLE PRECISION,
    type_local TEXT, nb_lots INTEGER, nb_appartements INTEGER, surface_reelle_bati INTEGER
) AS $$
BEGIN
    IF agrege THEN
        RETURN QUERY
        SELECT d.date_mutation, d.nature_mutation::TEXT, d.valeur_fonciere,
               NULL::TEXT, COUNT(*)::INTEGER,
               COUNT(*) FILTER (WHERE d.type_local = 'Appartement')::INTEGER,
               COALESCE(SUM(d.surface_reelle_bati), 0)::INTEGER
        FROM mon_schema.dvf d WHERE d.id_parcelle = parcelle_id
        GROUP BY d.date_mutation, d.nature_mutation, d.valeur_fonciere
        ORDER BY d.date_mutation DESC;
    ELSE
        RETURN QUERY
        SELECT d.date_mutation, d.nature_mutation::TEXT, d.valeur_fonciere,
               d.type_local::TEXT, 1::INTEGER,
               CASE WHEN d.type_local = 'Appartement' THEN 1 ELSE 0 END::INTEGER,
               COALESCE(d.surface_reelle_bati, 0)::INTEGER
        FROM mon_schema.dvf d WHERE d.id_parcelle = parcelle_id
        ORDER BY d.date_mutation DESC;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- 5. PENTE MOYENNE (bonus)
CREATE OR REPLACE FUNCTION mon_schema.pente_moyenne(p_geom geometry)
RETURNS DOUBLE PRECISION AS $$
DECLARE v_pente DOUBLE PRECISION;
BEGIN
    SELECT AVG((ST_SummaryStats(
        ST_Clip(ST_Slope(rast, 1, '32BF', 'DEGREES'), p_geom), 1
    )).mean) INTO v_pente
    FROM mon_schema.mnt WHERE ST_Intersects(rast, p_geom);
    RETURN COALESCE(ROUND(v_pente::numeric, 2), 0);
END;
$$ LANGUAGE plpgsql STABLE;


-- 6. SERVICE PRINCIPAL — PAR COORDONNÉES
CREATE OR REPLACE FUNCTION mon_schema.service_parcellaire_xy(
    x DOUBLE PRECISION, y DOUBLE PRECISION, srid INTEGER DEFAULT 2154
)
RETURNS TABLE (
    id_parcelle TEXT, section TEXT, numero TEXT,
    surface_parcelle_m2 DOUBLE PRECISION, nb_batiments INTEGER,
    surface_batie_m2 DOUBLE PRECISION, ratio_bati DOUBLE PRECISION,
    pente_moyenne_deg DOUBLE PRECISION, dvf_resume TEXT,
    message TEXT, geom geometry
) AS $$
DECLARE
    v_point geometry;
    v_dans_commune BOOLEAN;
BEGIN
    v_point := ST_Transform(ST_SetSRID(ST_MakePoint(x, y), srid), 2154);

    SELECT EXISTS(
        SELECT 1 FROM mon_schema.commune c WHERE ST_Contains(c.geom, v_point)
    ) INTO v_dans_commune;

    IF NOT v_dans_commune THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT,
            NULL::DOUBLE PRECISION, NULL::INTEGER, NULL::DOUBLE PRECISION,
            NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION, NULL::TEXT,
            'Le point fourni est en dehors de la commune du Pré-Saint-Gervais.'::TEXT,
            NULL::geometry;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT tp.id_parcelle, tp.section, tp.numero, tp.surface_m2,
        sb.nb_batiments, sb.surface_batie_m2, sb.ratio_bati,
        mon_schema.pente_moyenne(tp.geom),
        (SELECT string_agg(
            dv.date_mutation::TEXT || ' | ' || dv.nature_mutation || ' | ' ||
            COALESCE(dv.valeur_fonciere::TEXT, 'N/A') || '€ | ' ||
            dv.nb_lots || ' lots (' || dv.nb_appartements || ' appts)', ' ; ')
         FROM mon_schema.historique_dvf(tp.id_parcelle, TRUE) dv),
        'OK'::TEXT, ST_Transform(tp.geom, 4326)
    FROM mon_schema.trouver_parcelle(v_point) tp,
         LATERAL mon_schema.stats_batiments(tp.geom) sb;

    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT,
            NULL::DOUBLE PRECISION, NULL::INTEGER, NULL::DOUBLE PRECISION,
            NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION, NULL::TEXT,
            'Aucune parcelle trouvée à proximité du point.'::TEXT,
            NULL::geometry;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- 7. SERVICE PRINCIPAL — PAR ADRESSE
CREATE OR REPLACE FUNCTION mon_schema.service_parcellaire_adresse(adresse TEXT)
RETURNS TABLE (
    adresse_trouvee TEXT, id_parcelle TEXT, section TEXT, numero TEXT,
    surface_parcelle_m2 DOUBLE PRECISION, nb_batiments INTEGER,
    surface_batie_m2 DOUBLE PRECISION, ratio_bati DOUBLE PRECISION,
    pente_moyenne_deg DOUBLE PRECISION, dvf_resume TEXT,
    message TEXT, geom geometry
) AS $$
DECLARE v_geom geometry; v_adresse TEXT;
BEGIN
    SELECT ga.geom, ga.adresse_trouvee INTO v_geom, v_adresse
    FROM mon_schema.geocode_adresse(adresse) ga;

    IF v_geom IS NULL THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
            NULL::DOUBLE PRECISION, NULL::INTEGER, NULL::DOUBLE PRECISION,
            NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION, NULL::TEXT,
            ('Adresse introuvable : "' || adresse || '". Essayez une adresse du Pré-Saint-Gervais.')::TEXT,
            NULL::geometry;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v_adresse, sp.id_parcelle, sp.section, sp.numero,
           sp.surface_parcelle_m2, sp.nb_batiments, sp.surface_batie_m2,
           sp.ratio_bati, sp.pente_moyenne_deg, sp.dvf_resume, sp.message, sp.geom
    FROM mon_schema.service_parcellaire_xy(ST_X(v_geom), ST_Y(v_geom), 2154) sp;
END;
$$ LANGUAGE plpgsql STABLE;


-- 8. TABLE PRÉ-CALCULÉE POUR LE FRONTEND
CREATE TABLE mon_schema.parcelle_stats AS
SELECT p.gid, p.id AS id_parcelle, p.section, p.numero, p.contenance,
    ROUND(ST_Area(p.geom)::numeric, 1) AS surface_m2,
    COALESCE(b.nb_batiments, 0) AS nb_batiments,
    ROUND(COALESCE(b.surface_batie_m2, 0)::numeric, 1) AS surface_batie_m2,
    ROUND((CASE WHEN ST_Area(p.geom) > 0 
         THEN COALESCE(b.surface_batie_m2, 0) / ST_Area(p.geom) ELSE 0 END)::numeric, 3) AS ratio_bati,
    ST_Transform(p.geom, 4326)::geometry(Polygon, 4326) AS geom
FROM mon_schema.parcelle p
LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS nb_batiments,
           SUM(ST_Area(ST_Intersection(bat.geom, p.geom))) AS surface_batie_m2
    FROM mon_schema.batiment bat WHERE ST_Intersects(bat.geom, p.geom)
) b ON true;

ALTER TABLE mon_schema.parcelle_stats ADD PRIMARY KEY (gid);
CREATE INDEX idx_parcelle_stats_geom ON mon_schema.parcelle_stats USING GIST (geom);
