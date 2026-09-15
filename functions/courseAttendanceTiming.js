'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const {performance} = require('node:perf_hooks');
const {randomUUID} = require('node:crypto');
const logger = require('firebase-functions/logger');

function createAttendanceTiming({now = () => performance.now(), log = row => logger.info('admin-attendance-timing', row)} = {}) {
  const context = new AsyncLocalStorage();
  let firstRequest = true;
  async function timeAttendanceStage(stage, work) {
    const current = context.getStore();
    if (!current) return work();
    const started = now();
    try { return await work(); }
    finally { current.stages.push({stage, ms: Math.round(now() - started)}); }
  }
  function withAttendanceTiming(handler, region) {
    return async (data, request) => {
      const record = {requestId: randomUUID(), region, action: data.action === 'refresh' ? 'refresh' : 'save', firstRequestInInstance: firstRequest, stages: []};
      firstRequest = false;
      const started = now();
      return context.run(record, async () => {
        try { const result = await handler(data, request); record.outcome = 'ok'; return result; }
        catch (error) {
          record.outcome = 'error';
          const codes = ['unauthenticated','permission-denied','invalid-argument','not-found','failed-precondition','already-exists','aborted','unavailable','deadline-exceeded','internal'];
          record.errorCode = codes.includes(error && error.code) ? error.code : 'unknown';
          throw error;
        } finally {
          record.totalMs = Math.round(now() - started);
          record.overThreeSeconds = record.totalMs > 3000;
          // Diagnostics must never change a successfully committed operation.
          try { log(record); } catch (_) {}
        }
      });
    };
  }
  return {timeAttendanceStage, withAttendanceTiming};
}
module.exports = {...createAttendanceTiming(), createAttendanceTiming};
