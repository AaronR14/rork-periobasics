-- Add competency_tags for Módulo 3 (Diagnóstico Periodontal) and
-- Módulo 4 (Pronóstico y Plan de Tratamiento).
--
-- Run this in Supabase Dashboard → SQL Editor → New query.
-- It is safe to re-run (ON CONFLICT skips existing slugs).

INSERT INTO competency_tags (slug, label, macro_competency_slug, macro_competency_label, module_name, sort_order)
VALUES
  -- Módulo 3: Diagnóstico Periodontal
  ('sondaje_periodontal',      'Sondaje Periodontal',      'diagnostico_periodontal', 'Diagnóstico Periodontal',  'Módulo 3', 1),
  ('lectura_bolsas',            'Lectura de Bolsas',         'diagnostico_periodontal', 'Diagnóstico Periodontal',  'Módulo 3', 2),
  ('examinacion_radiografica',  'Examen Radiográfico',       'diagnostico_periodontal', 'Diagnóstico Periodontal',  'Módulo 3', 3),
  ('diagnostico_diferencial',   'Diagnóstico Diferencial',   'diagnostico_periodontal', 'Diagnóstico Periodontal',  'Módulo 3', 4),
  -- Módulo 4: Pronóstico y Tratamiento
  ('pronostico_periodontal',    'Pronóstico Periodontal',    'pronostico_tratamiento',  'Pronóstico y Tratamiento', 'Módulo 4', 1),
  ('plan_tratamiento',          'Plan de Tratamiento',       'pronostico_tratamiento',  'Pronóstico y Tratamiento', 'Módulo 4', 2),
  ('fase_etiotropica',          'Fase Etiotrópica',          'pronostico_tratamiento',  'Pronóstico y Tratamiento', 'Módulo 4', 3),
  ('secuencia_tratamiento',     'Secuencia de Tratamiento',  'pronostico_tratamiento',  'Pronóstico y Tratamiento', 'Módulo 4', 4)
ON CONFLICT (slug) DO NOTHING;

-- Verify the insert
SELECT slug, label, module_name, sort_order
FROM competency_tags
WHERE module_name IN ('Módulo 3', 'Módulo 4')
ORDER BY module_name, sort_order;
