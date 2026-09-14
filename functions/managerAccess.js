'use strict';

const { findAccount, accountStatus, isManager } = require('./employeeAuth');

function createManagerAccess(auth, db) {
  return async function requireManager(req) {
    const authorization = String(req.headers && req.headers.authorization || '');
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) throw accessError(401, '請先登入管理者帳號。');
    let claims;
    try { claims = await auth.verifyIdToken(match[1], true); }
    catch (_) { throw accessError(401, '登入已失效，請重新登入。'); }
    if (claims.employee !== true || claims.manager !== true) throw accessError(403, '此功能需要管理者權限。');
    const account = await findAccount(db, String(claims.email || '').trim().toLowerCase());
    if (!account || !['active','enabled','啟用','是'].includes(accountStatus(account.data)) || !isManager(account.data, account.collection)) {
      throw accessError(403, '管理者帳號目前未啟用。');
    }
    return claims;
  };
}
function accessError(status, message) { const error = new Error(message); error.httpStatus = status; return error; }
module.exports = { createManagerAccess };
