// src/app.js

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const session = require("express-session");

// Load .env (go up one level from src to project root)
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("./models/userModel");
const Otp = require("./models/otpModel");
const LoginLog = require("./models/loginLogModel");


const app = express();
const PORT = process.env.PORT || 3000;

// ================== VIEW ENGINE SETUP ==================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ================== MIDDLEWARE ==================
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// Make currentUser available in all EJS files
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});


// Formspree URL available in all EJS files
app.use((req, res, next) => {
  res.locals.formspreeURL = process.env.FORMSPREE_URL;
  next();
});

// Static files
app.use(express.static(path.join(__dirname, "..", "public")));

// ================== NODEMAILER SETUP ==================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// (Optional) test transporter
transporter.verify((err, success) => {
  if (err) {
    console.error("Nodemailer error:", err.message);
  } else {
    console.log("📧 Nodemailer is ready to send emails");
  }
});

// ================== MONGOOSE CONNECTION ==================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ================== LOGIN COMPULSION ==================
// 🔐 Require login for all GET pages except login + OTP routes
app.use((req, res, next) => {
  const publicRoutes = ["/login", "/send-otp"];

  if (
    !req.session.user &&
    !publicRoutes.includes(req.path) &&
    req.method === "GET"
  ) {
    return res.redirect("/login");
  }

  next();
});

// 🔐 Admin check middleware (for dashboard)
function isAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect("/admin-login");
  }
  next();
}

// ================== ROUTES ==================

// Home page
app.get("/", (req, res) => {
  res.render("home"); // currentUser available automatically
});

// Login page
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login");
});

// Send OTP (Email)
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.send("Email is required.");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  try {
    // save or update OTP in DB
    await Otp.findOneAndUpdate(
      { email },
      { email, otp, expiresAt },
      { upsert: true, new: true }
    );

    await transporter.sendMail({
      from: `Gaming Hub <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Your Gaming Hub OTP",
      text: `Your OTP is: ${otp}\nValid for 5 minutes.`,
    });

    res.redirect("/login");
  } catch (err) {
    console.error("Error sending OTP:", err);
    res.redirect("/login");
  }
});

// Verify OTP and login
app.post("/login", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) return res.send("Email and OTP are required.");

  try {
    const record = await Otp.findOne({ email });

    if (!record) {
      return res.send("No OTP found. Please request a new OTP.");
    }

    if (record.expiresAt < new Date()) {
      await Otp.deleteOne({ email });
      return res.send("OTP expired. Please request a new OTP.");
    }

    if (record.otp !== otp) {
      return res.send("Incorrect OTP.");
    }

    // OTP correct → delete from DB
    await Otp.deleteOne({ email });

    // find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email });
    }

    // save in session
    req.session.user = { id: user._id, email: user.email };

// create login log
const log = await LoginLog.create({
  email: user.email,
  loginAt: new Date(),
});

// remember which log belongs to this session
req.session.loginLogId = log._id;

res.redirect("/");

    
  } catch (err) {
    console.error("Login error:", err);
    res.send("Error while verifying OTP.");
  }
});

// Logout
app.post("/logout", async (req, res) => {
  try {
    if (req.session.loginLogId) {
      await LoginLog.findByIdAndUpdate(req.session.loginLogId, {
        logoutAt: new Date(),
      });
    }
  } catch (e) {
    console.error("Error updating logout time:", e);
  }

  req.session.destroy(() => {
    res.redirect("/");
  });
});


// ================== ADMIN AUTH ==================

// GET: Show admin login page (user must already be logged in by OTP)
app.get("/admin-login", (req, res) => {
  // If not logged in, login compulsion middleware will redirect to /login
  res.render("adminLogin", { error: null });
});

// POST: Verify admin password
app.post("/admin-login", (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.render("adminLogin", { error: "Password is required" });
  }

  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true; // ✅ Admin session activated
    return res.redirect("/dashboard");
  }

  res.render("adminLogin", { error: "Incorrect password" });
});

// GET: Admin Dashboard (Protected)
app.get("/dashboard", isAdmin, async (req, res) => {
  try {
    const logs = await LoginLog.find().sort({ loginAt: -1 }).lean();
    res.render("dashboard", { logs });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).send("Error loading dashboard");
  }
});


// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
