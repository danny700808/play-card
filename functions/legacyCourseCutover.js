'use strict';

// Owner approved permanent cutover on 2026-09-13. Imported baseline records
// remain readable; no legacy job may import or overwrite new-system records.
const LEGACY_SYNC_DISABLED = true;
function assertLegacySyncAllowed() {
  if (LEGACY_SYNC_DISABLED) {
    const error = new Error('已正式切換新系統，舊音教雲同步已停用。');
    error.code = 'failed-precondition';
    throw error;
  }
}
module.exports = { LEGACY_SYNC_DISABLED, assertLegacySyncAllowed };
