const express = require('express');
const router = express.Router();

// Datos de ejemplo para las camas
const beds = [
  { id: 1, roomNumber: '101-A', type: 'Individual', status: 'available' },
  { id: 2, roomNumber: '101-B', type: 'Individual', status: 'occupied', patient: 'Juan Pérez', admissionDate: '10/04/2025', expectedDischargeDate: '15/04/2025' },
  { id: 3, roomNumber: '102-A', type: 'Individual', status: 'available' },
  { id: 4, roomNumber: '102-B', type: 'Individual', status: 'maintenance' },
  { id: 5, roomNumber: '103-A', type: 'Doble', status: 'occupied', patient: 'María López', admissionDate: '08/04/2025', expectedDischargeDate: '18/04/2025' },
  { id: 6, roomNumber: '103-B', type: 'Doble', status: 'available' },
  { id: 7, roomNumber: '104-A', type: 'UCI', status: 'occupied', patient: 'Carlos Ruiz', admissionDate: '11/04/2025', expectedDischargeDate: '20/04/2025' },
  { id: 8, roomNumber: '104-B', type: 'UCI', status: 'available' },
  { id: 9, roomNumber: '105-A', type: 'Individual', status: 'occupied', patient: 'Ana García', admissionDate: '09/04/2025', expectedDischargeDate: '14/04/2025' },
  { id: 10, roomNumber: '105-B', type: 'Individual', status: 'available' },
];

// Obtener todas las camas
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: beds
  });
});

// Obtener una cama por ID
router.get('/:id', (req, res) => {
  const bed = beds.find(b => b.id === parseInt(req.params.id));
  
  if (!bed) {
    return res.status(404).json({
      success: false,
      message: 'Cama no encontrada'
    });
  }
  
  res.json({
    success: true,
    data: bed
  });
});

// Actualizar el estado de una cama
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  const id = parseInt(req.params.id);
  
  if (!['available', 'occupied', 'maintenance'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Estado no válido'
    });
  }
  
  const bedIndex = beds.findIndex(b => b.id === id);
  
  if (bedIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Cama no encontrada'
    });
  }
  
  // Actualizar el estado
  beds[bedIndex].status = status;
  
  // Si el estado es "available", eliminar los datos del paciente
  if (status === 'available') {
    delete beds[bedIndex].patient;
    delete beds[bedIndex].admissionDate;
    delete beds[bedIndex].expectedDischargeDate;
  }
  
  res.json({
    success: true,
    data: beds[bedIndex]
  });
});

module.exports = router;
