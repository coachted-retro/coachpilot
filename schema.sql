-- CoachPilot Database Schema
-- Run this in Cloudflare D1 console

CREATE TABLE IF NOT EXISTS trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  magic_token TEXT,
  magic_expires INTEGER,
  session_token TEXT,
  token_expires INTEGER,
  status TEXT DEFAULT 'trial',
  trial_end INTEGER,
  plan TEXT DEFAULT 'solo',
  -- White-label brand settings
  brand_name TEXT DEFAULT 'My Coaching Brand',
  brand_tagline TEXT,
  brand_color TEXT DEFAULT '#2563eb',
  brand_secondary TEXT DEFAULT '#1e40af',
  brand_logo_url TEXT,
  brand_font TEXT DEFAULT 'Inter',
  brand_accent TEXT DEFAULT '#f59e0b',
  -- Business info
  business_name TEXT,
  website TEXT,
  bio TEXT,
  specialty TEXT,
  certifications TEXT,
  location TEXT,
  instagram TEXT,
  -- Timestamps
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  -- Basic info
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  dob TEXT,
  gender TEXT,
  photo_url TEXT,
  -- Health profile
  height TEXT,
  weight REAL,
  goal TEXT,
  conditions TEXT,
  glp1 INTEGER DEFAULT 0,
  medical_notes TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  -- Program
  start_date TEXT,
  sessions_per_week INTEGER DEFAULT 3,
  notes TEXT,
  -- Status and tracking
  status TEXT DEFAULT 'active',
  check_in_streak INTEGER DEFAULT 0,
  last_checkin INTEGER,
  is_ghost INTEGER DEFAULT 0,
  -- Timestamps
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  session_date TEXT NOT NULL,
  session_time TEXT DEFAULT '09:00',
  duration_min INTEGER DEFAULT 60,
  type TEXT DEFAULT 'training',
  notes TEXT,
  status TEXT DEFAULT 'scheduled',
  recurring INTEGER DEFAULT 0,
  recurring_freq TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  weight REAL,
  energy INTEGER,
  sleep INTEGER,
  nutrition_compliance INTEGER,
  mood INTEGER,
  notes TEXT,
  trainer_response TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL,
  description TEXT,
  weeks INTEGER DEFAULT 12,
  days_per_week INTEGER DEFAULT 3,
  goal TEXT,
  conditions TEXT,
  created_at INTEGER NOT NULL
);

-- Ghost client seed data (insert after creating trainer account)
-- INSERT INTO clients (id, trainer_id, name, email, phone, goal, weight, height,
--   start_date, status, check_in_streak, is_ghost, created_at)
-- VALUES ('ghost001', [TRAINER_ID], 'Alex Johnson', 'alex@example.com', '555-0100',
--   'Build lean muscle and improve overall fitness', 185.5, '5ft 11in',
--   date('now', '-42 days'), 'active', 12, 1, unixepoch()*1000);
