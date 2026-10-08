const mongoose = require('mongoose');
const mongooseLeanGetters = require('mongoose-lean-getters');

/**
 * Money is stored in paise and converted to rupees by a schema getter. Plain
 * `.lean()` skips getters entirely, so every list endpoint would return 28500
 * where it meant 285 - wrong by a factor of a hundred, and invisible until it
 * reaches a screen.
 *
 * Registering this globally makes `.lean({ getters: true })` behave the way it
 * reads, on every model, including any added later.
 */
mongoose.plugin(mongooseLeanGetters);

/**
 * Connect to MongoDB with retry. The Mongo Windows service can still be
 * starting when nodemon first runs, so a single failed attempt should not
 * take the whole API down.
 */
async function connectDB(uri, { retries = 5, delayMs = 2000 } = {}) {
  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`[db] connected to ${redact(uri)}`);
      break;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[db] could not connect after ${retries} attempts:`, err.message);
        throw err;
      }
      console.warn(`[db] attempt ${attempt}/${retries} failed (${err.message}) - retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  mongoose.connection.on('error', (err) => console.error('[db] error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));

  return mongoose.connection;
}

/** Close cleanly so nodemon restarts do not leak connections. */
async function closeDB() {
  await mongoose.connection.close();
  console.log('[db] connection closed');
}

function redact(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

module.exports = { connectDB, closeDB };
