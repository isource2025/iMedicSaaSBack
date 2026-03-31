-- Script para poblar la tabla imHCExamenesLabDetalleConf con parámetros comunes de laboratorio
-- Incluye valores de referencia y configuración de alertas

-- Limpiar tabla si existe (comentar si no quieres borrar datos existentes)
-- DELETE FROM imHCExamenesLabDetalleConf;

-- ========================================
-- HEMATOLOGÍA - Hemograma Completo
-- ========================================

-- Glóbulos Blancos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('GB', 'Glóbulos Blancos', 'HEMOGRAMA', '/mm3', 3800, 10000, 5000, 15000, 1, '["GLOBULOS BLANCOS","LEUCOCITOS","WBC","GB","WHITE BLOOD CELLS"]', 1);

-- Glóbulos Rojos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoHombre, ValorMaximoHombre, ValorMinimoMujer, ValorMaximoMujer, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('GR', 'Glóbulos Rojos', 'HEMOGRAMA', '/mm3', 4500000, 5800000, 4000000, 5200000, 4000000, 5500000, 1, '["GLOBULOS ROJOS","ERITROCITOS","RBC","GR","RED BLOOD CELLS"]', 0);

-- Hemoglobina
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoHombre, ValorMaximoHombre, ValorMinimoMujer, ValorMaximoMujer, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('HB', 'Hemoglobina', 'HEMOGRAMA', 'g/dl', 13.0, 17.0, 12.0, 16.0, 11.0, 16.0, 1, '["HEMOGLOBINA","HGB","HB","Hb","HEMOGLOBIN"]', 1);

-- Hematocrito
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoHombre, ValorMaximoHombre, ValorMinimoMujer, ValorMaximoMujer, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('HTO', 'Hematocrito', 'HEMOGRAMA', '%', 42, 50, 37, 47, 35, 45, 1, '["HEMATOCRITO","HCT","HTO","Hto","HEMATOCRIT"]', 0);

-- VCM (Volumen Corpuscular Medio)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('VCM', 'VCM', 'HEMOGRAMA', 'fl', 80, 98, 1, '["VCM","MCV","VOLUMEN CORPUSCULAR MEDIO"]', 0);

-- HCM (Hemoglobina Corpuscular Media)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('HCM', 'HCM', 'HEMOGRAMA', 'pg', 27, 32, 1, '["HCM","MCH","HEMOGLOBINA CORPUSCULAR MEDIA"]', 0);

-- CHCM (Concentración de Hemoglobina Corpuscular Media)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('CHCM', 'CHCM', 'HEMOGRAMA', 'g/dl', 33, 37, 1, '["CHCM","MCHC","CONCENTRACION HEMOGLOBINA CORPUSCULAR MEDIA"]', 0);

-- RDW (Amplitud de Distribución Eritrocitaria)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('RDW', 'RDW', 'HEMOGRAMA', '%', 11.0, 16.0, 1, '["RDW","AMPLITUD DISTRIBUCION ERITROCITARIA"]', 0);

-- Plaquetas
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('PLT', 'Plaquetas', 'HEMOGRAMA', '/mm3', 150000, 400000, 1, '["PLAQUETAS","PLATELETS","PLT","RECUENTO PLAQUETAS"]', 1);

-- Neutrófilos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('NEUT', 'Neutrófilos', 'HEMOGRAMA', '%', 55, 65, 1, '["NEUTROFILOS","NEUTROPHILS","NEUT","NEUTROFILOS SEGMENTADOS"]', 0);

-- Linfocitos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('LINF', 'Linfocitos', 'HEMOGRAMA', '%', 23, 35, 1, '["LINFOCITOS","LYMPHOCYTES","LINF"]', 0);

-- Monocitos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('MONO', 'Monocitos', 'HEMOGRAMA', '%', 4, 8, 1, '["MONOCITOS","MONOCYTES","MONO"]', 0);

-- Eosinófilos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('EOS', 'Eosinófilos', 'HEMOGRAMA', '%', 0.5, 4, 1, '["EOSINOFILOS","EOSINOPHILS","EOS"]', 0);

-- Basófilos
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('BASO', 'Basófilos', 'HEMOGRAMA', '%', 0, 1, 1, '["BASOFILOS","BASOPHILS","BASO"]', 0);

-- ========================================
-- QUÍMICA CLÍNICA
-- ========================================

-- Glucemia
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('GLU', 'Glucemia', 'QUIMICA_CLINICA', 'mg/dl', 70, 100, 1, '["GLUCEMIA","GLUCOSA","GLUCOSE","GLU","GLICEMIA"]', 1);

-- Uremia
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('UREA', 'Uremia', 'QUIMICA_CLINICA', 'mg/dl', 10, 45, 1, '["UREMIA","UREA","BUN"]', 0);

-- Creatininemia
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoHombre, ValorMaximoHombre, ValorMinimoMujer, ValorMaximoMujer, Activo, Sinonimos, AlertaCritica)
VALUES ('CREA', 'Creatininemia', 'QUIMICA_CLINICA', 'mg/dl', 0.90, 1.30, 0.60, 1.10, 1, '["CREATININEMIA","CREATININA","CREATININE","CREA"]', 1);

-- Uricemia
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoHombre, ValorMaximoHombre, ValorMinimoMujer, ValorMaximoMujer, Activo, Sinonimos, AlertaCritica)
VALUES ('URIC', 'Uricemia', 'QUIMICA_CLINICA', 'mg/dl', 2.5, 6.0, 2.0, 5.0, 1, '["URICEMIA","ACIDO URICO","URIC ACID","URIC"]', 0);

-- ========================================
-- IONOGRAMA
-- ========================================

-- Sodio
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('NA', 'Sodio', 'IONOGRAMA', 'meq/l', 135, 145, 1, '["SODIO","SODIUM","Na","NA","SODIO SERICO"]', 1);

-- Potasio
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('K', 'Potasio', 'IONOGRAMA', 'meq/l', 3.5, 5.3, 1, '["POTASIO","POTASSIUM","K","POTASIO SERICO"]', 1);

-- Cloro
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('CL', 'Cloro', 'IONOGRAMA', 'meq/l', 95, 105, 1, '["CLORO","CHLORIDE","Cl","CL","CLORO SERICO"]', 0);

-- ========================================
-- HEPATOGRAMA
-- ========================================

-- GOT / AST
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('GOT', 'GOT - AST', 'HEPATOGRAMA', 'U/l', 0, 38, 1, '["GOT","AST","TGO","TRANSAMINASA GLUTAMICO OXALACETICA"]', 0);

-- GPT / ALT
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('GPT', 'GPT - ALT', 'HEPATOGRAMA', 'U/l', 0, 41, 1, '["GPT","ALT","TGP","TRANSAMINASA GLUTAMICO PIRUVICA"]', 0);

-- Fosfatasa Alcalina
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('FAL', 'Fosfatasa Alcalina', 'HEPATOGRAMA', 'U/L', 20, 300, 18, 600, 1, '["FOSFATASA ALCALINA","ALKALINE PHOSPHATASE","FAL","ALP"]', 0);

-- Bilirrubina Total
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('BILT', 'Bilirrubina Total', 'HEPATOGRAMA', 'mg/dl', 0, 1.00, 1, '["BILIRRUBINA TOTAL","TOTAL BILIRUBIN","BILT"]', 0);

-- Proteínas Totales
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('PROT', 'Proteínas Totales', 'HEPATOGRAMA', 'g/dl', 6.00, 8.00, 1, '["PROTEINAS TOTALES","TOTAL PROTEIN","PROT"]', 0);

-- Albúmina
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('ALB', 'Albúmina', 'HEPATOGRAMA', 'g/dl', 3.50, 4.80, 1, '["ALBUMINA","ALBUMIN","ALB"]', 0);

-- ========================================
-- GASOMETRÍA
-- ========================================

-- pH
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('PH', 'pH', 'GASOMETRIA', '', 7.35, 7.45, 1, '["pH","PH","POTENCIAL HIDROGENO"]', 1);

-- pCO2
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('PCO2', 'pCO2', 'GASOMETRIA', 'mmHg', 35, 45, 1, '["pCO2","PCO2","PRESION PARCIAL CO2"]', 0);

-- pO2
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('PO2', 'pO2', 'GASOMETRIA', 'mmHg', 80, 105, 1, '["pO2","PO2","PRESION PARCIAL O2"]', 1);

-- HCO3
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('HCO3', 'HCO3-', 'GASOMETRIA', 'mmol/l', 22, 28, 1, '["HCO3","BICARBONATO","BICARBONATE"]', 0);

-- EB (Exceso de Base)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('EB', 'EB', 'GASOMETRIA', 'mmol/l', -2.5, 2.5, 1, '["EB","EXCESO BASE","BASE EXCESS"]', 0);

-- SatO2
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('SATO2', 'SatO2', 'GASOMETRIA', '%', 95, 100, 1, '["SatO2","SATURACION OXIGENO","OXYGEN SATURATION"]', 1);

-- ========================================
-- OTROS PARÁMETROS COMUNES
-- ========================================

-- LDH (Lactato Deshidrogenasa)
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('LDH', 'LDH', 'QUIMICA_CLINICA', 'U/l', 230, 460, 1, '["LDH","LACTATO DESHIDROGENASA","LACTATE DEHYDROGENASE"]', 0);

-- Fosfatemia
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, ValorMinimoNino, ValorMaximoNino, Activo, Sinonimos, AlertaCritica)
VALUES ('FOSF', 'Fosfatemia', 'QUIMICA_CLINICA', 'mg/dl', 2.5, 4.5, 4.0, 7.0, 1, '["FOSFATEMIA","FOSFORO","PHOSPHORUS","FOSF"]', 0);

-- Magnesio
INSERT INTO imHCExamenesLabDetalleConf (CodigoParametro, NombreParametro, Categoria, UnidadMedida, ValorMinimoAdulto, ValorMaximoAdulto, Activo, Sinonimos, AlertaCritica)
VALUES ('MG', 'Magnesio', 'QUIMICA_CLINICA', 'mg/dl', 1.70, 2.50, 1, '["MAGNESIO","MAGNESIUM","MG","MAGNESIO SERICO"]', 0);

PRINT 'Script completado. Se insertaron los parámetros de laboratorio más comunes.';
PRINT 'Total de parámetros configurados: 40';
