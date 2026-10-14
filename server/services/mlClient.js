const ApiError = require('../utils/ApiError');

const ML_URL = process.env.ML_URL || 'http://localhost:8000';

/**
 * POST to the Python ML service.
 *
 * The service is optional at runtime: screens read saved results from Mongo,
 * so only the "Run" buttons need it. When it is down the caller gets a clear
 * 503 saying how to start it, rather than a raw connection error.
 */
async function callML(path, body) {
  let response;
  try {
    response = await fetch(`${ML_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(503, 'The ML service is not running. Start it with: uvicorn main:app --port 8000');
  }
  if (!response.ok) throw new ApiError(502, `The ML service returned an error (${response.status})`);
  return response.json();
}

async function mlIsUp() {
  try {
    const r = await fetch(`${ML_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

module.exports = { callML, mlIsUp, ML_URL };
