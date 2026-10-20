'use strict';

// A count of consumed lessons is not a slot number: legacy leave records can
// leave slot 1 unused while slot 2 is attended. Only relax the count fallback
// when every consumed unit can be accounted for by explicit slot evidence.
function slotHasAttendance({periodId, slotNo, usedCount, rows, allocations, units, status}) {
  const occupied = new Set();
  let mappedUnits = 0;
  let unknown = false;
  for (const row of rows) {
    if (row.active === false || row.deducted === false ||
        !['attended', 'absent'].includes(status(row.status))) continue;
    const parts = allocations(row);
    for (const part of parts) {
      if (part.periodId !== periodId) continue;
      const slot = Number(row.slotNo || row.lessonNo);
      const count = Number(part.lessonUnits || units(row));
      // Multi-period allocations do not reliably carry per-period slot numbers.
      if (parts.length !== 1 || !Number.isInteger(slot) || slot < 1 ||
          !Number.isFinite(count) || count <= 0 || count > 1) {
        unknown = true;
        continue;
      }
      occupied.add(slot);
      mappedUnits += count;
    }
  }
  if (occupied.has(slotNo)) return true;
  if (!unknown && Math.abs(mappedUnits - Number(usedCount || 0)) < 0.000001) return false;
  return slotNo <= Math.ceil(Number(usedCount || 0));
}

module.exports = {slotHasAttendance};
