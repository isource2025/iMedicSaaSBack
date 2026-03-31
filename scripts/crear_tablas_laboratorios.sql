-- Script para crear las tablas de laboratorios
-- Ejecutar en SQL Server Management Studio

USE iMedicWs;
GO

-- ========================================
-- 1. Tabla de Cabecera de Exámenes
-- ========================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imHCExamenesLabCabecera]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[imHCExamenesLabCabecera] (
        [IdExamen] INT IDENTITY(1,1) NOT NULL,
        [NumeroVisita] INT NOT NULL,
        [FechaExamen] DATE NOT NULL,
        [HoraExamen] VARCHAR(5) NULL,
        [TipoEstudio] VARCHAR(50) NOT NULL,
        [Laboratorio] VARCHAR(100) NULL,
        [Protocolo] VARCHAR(50) NULL,
        [Observaciones] VARCHAR(500) NULL,
        [ArchivoAdjunto] VARCHAR(255) NULL,
        [FechaCarga] DATETIME NULL DEFAULT GETDATE(),
        [UsuarioCarga] VARCHAR(50) NULL,
        [Estado] VARCHAR(20) NULL DEFAULT 'PENDIENTE',
        CONSTRAINT [PK_imHCExamenesLabCabecera] PRIMARY KEY CLUSTERED ([IdExamen] ASC)
    );
    
    -- Índice para búsqueda por visita
    CREATE NONCLUSTERED INDEX [IX_imHCExamenesLabCabecera_NumeroVisita] 
    ON [dbo].[imHCExamenesLabCabecera] ([NumeroVisita]);
    
    PRINT 'Tabla imHCExamenesLabCabecera creada exitosamente';
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabCabecera ya existe';
END
GO

-- ========================================
-- 2. Tabla de Detalle de Exámenes
-- ========================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imHCExamenesLabDetalle]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[imHCExamenesLabDetalle] (
        [IdDetalle] INT IDENTITY(1,1) NOT NULL,
        [IdExamen] INT NOT NULL,
        [CodigoParametro] VARCHAR(20) NULL,
        [NombreParametro] VARCHAR(100) NOT NULL,
        [Resultado] VARCHAR(50) NOT NULL,
        [UnidadMedida] VARCHAR(20) NULL,
        [ValorReferencia] VARCHAR(100) NULL,
        [ValorMinimo] DECIMAL(10,2) NULL,
        [ValorMaximo] DECIMAL(10,2) NULL,
        [FueraDeRango] BIT NOT NULL DEFAULT 0,
        [Metodo] VARCHAR(100) NULL,
        [MarcaReactivo] VARCHAR(100) NULL,
        [Orden] INT NULL,
        CONSTRAINT [PK_imHCExamenesLabDetalle] PRIMARY KEY CLUSTERED ([IdDetalle] ASC),
        CONSTRAINT [FK_imHCExamenesLabDetalle_Cabecera] FOREIGN KEY ([IdExamen])
            REFERENCES [dbo].[imHCExamenesLabCabecera] ([IdExamen])
            ON DELETE CASCADE
    );
    
    -- Índice para búsqueda por examen
    CREATE NONCLUSTERED INDEX [IX_imHCExamenesLabDetalle_IdExamen] 
    ON [dbo].[imHCExamenesLabDetalle] ([IdExamen]);
    
    PRINT 'Tabla imHCExamenesLabDetalle creada exitosamente';
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabDetalle ya existe';
END
GO

-- ========================================
-- 3. Tabla de Configuración de Parámetros
-- ========================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imHCExamenesLabDetalleConf]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[imHCExamenesLabDetalleConf] (
        [IdParametro] INT IDENTITY(1,1) NOT NULL,
        [CodigoParametro] VARCHAR(20) NOT NULL,
        [NombreParametro] VARCHAR(100) NOT NULL,
        [Categoria] VARCHAR(50) NOT NULL,
        [UnidadMedida] VARCHAR(20) NULL,
        [ValorMinimoAdulto] DECIMAL(10,2) NULL,
        [ValorMaximoAdulto] DECIMAL(10,2) NULL,
        [ValorMinimoNino] DECIMAL(10,2) NULL,
        [ValorMaximoNino] DECIMAL(10,2) NULL,
        [ValorMinimoHombre] DECIMAL(10,2) NULL,
        [ValorMaximoHombre] DECIMAL(10,2) NULL,
        [ValorMinimoMujer] DECIMAL(10,2) NULL,
        [ValorMaximoMujer] DECIMAL(10,2) NULL,
        [Activo] BIT NOT NULL DEFAULT 1,
        [Sinonimos] VARCHAR(500) NULL,
        [AlertaCritica] BIT NOT NULL DEFAULT 0,
        CONSTRAINT [PK_imHCExamenesLabDetalleConf] PRIMARY KEY CLUSTERED ([IdParametro] ASC),
        CONSTRAINT [UQ_imHCExamenesLabDetalleConf_Codigo] UNIQUE ([CodigoParametro])
    );
    
    -- Índice para búsqueda por código
    CREATE NONCLUSTERED INDEX [IX_imHCExamenesLabDetalleConf_Codigo] 
    ON [dbo].[imHCExamenesLabDetalleConf] ([CodigoParametro]);
    
    -- Índice para búsqueda por categoría
    CREATE NONCLUSTERED INDEX [IX_imHCExamenesLabDetalleConf_Categoria] 
    ON [dbo].[imHCExamenesLabDetalleConf] ([Categoria]);
    
    PRINT 'Tabla imHCExamenesLabDetalleConf creada exitosamente';
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabDetalleConf ya existe';
END
GO

PRINT '';
PRINT '========================================';
PRINT 'TABLAS DE LABORATORIOS CREADAS';
PRINT '========================================';
PRINT 'Próximo paso: Ejecutar poblar_parametros_laboratorio.sql';
PRINT '';
