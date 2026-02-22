-- =============================================
-- Script de Creación de Tabla imHCI
-- Historia Clínica de Ingreso
-- Basado en auditoría de IOSCOR-APP
-- Fecha: 2026-02-22
-- =============================================

USE [iMedicDB]
GO

-- Verificar si la tabla existe y eliminarla si es necesario
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imHCI]') AND type in (N'U'))
BEGIN
    PRINT 'Eliminando tabla imHCI existente...'
    DROP TABLE [dbo].[imHCI]
END
GO

PRINT 'Creando tabla imHCI...'
GO

CREATE TABLE [dbo].[imHCI] (
    -- ========================================
    -- CAMPOS BÁSICOS
    -- ========================================
    [IdHCIngreso] INT PRIMARY KEY IDENTITY(1,1),
    [NumeroVisita] INT NOT NULL,
    [Fecha] DATETIME NOT NULL DEFAULT GETDATE(),
    [IdSector] VARCHAR(10),
    [IdProfecional] INT,
    [MotivoConsulta] VARCHAR(MAX),
    [EnfermedadActual] VARCHAR(MAX),
    [IMPRESIONDIAGNOSTICA] VARCHAR(MAX),
    [COMENTARIODEINGRESO] VARCHAR(MAX),
    [NUMEROVISITA] INT, -- Campo duplicado para compatibilidad
    
    -- Campos adicionales generales
    [ModMedica] VARCHAR(MAX),
    [Semiologia] VARCHAR(MAX),
    [EXAMENCOMPLEMENTARIO] VARCHAR(MAX),
    
    -- ========================================
    -- SIGNOS VITALES (SV_) - 18 campos
    -- ========================================
    [SV_GLUCEMIA] VARCHAR(50),
    [SV_PA] VARCHAR(50),
    [SV_FC] VARCHAR(50),
    [SV_FR] VARCHAR(50),
    [SV_TAX] VARCHAR(50),
    [SV_IMPRESIONGENERAL] VARCHAR(MAX),
    [SV_FACIE] VARCHAR(MAX),
    [SV_DECUBITO] VARCHAR(MAX),
    [SV_MARCHA] VARCHAR(MAX),
    [SV_TALLA] VARCHAR(50),
    [SV_PESOACTUAL] VARCHAR(50),
    [SV_PESOHABITUAL] VARCHAR(50),
    [SV_ESTADONUTRICIONAL] VARCHAR(MAX),
    [SV_VARICES] VARCHAR(MAX),
    [SV_FLEBITIS] VARCHAR(MAX),
    [SV_TROMBOSIS] VARCHAR(MAX),
    [SV_CIRCULACIONCOLATERAL] VARCHAR(MAX),
    [SV_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- PIEL Y FANERAS (PF_) - 8 campos
    -- ========================================
    [PF_COLORACION] VARCHAR(MAX),
    [PF_HUMEDAD] VARCHAR(MAX),
    [PF_TEMPERATURA] VARCHAR(MAX),
    [PF_DISTRIBUCIONPILOSA] VARCHAR(MAX),
    [PF_ELASTICIDAD] VARCHAR(MAX),
    [PF_UNIAS] VARCHAR(MAX),
    [PF_CICATRICES] VARCHAR(MAX),
    [PF_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- TEJIDO CELULAR SUBCUTÁNEO (TCS_) - 6 campos
    -- ========================================
    [TCS_DISTRIBUCION] VARCHAR(MAX),
    [TCS_CANTIDAD] VARCHAR(MAX),
    [TCS_NODULOS] VARCHAR(MAX),
    [TCS_ENFISEMA] VARCHAR(MAX),
    [TCS_EDEMAS] VARCHAR(MAX),
    [TCS_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- SISTEMA LINFÁTICO (SL_) - 3 campos
    -- ========================================
    [SL_LINFANGITIS] VARCHAR(MAX),
    [SL_ADENOMEGALIAS] VARCHAR(MAX),
    [SL_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- SISTEMA OSTEOARTICULOMUSCULAR (SOAM_) - 9 campos
    -- ========================================
    [SOAM_MUSCULOTROFISMOSENSIBILIDAD] VARCHAR(MAX),
    [SOAM_HUESOS] VARCHAR(MAX),
    [SOAM_COLUMNAVERTEBRAL] VARCHAR(MAX),
    [SOAM_ARTICULACIONES] VARCHAR(MAX),
    [SOAM_INDICETOBILLOBRAZODERECHA] VARCHAR(50),
    [SOAM_INDICETOBILLOBRAZOIZQUIERA] VARCHAR(50),
    [SOAM_PERIMETROMID] VARCHAR(50),
    [SOAM_PERIMETROMII] VARCHAR(50),
    [SOAM_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- CABEZA (C_) - 17 campos
    -- ========================================
    [C_FORMA] VARCHAR(MAX),
    [C_TAMANIO] VARCHAR(MAX),
    [C_OJOS] VARCHAR(MAX),
    [C_PUPILAS] VARCHAR(MAX),
    [C_CONJUNTIVAS] VARCHAR(MAX),
    [C_CORNEAS] VARCHAR(MAX),
    [C_ESCLEROTICAS] VARCHAR(MAX),
    [C_PARPADOS] VARCHAR(MAX),
    [C_FOSASNASALES] VARCHAR(MAX),
    [C_BOCA] VARCHAR(MAX),
    [C_LABIOS] VARCHAR(MAX),
    [C_ENCIAS] VARCHAR(MAX),
    [C_FAUCES] VARCHAR(MAX),
    [C_LENGUA] VARCHAR(MAX),
    [C_DIENTES] VARCHAR(MAX),
    [C_GLANDULASSALIVALES] VARCHAR(MAX),
    [C_PABELLONESAURICULARESYCAE] VARCHAR(MAX),
    [C_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- CUELLO (CU_) - 7 campos
    -- ========================================
    [CU_CONFORMACION] VARCHAR(MAX),
    [CU_LARINGE] VARCHAR(MAX),
    [CU_HUECOSUPRACLAVICULAR] VARCHAR(MAX),
    [CU_HUECOINFRACLAVICULAR] VARCHAR(MAX),
    [CU_YUGULARES] VARCHAR(MAX),
    [CU_TIROIDES] VARCHAR(MAX),
    [CU_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- MAMAS (M_, MI_, MP_) - 20 campos
    -- ========================================
    [M_SIMETRIA] VARCHAR(MAX),
    [M_NODULOS] VARCHAR(MAX),
    [MI_TAMANO] VARCHAR(MAX),
    [MI_SUPERFICIE] VARCHAR(MAX),
    [MI_AREOLAS] VARCHAR(MAX),
    [MI_PEZONES] VARCHAR(MAX),
    [MI_MANIOBRAPECTORALES] VARCHAR(MAX),
    [MI_PIELRETRACCION] INT,
    [MI_ELEVACION] INT,
    [MI_DENARANJA] INT,
    [MI_ULCERAS] INT,
    [MI_TEXTO] VARCHAR(MAX),
    [MP_LIMITES] VARCHAR(MAX),
    [MP_DOLOROSA] VARCHAR(MAX),
    [MP_SUPERFICIE] VARCHAR(MAX),
    [MP_CONSISTENCIA] VARCHAR(MAX),
    [MP_TUMOR] VARCHAR(MAX),
    [MP_FIJACIONPIEL] VARCHAR(MAX),
    [MP_DERRAMEPORPEZON] VARCHAR(MAX),
    
    -- ========================================
    -- APARATO RESPIRATORIO (AR_) - 12 campos
    -- ========================================
    [AR_TORAX] VARCHAR(MAX),
    [AR_FORMA] VARCHAR(MAX),
    [AR_ELASTICIDAD] VARCHAR(MAX),
    [AR_TIPORESPIRATORIO] VARCHAR(MAX),
    [AR_EXPANSIONDEVERTICES] VARCHAR(MAX),
    [AR_BASES] VARCHAR(MAX),
    [AR_VIBRACIONESVOCALES] VARCHAR(MAX),
    [AR_INSPECCION] VARCHAR(MAX),
    [AR_PALPACION] VARCHAR(MAX),
    [AR_PERCUSION] VARCHAR(MAX),
    [AR_AUSCULTACION] VARCHAR(MAX),
    [AR_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- APARATO CARDIOVASCULAR (AC_) - 16 campos
    -- ========================================
    [AC_FRECUENCIACARDIACA] VARCHAR(50),
    [AC_CENTRAL] VARCHAR(MAX),
    [AC_PERIFERICA] VARCHAR(MAX),
    [AC_PULSORADIAL] VARCHAR(MAX),
    [AC_RELLENOAPILAR] VARCHAR(MAX),
    [AC_LATIDOAPEXIANO] VARCHAR(MAX),
    [AC_LATIDOPALPABLES] VARCHAR(MAX),
    [AC_AUSCULTACION] VARCHAR(MAX),
    [AC_R1] VARCHAR(MAX),
    [AC_R2] VARCHAR(MAX),
    [AC_RUIDOSAGREGADOS] VARCHAR(MAX),
    [AC_FROTES] VARCHAR(MAX),
    [AC_SOPLOS] VARCHAR(MAX),
    [AC_PALPACION] VARCHAR(MAX),
    [AC_PULSOS] VARCHAR(MAX),
    [AC_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- ABDOMEN (A_) - 17 campos
    -- ========================================
    [A_INSPECCION] VARCHAR(MAX),
    [A_PALPACION] VARCHAR(MAX),
    [A_SUPERFICIAL] VARCHAR(MAX),
    [A_PROFUNDA] VARCHAR(MAX),
    [A_PERCUSION] VARCHAR(MAX),
    [A_HIGADO] VARCHAR(MAX),
    [A_LIMTESUP] VARCHAR(MAX),
    [A_LIMTEINF] VARCHAR(MAX),
    [A_ALTURA] VARCHAR(MAX),
    [A_CARACTERISTICAS] VARCHAR(MAX),
    [A_AUSCULTACION] VARCHAR(MAX),
    [A_RHA] VARCHAR(MAX),
    [A_SOPLOS] VARCHAR(MAX),
    [A_CELDAESPLENICA] VARCHAR(MAX),
    [A_BAZO] VARCHAR(MAX),
    [A_PERIMETRO] VARCHAR(50),
    [A_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- APARATO UROGENITAL/INTESTINAL (AUG_, AIG_) - 6 campos
    -- ========================================
    [AUG_GENITALESEXTERNOS] VARCHAR(MAX),
    [AUG_TACTOVAGINAL] VARCHAR(MAX),
    [AIG_TACTORECTAL] VARCHAR(MAX),
    [AUG_PUNIOPERCUSION] VARCHAR(MAX),
    [AUG_PUNTOSURETRALES] VARCHAR(MAX),
    [AUG_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- SISTEMA NERVIOSO (SN_) - 10 campos
    -- ========================================
    [SN_CONCIENCIA] VARCHAR(MAX),
    [SN_MARCHA] VARCHAR(MAX),
    [SN_TONOMUSCULAR] VARCHAR(MAX),
    [SN_FUERZAMUSCULAR] VARCHAR(MAX),
    [SN_SIGNOSPIRAMIDALES] VARCHAR(MAX),
    [SN_SENSIBILIDADSUPERFICIAL] VARCHAR(MAX),
    [SN_SIGNOSMENINGEOS] VARCHAR(MAX),
    [SN_PARESCRANEANOS] VARCHAR(MAX),
    [SN_TAXIA] VARCHAR(MAX),
    [SN_PRAXIA] VARCHAR(MAX),
    [SN_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- EXAMEN OFTALMOLÓGICO (EO_) - 35 campos
    -- ========================================
    [EO_FONDODEOJO] VARCHAR(MAX),
    [EO_MEDIOSBIREFRIGENTES] VARCHAR(MAX),
    [EO_CRUCES] VARCHAR(MAX),
    [EO_RELACION] VARCHAR(MAX),
    [EO_HEMORRAGIAEXUDADOS] VARCHAR(MAX),
    [EO_AU] VARCHAR(MAX),
    [EO_TONO] VARCHAR(MAX),
    [EO_LCF] VARCHAR(MAX),
    [EO_MFA] VARCHAR(MAX),
    [EO_DU] VARCHAR(MAX),
    [EO_LEOPOLD] VARCHAR(MAX),
    [EO_TACTOVAGINAL] VARCHAR(MAX),
    [EO_BISHOP_P] VARCHAR(50),
    [EO_BISHOP_R] VARCHAR(50),
    [EO_BISHOP_E] VARCHAR(50),
    [EO_BISHOP_L] VARCHAR(50),
    [EO_BISHOP_D] VARCHAR(50),
    [EO_MEMBRANASOVULARES] VARCHAR(MAX),
    [EO_MANIOBRADETAMIER] VARCHAR(MAX),
    [EO_PLANO] VARCHAR(MAX),
    [EO_PELVIMETRIA] VARCHAR(MAX),
    [EO_HIDRORREA] VARCHAR(MAX),
    [EO_GINECORRAGIA] VARCHAR(MAX),
    [EO_LOQUIOS] VARCHAR(MAX),
    [EO_RETRACCION] VARCHAR(MAX),
    [EO_MAMAS] VARCHAR(MAX),
    [EO_LACTANCIA] VARCHAR(MAX),
    [EO_PERINE] VARCHAR(MAX),
    [EO_ESPECULOSCOPIA] VARCHAR(MAX),
    [EO_TBM] VARCHAR(MAX),
    [EO_DIAGNOSTICO] VARCHAR(MAX),
    [EO_REFRACCION] VARCHAR(MAX),
    [EO_BIOMOSCROPIA] VARCHAR(MAX),
    [EO_TONOMETRIA] VARCHAR(MAX),
    [EO_PRACTICAQUIRURGICA] VARCHAR(MAX),
    
    -- ========================================
    -- ELECTROCARDIOGRAMA (EC_) - 13 campos
    -- ========================================
    [EC_RITMO] VARCHAR(MAX),
    [EC_FRECUENCIA] VARCHAR(50),
    [EC_PR] VARCHAR(50),
    [EC_QT] VARCHAR(50),
    [EC_ONDAP] VARCHAR(MAX),
    [EC_DURACION] VARCHAR(50),
    [EC_AMPLITUD] VARCHAR(50),
    [EC_CONFORMACION] VARCHAR(MAX),
    [EC_QRS] VARCHAR(MAX),
    [EC_DURACION1] VARCHAR(50),
    [EC_ONDAT] VARCHAR(MAX),
    [EC_ST] VARCHAR(MAX),
    [EC_EJE] VARCHAR(MAX),
    [EC_CONCLUSIONES] VARCHAR(MAX),
    
    -- ========================================
    -- RADIOLOGÍA DE TÓRAX (RDT_) - 14 campos
    -- ========================================
    [RDT_DATETIME] DATETIME,
    [RDT_TECNICA] VARCHAR(MAX),
    [RDT_PARTESBLANDAS] VARCHAR(MAX),
    [RDT_PARTESOSEAS] VARCHAR(MAX),
    [RDT_HEMIDIAFRAGMAS] VARCHAR(MAX),
    [RDT_ICT] VARCHAR(50),
    [RDT_SENOSCOSTOFRENICOS] VARCHAR(MAX),
    [RDT_MEDIASTINO] VARCHAR(MAX),
    [RDT_SILUETACARDIOVASCULAR] VARCHAR(MAX),
    [RDT_HILIOS] VARCHAR(MAX),
    [RDT_CAMPOSPULMONARES] VARCHAR(MAX),
    [RDT_CONCLUSIONES] VARCHAR(MAX),
    [RDT_POSICION] VARCHAR(MAX),
    [RDT_PARENQUIMA] VARCHAR(MAX),
    [RDT_LABORATORIO] VARCHAR(MAX),
    
    -- ========================================
    -- PROCEDIMIENTOS DIAGNÓSTICOS (PD_) - 11 campos
    -- ========================================
    [PD_A] VARCHAR(MAX),
    [PD_B] VARCHAR(MAX),
    [PD_C] VARCHAR(MAX),
    [PD_D] VARCHAR(MAX),
    [PD_E] VARCHAR(MAX),
    [PD_F] VARCHAR(MAX),
    [PD_G] VARCHAR(MAX),
    [PD_H] VARCHAR(MAX),
    [PD_I] VARCHAR(MAX),
    [PD_J] VARCHAR(MAX),
    [PD_K] VARCHAR(MAX),
    
    -- ========================================
    -- PROCEDIMIENTOS TERAPÉUTICOS (PT_) - 15 campos
    -- ========================================
    [PT_1] VARCHAR(MAX),
    [PT_2] VARCHAR(MAX),
    [PT_3] VARCHAR(MAX),
    [PT_4] VARCHAR(MAX),
    [PT_5] VARCHAR(MAX),
    [PT_6] VARCHAR(MAX),
    [PT_7] VARCHAR(MAX),
    [PT_8] VARCHAR(MAX),
    [PT_9] VARCHAR(MAX),
    [PT_10] VARCHAR(MAX),
    [PT_11] VARCHAR(MAX),
    [PT_12] VARCHAR(MAX),
    [PT_13] VARCHAR(MAX),
    [PT_14] VARCHAR(MAX),
    [PT_15] VARCHAR(MAX),
    
    -- ========================================
    -- APARATO DIGESTIVO (AD_) - 4 campos
    -- ========================================
    [AD_INSPECCION] VARCHAR(MAX),
    [AD_PALPACION] VARCHAR(MAX),
    [AD_PERCUSION] VARCHAR(MAX),
    [AD_AUSCULTACION] VARCHAR(MAX),
    
    -- ========================================
    -- EXAMEN NEUROLÓGICO (EN_) - 3 campos
    -- ========================================
    [EN_GLASGOW] VARCHAR(50),
    [EN_SENCIVILIDAD] VARCHAR(MAX),
    [EN_MOTRICIDAD] VARCHAR(MAX),
    
    -- ========================================
    -- EXAMEN GINECOLÓGICO (EG_) - 12 campos
    -- ========================================
    [EG_MONTEDEVENUS] VARCHAR(MAX),
    [EG_LABIOSMAYORESMENORES] VARCHAR(MAX),
    [EG_CLITORIS] VARCHAR(MAX),
    [EG_INTROITO] VARCHAR(MAX),
    [EG_VAGINA] VARCHAR(MAX),
    [EG_FONDOSACOVAGINAL] VARCHAR(MAX),
    [EG_CERVIX] VARCHAR(MAX),
    [EG_UTERO] VARCHAR(MAX),
    [EG_ANEXOS] VARCHAR(MAX),
    [EG_EXAMENAB_VA_RE] VARCHAR(MAX),
    [EG_ESPECULOSCOPIA] VARCHAR(MAX),
    [EG_TEXTO] VARCHAR(MAX),
    
    -- ========================================
    -- DIABETES (DIA_) - 7 campos
    -- ========================================
    [DIA_DETERMINACION] VARCHAR(MAX),
    [DIA_DIETA] VARCHAR(MAX),
    [DIA_MONITOREO] VARCHAR(MAX),
    [DIA_EDUCACION] VARCHAR(MAX),
    [DIA_PIE] VARCHAR(MAX),
    [DIA_DOPLER] VARCHAR(MAX),
    [DIA_CURVA] VARCHAR(MAX),
    
    -- ========================================
    -- CAMPOS DE AUDITORÍA
    -- ========================================
    [FechaCreacion] DATETIME NOT NULL DEFAULT GETDATE(),
    [FechaModificacion] DATETIME,
    [UsuarioCreacion] INT,
    [UsuarioModificacion] INT,
    [Activo] BIT NOT NULL DEFAULT 1
)
GO

PRINT 'Tabla imHCI creada exitosamente.'
PRINT 'Total de campos: ~330'
GO

-- ========================================
-- CREAR ÍNDICES
-- ========================================
PRINT 'Creando índices...'
GO

CREATE NONCLUSTERED INDEX IX_HCI_NumeroVisita 
ON [dbo].[imHCI] ([NumeroVisita])
GO

CREATE NONCLUSTERED INDEX IX_HCI_Fecha 
ON [dbo].[imHCI] ([Fecha] DESC)
GO

CREATE NONCLUSTERED INDEX IX_HCI_Profesional 
ON [dbo].[imHCI] ([IdProfecional])
GO

CREATE NONCLUSTERED INDEX IX_HCI_Sector 
ON [dbo].[imHCI] ([IdSector])
GO

CREATE NONCLUSTERED INDEX IX_HCI_Activo 
ON [dbo].[imHCI] ([Activo])
WHERE [Activo] = 1
GO

PRINT 'Índices creados exitosamente.'
GO

-- ========================================
-- CREAR FOREIGN KEYS (si las tablas existen)
-- ========================================
PRINT 'Creando foreign keys...'
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imVisita]') AND type in (N'U'))
BEGIN
    ALTER TABLE [dbo].[imHCI]
    ADD CONSTRAINT FK_HCI_Visita 
    FOREIGN KEY ([NumeroVisita]) REFERENCES [dbo].[imVisita]([NUMEROVISITA])
    PRINT 'FK_HCI_Visita creada.'
END
ELSE
BEGIN
    PRINT 'ADVERTENCIA: Tabla imVisita no existe. FK_HCI_Visita no creada.'
END
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imPassword]') AND type in (N'U'))
BEGIN
    ALTER TABLE [dbo].[imHCI]
    ADD CONSTRAINT FK_HCI_Profesional 
    FOREIGN KEY ([IdProfecional]) REFERENCES [dbo].[imPassword]([CodOperador])
    PRINT 'FK_HCI_Profesional creada.'
END
ELSE
BEGIN
    PRINT 'ADVERTENCIA: Tabla imPassword no existe. FK_HCI_Profesional no creada.'
END
GO

PRINT '========================================='
PRINT 'SCRIPT COMPLETADO EXITOSAMENTE'
PRINT '========================================='
PRINT ''
PRINT 'Tabla imHCI creada con:'
PRINT '  - ~330 campos médicos'
PRINT '  - 22 secciones médicas'
PRINT '  - 5 índices'
PRINT '  - 2 foreign keys (si las tablas existen)'
PRINT ''
PRINT 'Próximos pasos:'
PRINT '  1. Ejecutar script de análisis: node scripts/analizar_estructura_hci.js'
PRINT '  2. Revisar documentación generada en docs/'
PRINT '  3. Implementar servicios backend'
PRINT '  4. Implementar componentes frontend'
PRINT ''
GO
