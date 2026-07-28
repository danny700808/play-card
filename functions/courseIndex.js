'use strict';

// Keep every existing production export from index.js, then add the
// automatic read-only course mirror endpoint through a normal, explicit
// registration path. This avoids registering a function while coursePortal
// and coursePortalUtils are still inside a circular require chain.
const existingExports = require('./index');
Object.assign(exports, existingExports);

const { registerInjiaoyunEducationAutoRead } = require('./injiaoyunEducationAutoRead');
registerInjiaoyunEducationAutoRead(exports);
