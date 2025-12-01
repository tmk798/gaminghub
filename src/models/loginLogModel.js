const mongoose = require("mongoose");

const loginLogSchema = new mongoose.Schema({
  email: { type: String, required: true },
  loginAt: { type: Date, default: Date.now },
  logoutAt: { type: Date, default: null },
});

module.exports = mongoose.model("LoginLog", loginLogSchema);
