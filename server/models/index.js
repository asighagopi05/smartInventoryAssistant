/** Single import point for every model, so registration order is deterministic. */
module.exports = {
  Counter: require('./Counter'),
  User: require('./User'),
  Supplier: require('./Supplier'),
  Product: require('./Product'),
  StockLog: require('./StockLog'),
  RestockRequest: require('./RestockRequest'),
  Sale: require('./Sale'),
  Customer: require('./Customer'),
  Note: require('./Note'),
  Notification: require('./Notification'),
  Issue: require('./Issue'),
  Task: require('./Task'),
  ComboCache: require('./ComboCache'),
  Prediction: require('./Prediction'),
};
