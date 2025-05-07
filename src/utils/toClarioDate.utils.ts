function toClarionDate(fechaISO) {
  if (!fechaISO) return null;
  const baseDate = new Date(1800, 11, 28); // Mes 11 = diciembre
  const inputDate = new Date(fechaISO);
  const diffTime = inputDate - baseDate;
  const clarionDate = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return clarionDate;
}

// Convierte "HH:mm" a entero tipo Clarion (ej: "08:30" -> 830)
function toClarionTime(horaStr) {
  if (!horaStr) return null;
  const [horas, minutos] = horaStr.split(':').map(Number);
  if (isNaN(horas) || isNaN(minutos)) return null;
  return horas * 100 + minutos;
}

module.exports = {
  toClarionDate,
  toClarionTime,
};