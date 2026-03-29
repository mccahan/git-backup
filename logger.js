/**
 * Simple logger with timestamps
 */

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function log(...args) {
  console.log(`[${timestamp()}]`, ...args);
}

function error(...args) {
  console.error(`[${timestamp()}]`, ...args);
}

module.exports = { log, error };
