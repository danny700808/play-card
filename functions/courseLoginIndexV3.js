'use strict';

// Preserve every existing production Function, then override only the two
// LINE Login endpoints with the idempotent central-entry v3 implementation.
const existingExports = require('./courseIndex');
Object.assign(exports, existingExports);

const { registerCourseLoginAuthV3 } = require('./courseLoginAuthV3');
registerCourseLoginAuthV3(exports);
