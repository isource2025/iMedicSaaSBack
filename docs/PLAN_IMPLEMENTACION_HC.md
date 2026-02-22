# 🚀 PLAN DE IMPLEMENTACIÓN - HISTORIA CLÍNICA EN iMedicWs

**Fecha:** 22 de Febrero, 2026  
**Proyecto:** iMedicWs  
**Basado en:** IOSCOR-APP Historia Clínica System

---

## 📋 RESUMEN EJECUTIVO

Este documento detalla el plan completo para implementar el sistema de Historia Clínica en iMedicWs, basado en la auditoría completa de IOSCOR-APP.

**Objetivo:** Implementar un sistema completo de Historia Clínica con:
- ✅ Visualización estructurada por secciones médicas
- ✅ Exportación a PDF profesional
- ✅ Integración con sistema de camas
- ✅ +300 campos médicos organizados

---

## 🎯 FASES DEL PROYECTO

### FASE 1: PREPARACIÓN DE BASE DE DATOS ⏱️ 2-3 días

#### 1.1 Crear Tabla imHCI
```sql
CREATE TABLE imHCI (
  -- Campos básicos
  IdHCIngreso INT PRIMARY KEY IDENTITY(1,1),
  NumeroVisita INT NOT NULL,
  Fecha DATETIME NOT NULL DEFAULT GETDATE(),
  IdSector VARCHAR(10),
  IdProfecional INT,
  MotivoConsulta TEXT,
  EnfermedadActual TEXT,
  IMPRESIONDIAGNOSTICA TEXT,
  COMENTARIODEINGRESO TEXT,
  
  -- Campos adicionales generales
  ModMedica VARCHAR(MAX),
  Semiologia VARCHAR(MAX),
  EXAMENCOMPLEMENTARIO VARCHAR(MAX),
  
  -- Signos Vitales (SV_)
  SV_GLUCEMIA VARCHAR(50),
  SV_PA VARCHAR(50),
  SV_FC VARCHAR(50),
  SV_FR VARCHAR(50),
  SV_TAX VARCHAR(50),
  SV_IMPRESIONGENERAL VARCHAR(MAX),
  SV_FACIE VARCHAR(MAX),
  SV_DECUBITO VARCHAR(MAX),
  SV_MARCHA VARCHAR(MAX),
  SV_TALLA VARCHAR(50),
  SV_PESOACTUAL VARCHAR(50),
  SV_PESOHABITUAL VARCHAR(50),
  SV_ESTADONUTRICIONAL VARCHAR(MAX),
  SV_VARICES VARCHAR(MAX),
  SV_FLEBITIS VARCHAR(MAX),
  SV_TROMBOSIS VARCHAR(MAX),
  SV_CIRCULACIONCOLATERAL VARCHAR(MAX),
  SV_TEXTO VARCHAR(MAX),
  
  -- Piel y Faneras (PF_)
  PF_COLORACION VARCHAR(MAX),
  PF_HUMEDAD VARCHAR(MAX),
  PF_TEMPERATURA VARCHAR(MAX),
  PF_DISTRIBUCIONPILOSA VARCHAR(MAX),
  PF_ELASTICIDAD VARCHAR(MAX),
  PF_UNIAS VARCHAR(MAX),
  PF_CICATRICES VARCHAR(MAX),
  PF_TEXTO VARCHAR(MAX),
  
  -- ... (continuar con todas las secciones)
  
  -- Índices
  CONSTRAINT FK_HCI_Visita FOREIGN KEY (NumeroVisita) 
    REFERENCES imVisita(NUMEROVISITA),
  CONSTRAINT FK_HCI_Profesional FOREIGN KEY (IdProfecional) 
    REFERENCES imPassword(CodOperador)
);

-- Índices para optimización
CREATE INDEX IX_HCI_NumeroVisita ON imHCI(NumeroVisita);
CREATE INDEX IX_HCI_Fecha ON imHCI(Fecha DESC);
CREATE INDEX IX_HCI_Profesional ON imHCI(IdProfecional);
```

#### 1.2 Script de Creación Completo
- [ ] Crear `create_table_hci.sql` con todos los campos
- [ ] Incluir todos los prefijos de secciones
- [ ] Agregar índices necesarios
- [ ] Crear constraints de integridad

#### 1.3 Validación
- [ ] Ejecutar script en base de datos de desarrollo
- [ ] Verificar estructura con script de análisis
- [ ] Confirmar relaciones con otras tablas

---

### FASE 2: BACKEND - SERVICIOS Y APIS ⏱️ 4-5 días

#### 2.1 Servicio de Historia Clínica

**Archivo:** `src/services/hci.service.js`

```javascript
const { executeQuery } = require('../models/db');

class HCIService {
  /**
   * Obtener HC por número de visita
   */
  async getByNumeroVisita(numeroVisita) {
    const query = `
      SELECT h.*, 
        p.Apellido + ' ' + p.Nombres as ProfesionalNombre,
        s.Descripcion as SectorDescripcion
      FROM imHCI h
      LEFT JOIN imPassword p ON h.IdProfecional = p.CodOperador
      LEFT JOIN imSectores s ON h.IdSector = s.Valor
      WHERE h.NumeroVisita = @numeroVisita
      ORDER BY h.Fecha DESC
    `;
    
    return await executeQuery(query, [
      { name: 'numeroVisita', type: 'Int', value: numeroVisita }
    ]);
  }

  /**
   * Crear nueva HC
   */
  async crear(data) {
    // Construir query dinámicamente basado en campos presentes
    const campos = Object.keys(data).filter(k => data[k] !== undefined);
    const valores = campos.map(c => `@${c}`).join(', ');
    const columnas = campos.join(', ');
    
    const query = `
      INSERT INTO imHCI (${columnas})
      OUTPUT INSERTED.*
      VALUES (${valores})
    `;
    
    const params = campos.map(campo => ({
      name: campo,
      type: this.getTipoSQL(campo),
      value: data[campo]
    }));
    
    return await executeQuery(query, params);
  }

  /**
   * Actualizar HC existente
   */
  async actualizar(id, data) {
    const campos = Object.keys(data)
      .filter(k => k !== 'IdHCIngreso' && data[k] !== undefined)
      .map(k => `${k} = @${k}`)
      .join(', ');
    
    const query = `
      UPDATE imHCI 
      SET ${campos}
      OUTPUT INSERTED.*
      WHERE IdHCIngreso = @id
    `;
    
    const params = [
      { name: 'id', type: 'Int', value: id },
      ...Object.keys(data)
        .filter(k => k !== 'IdHCIngreso' && data[k] !== undefined)
        .map(campo => ({
          name: campo,
          type: this.getTipoSQL(campo),
          value: data[campo]
        }))
    ];
    
    return await executeQuery(query, params);
  }

  /**
   * Obtener HC por ID de paciente
   */
  async getByIdPaciente(idPaciente) {
    const query = `
      SELECT h.*, v.NUMEROVISITA,
        p.Apellido + ' ' + p.Nombres as ProfesionalNombre,
        s.Descripcion as SectorDescripcion
      FROM imVisita v
      INNER JOIN imHCI h ON v.NUMEROVISITA = h.NumeroVisita
      LEFT JOIN imPassword p ON h.IdProfecional = p.CodOperador
      LEFT JOIN imSectores s ON h.IdSector = s.Valor
      WHERE v.IdPaciente = @idPaciente
      ORDER BY h.Fecha DESC
    `;
    
    return await executeQuery(query, [
      { name: 'idPaciente', type: 'Int', value: idPaciente }
    ]);
  }

  getTipoSQL(campo) {
    if (campo.includes('Id') || campo === 'NumeroVisita') return 'Int';
    if (campo === 'Fecha') return 'DateTime';
    return 'VarChar';
  }
}

module.exports = new HCIService();
```

#### 2.2 Controlador

**Archivo:** `src/controllers/hci.controller.js`

```javascript
const hciService = require('../services/hci.service');

exports.getByNumeroVisita = async (req, res) => {
  try {
    const { numeroVisita } = req.params;
    const hc = await hciService.getByNumeroVisita(numeroVisita);
    
    res.json({
      success: true,
      data: hc
    });
  } catch (error) {
    console.error('Error al obtener HC:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener historia clínica'
    });
  }
};

exports.crear = async (req, res) => {
  try {
    const hc = await hciService.crear(req.body);
    
    res.status(201).json({
      success: true,
      data: hc,
      mensaje: 'Historia clínica creada exitosamente'
    });
  } catch (error) {
    console.error('Error al crear HC:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al crear historia clínica'
    });
  }
};

exports.actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const hc = await hciService.actualizar(id, req.body);
    
    res.json({
      success: true,
      data: hc,
      mensaje: 'Historia clínica actualizada exitosamente'
    });
  } catch (error) {
    console.error('Error al actualizar HC:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar historia clínica'
    });
  }
};
```

#### 2.3 Rutas

**Archivo:** `src/routes/hci.routes.js`

```javascript
const express = require('express');
const router = express.Router();
const hciController = require('../controllers/hci.controller');
const { verificarToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// GET - Obtener HC por número de visita
router.get('/visita/:numeroVisita', hciController.getByNumeroVisita);

// GET - Obtener HC por ID de paciente
router.get('/paciente/:idPaciente', hciController.getByIdPaciente);

// POST - Crear nueva HC
router.post('/', hciController.crear);

// PUT - Actualizar HC
router.put('/:id', hciController.actualizar);

// DELETE - Eliminar HC (soft delete)
router.delete('/:id', hciController.eliminar);

module.exports = router;
```

#### 2.4 Tareas Backend
- [ ] Crear `hci.service.js` completo
- [ ] Crear `hci.controller.js` completo
- [ ] Crear `hci.routes.js`
- [ ] Registrar rutas en `app.js`
- [ ] Crear tests unitarios
- [ ] Documentar API con Swagger/JSDoc

---

### FASE 3: FRONTEND - SERVICIOS ⏱️ 2-3 días

#### 3.1 Tipos TypeScript

**Archivo:** `src/app/types/hci.ts`

```typescript
export interface HCIItem {
  idHCIngreso: number;
  numeroVisita: number;
  fecha: string;
  idSector: string;
  idProfecional: number;
  motivoConsulta: string;
  enfermedadActual: string;
  impresionDiagnostica: string;
  comentarioDeIngreso: string;
  
  // Signos Vitales
  sv_glucemia?: string;
  sv_pa?: string;
  sv_fc?: string;
  // ... todos los campos
}

export interface HCIItemWithMedicoAndSector extends HCIItem {
  profesionalNombre?: string;
  sectorDescripcion?: string;
}

export interface NuevaHCPayload {
  numeroVisita: number;
  idSector: string;
  idProfecional: number;
  motivoConsulta: string;
  enfermedadActual: string;
  impresionDiagnostica?: string;
  comentarioDeIngreso?: string;
  // Campos dinámicos por sección
  [key: string]: any;
}
```

#### 3.2 Servicio Frontend

**Archivo:** `src/app/services/hciService.ts`

```typescript
import { HCIItem, HCIItemWithMedicoAndSector, NuevaHCPayload } from '../types/hci';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export const hciService = {
  async getByNumeroVisita(numeroVisita: number): Promise<HCIItemWithMedicoAndSector[]> {
    const res = await fetch(`${BASE_URL}/hci/visita/${numeroVisita}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) throw new Error('Error al obtener HC');
    
    const json = await res.json();
    return json.data || [];
  },

  async crear(data: NuevaHCPayload): Promise<HCIItem> {
    const res = await fetch(`${BASE_URL}/hci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) throw new Error('Error al crear HC');
    
    const json = await res.json();
    return json.data;
  },

  async actualizar(id: number, data: Partial<NuevaHCPayload>): Promise<HCIItem> {
    const res = await fetch(`${BASE_URL}/hci/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) throw new Error('Error al actualizar HC');
    
    const json = await res.json();
    return json.data;
  }
};
```

#### 3.3 Tareas Frontend Servicios
- [ ] Crear `hci.ts` con tipos completos
- [ ] Crear `hciService.ts` con todos los métodos
- [ ] Agregar manejo de errores
- [ ] Implementar caché si es necesario

---

### FASE 4: FRONTEND - COMPONENTES ⏱️ 5-6 días

#### 4.1 Sección de Historia Clínica

**Archivo:** `src/app/components/beds/hci/HCISection.tsx`

```typescript
'use client';

import React, { useState } from 'react';
import { useBedDetail } from '../contexts/BedDetailContext';
import { useBedSectionFetch } from '../contexts/useBedSectionQuery';
import HCITable from './HCITable';
import HCIDetalle from './HCIDetalle';
import NuevaHCModal from './NuevaHCModal';
import styles from './HCISection.module.css';

interface HCISectionProps {
  numeroVisita: number | null;
  patientName?: string;
  patientLocation?: string;
}

const HCISection: React.FC<HCISectionProps> = ({
  numeroVisita,
  patientName,
  patientLocation
}) => {
  const { activeSection } = useBedDetail();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detalleId, setDetalleId] = useState<number | null>(null);

  // Fetch data
  const { data, isLoading, error, refetch } = useBedSectionFetch({
    enabled: activeSection === 'historia-clinica' && !!numeroVisita,
    endpointOverride: {
      'historia-clinica': `/hci/visita/${numeroVisita}`
    }
  });

  if (activeSection !== 'historia-clinica') return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Historia Clínica</h2>
        <button onClick={() => setModalOpen(true)}>
          + Nueva Historia Clínica
        </button>
      </div>

      <HCITable
        data={data || []}
        isLoading={isLoading}
        onSelectRow={setDetalleId}
        onEdit={setSelectedId}
      />

      {modalOpen && (
        <NuevaHCModal
          numeroVisita={numeroVisita}
          idHCI={selectedId}
          onClose={() => {
            setModalOpen(false);
            setSelectedId(null);
          }}
          onSave={async (data) => {
            // Guardar HC
            await refetch();
          }}
        />
      )}

      {detalleId && (
        <HCIDetalle
          idHCI={detalleId}
          onClose={() => setDetalleId(null)}
        />
      )}
    </div>
  );
};

export default HCISection;
```

#### 4.2 Tabla de Historia Clínica

**Archivo:** `src/app/components/beds/hci/HCITable.tsx`

Tabla con columnas:
- Fecha
- Profesional
- Sector
- Motivo de Consulta
- Acciones (Ver, Editar, PDF)

#### 4.3 Modal de Detalle

**Archivo:** `src/app/components/beds/hci/HCIDetalle.tsx`

Modal que muestra:
- Información básica
- Secciones agrupadas por prefijos
- Botón de descarga PDF

#### 4.4 Modal de Nueva/Editar HC

**Archivo:** `src/app/components/beds/hci/NuevaHCModal.tsx`

Formulario con:
- Campos básicos
- Acordeones por sección médica
- Validación de campos
- Guardado dinámico

#### 4.5 Tareas Frontend Componentes
- [ ] Crear `HCISection.tsx`
- [ ] Crear `HCITable.tsx` con estilos homogeneizados
- [ ] Crear `HCIDetalle.tsx` con visualización por secciones
- [ ] Crear `NuevaHCModal.tsx` con formulario completo
- [ ] Crear estilos `.module.css` para cada componente
- [ ] Integrar con BedDetailView

---

### FASE 5: EXPORTACIÓN PDF ⏱️ 2-3 días

#### 5.1 Instalación de Dependencias

```bash
npm install jspdf jspdf-autotable
npm install --save-dev @types/jspdf
```

#### 5.2 Utilidad de PDF

**Archivo:** `src/app/utils/pdfHCI.ts`

```typescript
import type { HCIItemWithMedicoAndSector } from '../types/hci';

export async function generarPdfHistoriaClinica(
  item: HCIItemWithMedicoAndSector,
  opciones?: { nombreArchivo?: string }
) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  
  // Colores iMedicWs (Pantone)
  const primary = '#0083A9'; // Pantone 314C
  const secondary = '#00B5E2'; // Pantone 313U
  
  // Header con logo y título
  // Información básica
  // Secciones dinámicas
  // Footer con paginación
  
  doc.save(opciones?.nombreArchivo || `HC_${item.numeroVisita}.pdf`);
}
```

#### 5.3 Tareas PDF
- [ ] Crear `pdfHCI.ts` con generación completa
- [ ] Adaptar estilos a branding iMedicWs
- [ ] Agregar logo de la institución
- [ ] Implementar paginación
- [ ] Agregar footer personalizado

---

### FASE 6: INTEGRACIÓN ⏱️ 2-3 días

#### 6.1 Integrar en BedDetailView

```typescript
// Agregar sección en sidebar
const sections = [
  { id: 'evoluciones', label: 'Evoluciones', icon: <IoDocumentText /> },
  { id: 'indicaciones', label: 'Indicaciones', icon: <IoMedical /> },
  { id: 'historia-clinica', label: 'Historia Clínica', icon: <IoClipboard /> },
  // ...
];
```

#### 6.2 Tareas de Integración
- [ ] Agregar sección HC al sidebar
- [ ] Conectar con calendario de fechas
- [ ] Implementar filtros por fecha
- [ ] Agregar búsqueda por profesional
- [ ] Integrar con permisos de usuario

---

### FASE 7: TESTING Y OPTIMIZACIÓN ⏱️ 3-4 días

#### 7.1 Tests Backend
- [ ] Tests unitarios de servicios
- [ ] Tests de integración de APIs
- [ ] Tests de validación de datos
- [ ] Tests de permisos

#### 7.2 Tests Frontend
- [ ] Tests de componentes
- [ ] Tests de servicios
- [ ] Tests de integración
- [ ] Tests E2E con Playwright

#### 7.3 Optimización
- [ ] Optimizar queries SQL
- [ ] Implementar caché en frontend
- [ ] Lazy loading de secciones
- [ ] Optimizar generación de PDF

---

## 📊 CRONOGRAMA

| Fase | Duración | Inicio | Fin |
|------|----------|--------|-----|
| 1. Base de Datos | 2-3 días | Día 1 | Día 3 |
| 2. Backend | 4-5 días | Día 4 | Día 8 |
| 3. Frontend Servicios | 2-3 días | Día 9 | Día 11 |
| 4. Frontend Componentes | 5-6 días | Día 12 | Día 17 |
| 5. Exportación PDF | 2-3 días | Día 18 | Día 20 |
| 6. Integración | 2-3 días | Día 21 | Día 23 |
| 7. Testing | 3-4 días | Día 24 | Día 27 |

**Total Estimado:** 20-27 días (4-5 semanas)

---

## 🎯 ENTREGABLES

1. ✅ Tabla `imHCI` creada y poblada
2. ✅ APIs REST completas y documentadas
3. ✅ Componentes React funcionales
4. ✅ Exportación a PDF operativa
5. ✅ Integración completa en BedDetailView
6. ✅ Tests automatizados
7. ✅ Documentación técnica
8. ✅ Manual de usuario

---

## 🚨 RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Complejidad de +300 campos | Alta | Alto | Generación automática de código |
| Performance con muchos datos | Media | Alto | Índices, paginación, caché |
| Compatibilidad PDF | Baja | Medio | Tests en múltiples navegadores |
| Validación de datos médicos | Media | Alto | Validación en backend y frontend |

---

**Fin del Plan de Implementación**
