export const createSchema = (db) => {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    candidate_count INTEGER NOT NULL DEFAULT 0,
    publish_date TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position TEXT NOT NULL,
    education TEXT NOT NULL,
    school TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('screening', 'first_interview', 'second_interview', 'offer', 'rejected')),
    owner TEXT NOT NULL,
    skills TEXT NOT NULL DEFAULT '',
    experience TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    applied_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    candidate_name TEXT NOT NULL,
    position TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    interviewer TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
  CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position);
  CREATE INDEX IF NOT EXISTS idx_interviews_candidate_id ON interviews(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_interviews_date ON interviews(date);
`)
}
