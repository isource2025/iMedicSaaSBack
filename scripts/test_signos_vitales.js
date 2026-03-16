const signosVitalesService = require('../src/services/signosVitales.service');

/**
 * Script de prueba para el servicio de Signos Vitales
 */
async function testSignosVitales() {
  try {
    console.log('=== TEST: Servicio de Signos Vitales ===\n');
    
    // Datos de prueba
    const datosPrueba = {
      NumeroVisita: 46898, // Usar una visita existente
      IdHCIngreso: null, // null para crear nueva HC
      OperadorCarga: 1067,
      Profesional: 1067,
      IdSector: 'CM1',
      medibles: {
        fc: 80,
        fr: 18,
        temperatura: 36.5,
        presionMax: 120,
        presionMin: 80,
        presionMedia: 93,
        saturacion: 98,
        glucemia: 95,
        observaciones: 'Paciente estable - TEST'
      },
      antropometricos: {
        talla: 170,
        pesoActual: 70,
        pesoHabitual: 72,
        estadoNutricional: 'Normonutrido',
        perimetroAbdominal: 85,
        impresionGeneral: 'Buen estado general - TEST'
      }
    };
    
    console.log('📝 Datos de prueba:');
    console.log(JSON.stringify(datosPrueba, null, 2));
    console.log('\n');
    
    // Test 1: Crear signos vitales
    console.log('TEST 1: Crear signos vitales...');
    const resultado = await signosVitalesService.guardarSignosVitales(datosPrueba);
    console.log('✅ Resultado:', resultado);
    console.log('\n');
    
    // Test 2: Obtener signos vitales creados
    if (resultado.IdHCIngreso) {
      console.log('TEST 2: Obtener signos vitales...');
      const signosVitales = await signosVitalesService.obtenerSignosVitales(resultado.IdHCIngreso);
      console.log('✅ Signos vitales obtenidos:');
      console.log('  HC:', signosVitales.hc ? 'OK' : 'NO ENCONTRADA');
      console.log('  Control:', signosVitales.control ? 'OK' : 'NO ENCONTRADO');
      console.log('  Medibles:', signosVitales.medibles);
      console.log('  Antropométricos:', signosVitales.antropometricos);
      console.log('\n');
      
      // Test 3: Actualizar signos vitales
      console.log('TEST 3: Actualizar signos vitales...');
      const datosActualizacion = {
        ...datosPrueba,
        IdHCIngreso: resultado.IdHCIngreso,
        medibles: {
          ...datosPrueba.medibles,
          fc: 85, // Cambiar FC
          temperatura: 37.0, // Cambiar temperatura
          observaciones: 'Paciente estable - ACTUALIZADO'
        }
      };
      
      const resultadoActualizacion = await signosVitalesService.guardarSignosVitales(datosActualizacion);
      console.log('✅ Resultado actualización:', resultadoActualizacion);
      console.log('\n');
      
      // Test 4: Verificar actualización
      console.log('TEST 4: Verificar actualización...');
      const signosVitalesActualizados = await signosVitalesService.obtenerSignosVitales(resultado.IdHCIngreso);
      console.log('✅ Medibles actualizados:', signosVitalesActualizados.medibles);
      console.log('\n');
    }
    
    console.log('=== TODOS LOS TESTS COMPLETADOS ===');
    
  } catch (error) {
    console.error('❌ Error en tests:', error);
    console.error(error.stack);
  }
  
  process.exit(0);
}

testSignosVitales();
