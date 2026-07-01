// Wraps an async route so any thrown/rejected error is passed to
// Express's error handler instead of crashing the process.
export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
