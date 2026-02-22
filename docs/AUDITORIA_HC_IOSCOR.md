# 📋 AUDITORÍA COMPLETA - HISTORIA CLÍNICA IOSCOR-APP

**Fecha de Auditoría:** 22 de Febrero, 2026  
**Proyecto Origen:** IOSCOR-APP  
**Proyecto Destino:** iMedicWs  
**Objetivo:** Implementar sistema completo de Historia Clínica con exportación a PDF

---

## 🎯 RESUMEN EJECUTIVO

IOSCOR-APP cuenta con un sistema completo y estructurado de Historia Clínica que incluye:
- ✅ **Frontend React/Next.js** con componentes modulares
- ✅ **Backend Node.js** con servicios bien definidos
- ✅ **Exportación a PDF** estructurada con jsPDF + autoTable
- ✅ **Base de datos SQL Server** con tabla `imHCI` altamente detallada
- ✅ **+300 campos médicos** organizados por sistemas corporales

---

## 📊 ESTRUCTURA DE BASE DE DATOS

### Tabla Principal: `imHCI`

**Campos Básicos:**
```sql
- IdHCIngreso (PK, INT) - ID único de la historia clínica
- NumeroVisita (INT) - Número de visita del paciente
- Fecha (DATETIME) - Fecha de la consulta
- IdSector (VARCHAR) - Sector donde se realizó la consulta
- IdProfecional (INT) - ID del profesional que atendió
- MotivoConsulta (TEXT) - Motivo de la consulta
- EnfermedadActual (TEXT) - Descripción de la enfermedad actual
- IMPRESIONDIAGNOSTICA (TEXT) - Impresión diagnóstica
- COMENTARIODEINGRESO (TEXT) - Comentarios adicionales
```

### Secciones Médicas (Prefijos de Campos)

La tabla `imHCI` utiliza un sistema de **prefijos** para organizar campos por sistemas corporales:

#### 1. **SV** - Signos Vitales (40+ campos)
```
SV_GLUCEMIA, SV_PA, SV_FC, SV_FR, SV_TAX, SV_IMPRESIONGENERAL,
SV_FACIE, SV_DECUBITO, SV_MARCHA, SV_TALLA, SV_PESOACTUAL,
SV_PESOHABITUAL, SV_ESTADONUTRICIONAL, SV_VARICES, SV_FLEBITIS,
SV_TROMBOSIS, SV_CIRCULACIONCOLATERAL, SV_TEXTO
```

#### 2. **PF** - Piel y Faneras (8 campos)
```
PF_COLORACION, PF_HUMEDAD, PF_TEMPERATURA, PF_DISTRIBUCIONPILOSA,
PF_ELASTICIDAD, PF_UNIAS, PF_CICATRICES, PF_TEXTO
```

#### 3. **TCS** - Tejido Celular Subcutáneo (6 campos)
```
TCS_DISTRIBUCION, TCS_CANTIDAD, TCS_NODULOS, TCS_ENFISEMA,
TCS_EDEMAS, TCS_TEXTO
```

#### 4. **SL** - Sistema Linfático (3 campos)
```
SL_LINFANGITIS, SL_ADENOMEGALIAS, SL_TEXTO
```

#### 5. **SOAM** - Sistema Osteoarticulomuscular (9 campos)
```
SOAM_MUSCULOTROFISMOSENSIBILIDAD, SOAM_HUESOS, SOAM_COLUMNAVERTEBRAL,
SOAM_ARTICULACIONES, SOAM_INDICETOBILLOBRAZODERECHA,
SOAM_INDICETOBILLOBRAZOIZQUIERA, SOAM_PERIMETROMID,
SOAM_PERIMETROMII, SOAM_TEXTO
```

#### 6. **C** - Cabeza (16 campos)
```
C_FORMA, C_TAMANIO, C_OJOS, C_PUPILAS, C_CONJUNTIVAS, C_CORNEAS,
C_ESCLEROTICAS, C_PARPADOS, C_FOSASNASALES, C_BOCA, C_LABIOS,
C_ENCIAS, C_FAUCES, C_LENGUA, C_DIENTES, C_GLANDULASSALIVALES,
C_PABELLONESAURICULARESYCAE, C_TEXTO
```

#### 7. **CU** - Cuello (7 campos)
```
CU_CONFORMACION, CU_LARINGE, CU_HUECOSUPRACLAVICULAR,
CU_HUECOINFRACLAVICULAR, CU_YUGULARES, CU_TIROIDES, CU_TEXTO
```

#### 8. **M/MI/MP** - Mamas (20 campos)
```
M_SIMETRIA, M_NODULOS, MI_TAMANO, MI_SUPERFICIE, MI_AREOLAS,
MI_PEZONES, MI_MANIOBRAPECTORALES, MI_PIELRETRACCION,
MI_ELEVACION, MI_DENARANJA, MI_ULCERAS, MI_TEXTO,
MP_LIMITES, MP_DOLOROSA, MP_SUPERFICIE, MP_CONSISTENCIA,
MP_TUMOR, MP_FIJACIONPIEL, MP_DERRAMEPORPEZON
```

#### 9. **AR** - Aparato Respiratorio (13 campos)
```
AR_TORAX, AR_FORMA, AR_ELASTICIDAD, AR_TIPORESPIRATORIO,
AR_EXPANSIONDEVERTICES, AR_BASES, AR_VIBRACIONESVOCALES,
AR_INSPECCION, AR_PALPACION, AR_PERCUSION, AR_AUSCULTACION,
AR_TEXTO
```

#### 10. **AC** - Aparato Cardiovascular (15 campos)
```
AC_FRECUENCIACARDIACA, AC_CENTRAL, AC_PERIFERICA, AC_PULSORADIAL,
AC_RELLENOAPILAR, AC_LATIDOAPEXIANO, AC_LATIDOPALPABLES,
AC_AUSCULTACION, AC_R1, AC_R2, AC_RUIDOSAGREGADOS, AC_FROTES,
AC_SOPLOS, AC_PALPACION, AC_PULSOS, AC_TEXTO
```

#### 11. **A** - Abdomen (17 campos)
```
A_INSPECCION, A_PALPACION, A_SUPERFICIAL, A_PROFUNDA, A_PERCUSION,
A_HIGADO, A_LIMTESUP, A_LIMTEINF, A_ALTURA, A_CARACTERISTICAS,
A_AUSCULTACION, A_RHA, A_SOPLOS, A_CELDAESPLENICA, A_BAZO,
A_PERIMETRO, A_TEXTO
```

#### 12. **AUG/AIG** - Aparato Urogenital/Intestinal (6 campos)
```
AUG_GENITALESEXTERNOS, AUG_TACTOVAGINAL, AIG_TACTORECTAL,
AUG_PUNIOPERCUSION, AUG_PUNTOSURETRALES, AUG_TEXTO
```

#### 13. **SN** - Sistema Nervioso (10 campos)
```
SN_CONCIENCIA, SN_MARCHA, SN_TONOMUSCULAR, SN_FUERZAMUSCULAR,
SN_SIGNOSPIRAMIDALES, SN_SENSIBILIDADSUPERFICIAL,
SN_SIGNOSMENINGEOS, SN_PARESCRANEANOS, SN_TAXIA, SN_PRAXIA,
SN_TEXTO
```

#### 14. **EO** - Examen Oftalmológico (35 campos)
```
EO_FONDODEOJO, EO_MEDIOSBIREFRIGENTES, EO_CRUCES, EO_RELACION,
EO_HEMORRAGIAEXUDADOS, EO_AU, EO_TONO, EO_LCF, EO_MFA, EO_DU,
EO_LEOPOLD, EO_TACTOVAGINAL, EO_BISHOP_P, EO_BISHOP_R,
EO_BISHOP_E, EO_BISHOP_L, EO_BISHOP_D, EO_MEMBRANASOVULARES,
EO_MANIOBRADETAMIER, EO_PLANO, EO_PELVIMETRIA, EO_HIDRORREA,
EO_GINECORRAGIA, EO_LOQUIOS, EO_RETRACCION, EO_MAMAS,
EO_LACTANCIA, EO_PERINE, EO_ESPECULOSCOPIA, EO_TBM,
EO_DIAGNOSTICO, EO_REFRACCION, EO_BIOMOSCROPIA, EO_TONOMETRIA,
EO_PRACTICAQUIRURGICA
```

#### 15. **EC** - Electrocardiograma (13 campos)
```
EC_RITMO, EC_FRECUENCIA, EC_PR, EC_QT, EC_ONDAP, EC_DURACION,
EC_AMPLITUD, EC_CONFORMACION, EC_QRS, EC_DURACION1, EC_ONDAT,
EC_ST, EC_EJE, EC_CONCLUSIONES
```

#### 16. **RDT** - Radiología de Tórax (14 campos)
```
RDT_DATETIME, RDT_TECNICA, RDT_PARTESBLANDAS, RDT_PARTESOSEAS,
RDT_HEMIDIAFRAGMAS, RDT_ICT, RDT_SENOSCOSTOFRENICOS,
RDT_MEDIASTINO, RDT_SILUETACARDIOVASCULAR, RDT_HILIOS,
RDT_CAMPOSPULMONARES, RDT_CONCLUSIONES, RDT_POSICION,
RDT_PARENQUIMA, RDT_LABORATORIO
```

#### 17. **PD** - Procedimientos Diagnósticos (11 campos)
```
PD_A, PD_B, PD_C, PD_D, PD_E, PD_F, PD_G, PD_H, PD_I, PD_J, PD_K
```

#### 18. **PT** - Procedimientos Terapéuticos (15 campos)
```
PT_1, PT_2, PT_3, PT_4, PT_5, PT_6, PT_7, PT_8, PT_9, PT_10,
PT_11, PT_12, PT_13, PT_14, PT_15
```

#### 19. **AD** - Aparato Digestivo (4 campos)
```
AD_INSPECCION, AD_PALPACION, AD_PERCUSION, AD_AUSCULTACION
```

#### 20. **EN** - Examen Neurológico (3 campos)
```
EN_GLASGOW, EN_SENCIVILIDAD, EN_MOTRICIDAD
```

#### 21. **EG** - Examen Ginecológico (12 campos)
```
EG_MONTEDEVENUS, EG_LABIOSMAYORESMENORES, EG_CLITORIS,
EG_INTROITO, EG_VAGINA, EG_FONDOSACOVAGINAL, EG_CERVIX,
EG_UTERO, EG_ANEXOS, EG_EXAMENAB_VA_RE, EG_ESPECULOSCOPIA,
EG_TEXTO
```

#### 22. **DIA** - Diabetes (7 campos)
```
DIA_DETERMINACION, DIA_DIETA, DIA_MONITOREO, DIA_EDUCACION,
DIA_PIE, DIA_DOPLER, DIA_CURVA
```

---

## 🏗️ ARQUITECTURA FRONTEND

### Componentes Principales

#### 1. `HistoriaClinicaDetalle.tsx`
**Ubicación:** `src/components/HistoriaClinicaDetalle.tsx`

**Responsabilidades:**
- Mostrar detalle completo de una historia clínica
- Agrupar campos por secciones usando prefijos
- Formatear datos para visualización
- Integrar botón de descarga PDF

**Características Clave:**
```typescript
// Configuración de secciones
const SECCIONES_CONFIG = {
  'SV': 'Signos Vitales',
  'PF': 'Piel y Faneras',
  'TCS': 'Tejido Celular Subcutáneo',
  // ... 22 secciones en total
};

// Agrupación automática de campos
const getSecciones = () => {
  // Itera sobre todos los campos
  // Extrae prefijo (antes del _)
  // Agrupa por sección
  // Filtra campos vacíos
};
```

**Props:**
- `numeroVisita`: Número de visita de la HC
- `nombreMedico`: Nombre del médico (opcional)
- `datosCompletos`: Objeto completo de HC con médico y sector
- `onClose`: Callback para cerrar modal

#### 2. Estilos: `HistoriaClinicaDetalle.module.css`
**Ubicación:** `src/styles/HistoriaClinicaDetalle.module.css`

**Características:**
- Modal fullscreen con overlay
- Header con información básica
- Cuadro de texto continuo para secciones
- Sectorizadores visuales
- Diseño responsive

---

## 🔧 ARQUITECTURA BACKEND

### Servicios

#### 1. `hciService.js`
**Ubicación:** `src/services/hciService.js`

**Métodos Principales:**

```javascript
// Obtener todas las HC
async getAll()

// Obtener HC por ID
async getById(id)

// Obtener HC por DNI del paciente
async getByDni(dni)

// Obtener HC por ID de paciente
async getByIdPaciente(idPaciente)

// Obtener HC de toda la familia
async getHistoriaClinicaFamilia(idPaciente)

// Obtener HC por número de visita
async getByNumeroVisita(numeroVisita)

// Obtener información del médico
async getMedicoByIdProfecional(idProfecional)
```

**Consultas SQL Clave:**
```sql
-- HC por ID de paciente
SELECT h.*, v.NUMEROVISITA as NumeroVisitaCompleto
FROM imVisita v
INNER JOIN imHCI h ON v.NUMEROVISITA = h.NumeroVisita
WHERE v.IdPaciente = @idPaciente
ORDER BY h.Fecha DESC

-- HC familiar (titular + beneficiarios)
SELECT 
  h.*,
  v.NUMEROVISITA as NumeroVisitaCompleto,
  p.NumeroDocumento as dniPaciente,
  p.ApellidoyNombre as nombrePaciente
FROM imVisita v
INNER JOIN imHCI h ON v.NUMEROVISITA = h.NumeroVisita
INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
WHERE p.NumeroDocumento IN (@DNI0, @DNI1, ...)
ORDER BY h.Fecha DESC
```

#### 2. `hciController.js`
**Ubicación:** `src/controllers/hciController.js`

**Endpoints:**
- `GET /api/hci` - Listar todas las HC
- `GET /api/hci/:id` - Obtener HC por ID
- `GET /api/hci/paciente/:idPaciente` - HC por ID paciente
- `GET /api/hci/familia/:idPaciente` - HC familiar
- `GET /api/hci/visita/:numeroVisita` - HC por número de visita
- `GET /api/hci/medico/:idProfecional` - Info del médico

---

## 📄 EXPORTACIÓN A PDF

### Utilidad: `pdfUtils.ts`
**Ubicación:** `src/utils/pdfUtils.ts`

**Librería:** jsPDF + jspdf-autotable

**Función Principal:**
```typescript
async function generarPdfHistoriaClinica(
  item: HCIItemWithMedicoAndSector,
  opciones?: { nombreArchivo?: string }
)
```

**Características del PDF:**

1. **Header Profesional:**
   - Título: "Historia Clínica - Detalle de Consulta"
   - Metadata: Fecha, Sector, Médico
   - Línea decorativa azul

2. **Información Básica (Tabla):**
   - Fecha de consulta
   - Número de visita
   - Sector
   - Médico
   - Motivo de consulta
   - Enfermedad actual
   - Impresión diagnóstica
   - Comentarios

3. **Secciones Dinámicas:**
   - Una tabla por cada sección con datos
   - Header azul con nombre de sección
   - Campos formateados: "Campo: Valor"
   - Solo muestra secciones con datos

4. **Footer:**
   - Numeración de páginas
   - "Página X de Y"

5. **Estilos:**
   - Color primario: #0369b8
   - Fuente: Helvetica
   - Tema: Grid
   - Márgenes: 40pt

**Proceso de Generación:**
```typescript
// 1. Importación dinámica (evita SSR issues)
const { jsPDF } = await import('jspdf');
const { default: autoTable } = await import('jspdf-autotable');

// 2. Crear documento
const doc = new jsPDF({ unit: 'pt', format: 'a4' });

// 3. Dibujar header

// 4. Generar tabla de información básica
autoTable(doc, { ... });

// 5. Generar tablas de secciones dinámicas
for (const [prefijo, campos] of Object.entries(secciones)) {
  autoTable(doc, { ... });
}

// 6. Guardar PDF
doc.save(nombreArchivo);
```

---

## 🔄 FLUJO DE DATOS

### Frontend → Backend → Base de Datos

```
1. Usuario selecciona HC en lista
   ↓
2. Frontend llama a getHistoriaClinicaConMedicoYSector(idPaciente)
   ↓
3. Backend ejecuta query en imHCI + imVisita + imPacientes
   ↓
4. Backend enriquece con datos de médico (imPassword)
   ↓
5. Backend enriquece con datos de sector (imSectores)
   ↓
6. Frontend recibe HCIItemWithMedicoAndSector[]
   ↓
7. Usuario hace clic en "Ver Detalle"
   ↓
8. Se abre HistoriaClinicaDetalle con datos completos
   ↓
9. Componente agrupa campos por secciones
   ↓
10. Usuario puede descargar PDF
    ↓
11. generarPdfHistoriaClinica() crea PDF estructurado
```

---

## 📝 INTERFACES TYPESCRIPT

### HCIItem (Básica)
```typescript
export interface HCIItem {
  IdHCIngreso: number;
  NumeroVisita: number;
  Fecha: string;
  IdSector: string;
  IdProfecional: number;
  MotivoConsulta: string;
  EnfermedadActual: string;
  IMPRESIONDIAGNOSTICA: string;
  COMENTARIODEINGRESO: string;
  
  // +300 campos opcionales organizados por prefijos
  SV_GLUCEMIA?: string;
  SV_PA?: string;
  // ... todos los campos médicos
}
```

### HCIItemWithMedicoAndSector (Extendida)
```typescript
export interface HCIItemWithMedicoAndSector extends HCIItem {
  medicoInfo?: Medico;
  sectorInfo?: Sector;
}

interface Medico {
  Valor: number;
  Matricula: number;
  ApellidoNombre: string;
  ValorEspecialidad: number;
  Id: number;
}

interface Sector {
  Valor: string;
  Descripcion: string;
}
```

---

## 🎨 DISEÑO UX/UI

### Características Visuales

1. **Modal Fullscreen:**
   - Overlay oscuro semitransparente
   - Contenido centrado con scroll
   - Botón de cierre (X) en header
   - Botón de descarga PDF (icono)

2. **Header Informativo:**
   - Grid de 4 columnas
   - Fecha, Número de Visita, Sector, Médico
   - Fondo claro con bordes

3. **Cuadro de Texto Continuo:**
   - Sectorizadores como títulos
   - Campos en formato "Etiqueta: Valor"
   - Espaciado vertical entre secciones
   - Fondo blanco con bordes sutiles

4. **Estados:**
   - Loading: Spinner + mensaje
   - Error: Mensaje de error + botón cerrar
   - Sin datos: Mensaje informativo
   - Con datos: Visualización completa

---

## ✅ VENTAJAS DEL SISTEMA IOSCOR

1. **Altamente Estructurado:**
   - Sistema de prefijos claro
   - Fácil de extender con nuevas secciones
   - Agrupación automática de campos

2. **Completo:**
   - Cubre todos los sistemas corporales
   - +300 campos médicos disponibles
   - Flexible para diferentes especialidades

3. **Exportación Profesional:**
   - PDF bien formateado
   - Estructura clara y legible
   - Paginación automática

4. **Escalable:**
   - Fácil agregar nuevos campos
   - Sistema de prefijos extensible
   - Queries optimizadas

5. **Integrado:**
   - Conecta con visitas
   - Incluye datos de médico y sector
   - Soporte para historia familiar

---

## 🚀 PLAN DE IMPLEMENTACIÓN EN iMedicWs

### Fase 1: Preparación de Base de Datos
- [ ] Crear tabla `imHCI` con todos los campos
- [ ] Crear índices necesarios
- [ ] Migrar datos existentes (si aplica)
- [ ] Crear stored procedures si es necesario

### Fase 2: Backend
- [ ] Crear `hciService.js` en iMedicWSBack
- [ ] Crear `hciController.js`
- [ ] Crear rutas en `hciRoutes.js`
- [ ] Integrar con sistema de autenticación
- [ ] Crear tests unitarios

### Fase 3: Frontend - Servicios
- [ ] Crear `hciService.ts` en iMedicWSFront
- [ ] Definir interfaces TypeScript
- [ ] Crear funciones de formateo de datos
- [ ] Integrar con sistema de auth

### Fase 4: Frontend - Componentes
- [ ] Crear `HistoriaClinicaSection.tsx`
- [ ] Crear `HistoriaClinicaTable.tsx`
- [ ] Crear `HistoriaClinicaDetalle.tsx`
- [ ] Crear estilos module.css
- [ ] Integrar con BedDetailView

### Fase 5: Exportación PDF
- [ ] Instalar jsPDF y jspdf-autotable
- [ ] Crear `pdfUtils.ts` con generación de PDF
- [ ] Adaptar estilos al branding de iMedicWs
- [ ] Agregar logo y footer personalizado

### Fase 6: Integración
- [ ] Agregar sección HC al sidebar de BedDetail
- [ ] Conectar con calendario de fechas
- [ ] Implementar filtros y búsqueda
- [ ] Agregar botones de acción (ver, editar, PDF)

### Fase 7: Testing y Optimización
- [ ] Tests de integración
- [ ] Optimización de queries
- [ ] Validación de datos
- [ ] Performance testing

---

## 📊 MÉTRICAS Y ESTIMACIONES

**Complejidad:** Alta  
**Tiempo Estimado:** 3-4 semanas  
**Desarrolladores:** 2 (1 Backend + 1 Frontend)  
**Dependencias:** jsPDF, jspdf-autotable, react-icons

**Líneas de Código Estimadas:**
- Backend: ~800 líneas
- Frontend: ~1200 líneas
- Estilos: ~400 líneas
- Total: ~2400 líneas

---

## 🔐 CONSIDERACIONES DE SEGURIDAD

1. **Autenticación:**
   - Verificar token en todas las rutas
   - Validar permisos de usuario

2. **Autorización:**
   - Solo médicos pueden ver/editar HC
   - Pacientes solo ven su propia HC
   - Admin puede ver todas

3. **Datos Sensibles:**
   - Encriptar campos sensibles
   - Logs de acceso a HC
   - Auditoría de cambios

4. **GDPR/Privacidad:**
   - Consentimiento del paciente
   - Derecho al olvido
   - Exportación de datos

---

## 📚 DOCUMENTACIÓN ADICIONAL REQUERIDA

1. **Manual de Usuario:**
   - Cómo crear una HC
   - Cómo ver HC
   - Cómo exportar a PDF

2. **Manual Técnico:**
   - Estructura de BD
   - APIs disponibles
   - Proceso de despliegue

3. **Guía de Mantenimiento:**
   - Agregar nuevos campos
   - Modificar secciones
   - Actualizar PDF

---

**Fin de Auditoría**
