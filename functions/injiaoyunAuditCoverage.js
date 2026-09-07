'use strict';

function assertAuditCoverage(run, dates) {
  if (!dates.length || dates[0] !== run.startDate || dates.at(-1) !== run.endDate) {
    throw new Error('舊日表完整性檢查未通過：核對日期範圍不完整。');
  }
  const missing = dates.filter((date) => run.daily?.[date]?.displayedDateMatched !== true);
  if (missing.length) {
    throw new Error(`舊日表完整性檢查未通過：以下日期未成功定位，停止覆蓋：${missing.join('、')}`);
  }
  if (Number(run.daySnapshotCount) !== dates.length) {
    throw new Error('舊日表完整性檢查未通過：每日畫面筆數與日期範圍不符。');
  }
  if (Number(run.pageRawRecordCount) >= 5000) {
    throw new Error('舊日表完整性檢查未通過：來源回應達到擷取上限，請縮小日期範圍。');
  }
}

module.exports = { assertAuditCoverage };
