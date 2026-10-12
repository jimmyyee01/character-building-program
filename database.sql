-- =============================================================
-- Character Building Program — MySQL schema (PHP backend)
-- Import: mysql -u root -p character_db < database.sql
-- (or via phpMyAdmin), then open install.php once in the browser.
-- =============================================================
CREATE DATABASE IF NOT EXISTS character_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE character_db;

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  program_name VARCHAR(255) NOT NULL DEFAULT 'Character Building Program',
  program_logo LONGTEXT NULL,
  letter_id VARCHAR(64) NULL,
  letter_video_id VARCHAR(64) NULL,
  super_username VARCHAR(100) NOT NULL DEFAULT 'superadmin',
  super_salt VARCHAR(128) NOT NULL DEFAULT '',
  super_hash VARCHAR(255) NOT NULL DEFAULT '',
  CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS portals (
  id VARCHAR(64) PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'custom',
  schedule_mode VARCHAR(20) NOT NULL DEFAULT 'windows',
  windows_json LONGTEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  portal_id VARCHAR(64) NOT NULL,
  type VARCHAR(50) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  logo LONGTEXT NULL,
  program_logo LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (portal_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'member',
  supervisor_id VARCHAR(64) NULL,
  supervisor_code VARCHAR(20) NULL,
  username VARCHAR(100) NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  student_number VARCHAR(100) NULL,
  class_name VARCHAR(100) NULL,
  photo LONGTEXT NULL,
  salt VARCHAR(128) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  letter_feedback_at DATETIME NULL,
  letter_feedback LONGTEXT NULL,
  optional_video_seen TINYINT(1) NOT NULL DEFAULT 0,
  watched_videos_json LONGTEXT NULL,
  suspended TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (tenant_id), INDEX (role), INDEX (email), INDEX (student_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX (user_id), INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS library (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'book',
  title VARCHAR(255) NOT NULL,
  scope VARCHAR(64) NOT NULL DEFAULT 'global',
  `text` LONGTEXT NULL,
  url TEXT NULL,
  file_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (type), INDEX (scope)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS modules (
  id VARCHAR(64) PRIMARY KEY,
  `key` VARCHAR(60) NOT NULL,
  `order` INT NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  mode VARCHAR(20) NOT NULL DEFAULT 'summary',
  certificate_name VARCHAR(255) NOT NULL,
  default_books INT NOT NULL DEFAULT 3,
  letter_after_book TINYINT(1) NOT NULL DEFAULT 1,
  summary_prompts_json LONGTEXT NULL,
  completion_video_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS books (
  id VARCHAR(64) PRIMARY KEY,
  module_id VARCHAR(64) NOT NULL,
  scope VARCHAR(64) NOT NULL DEFAULT 'global',
  `order` INT NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  library_id VARCHAR(64) NULL,
  letter_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (module_id), INDEX (scope)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chapters (
  id VARCHAR(64) PRIMARY KEY,
  book_id VARCHAR(64) NOT NULL,
  scope VARCHAR(64) NOT NULL DEFAULT 'global',
  `order` INT NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NULL,
  page_start VARCHAR(20) NULL,
  page_end VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (book_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS objectives (
  id VARCHAR(64) PRIMARY KEY,
  chapter_id VARCHAR(64) NOT NULL,
  scope VARCHAR(64) NOT NULL DEFAULT 'global',
  `order` INT NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  options_json LONGTEXT NOT NULL,
  answer_index INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (chapter_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  type VARCHAR(40) NOT NULL,
  chapter_id VARCHAR(64) NULL,
  book_id VARCHAR(64) NULL,
  module_id VARCHAR(64) NULL,
  `index` INT NULL,
  `text` LONGTEXT NULL,
  answers_json LONGTEXT NULL,
  score INT NULL,
  total INT NULL,
  color VARCHAR(20) NULL,
  label VARCHAR(255) NULL,
  similarity INT NOT NULL DEFAULT 0,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id), INDEX (tenant_id), INDEX (type),
  INDEX (chapter_id), INDEX (book_id), INDEX (module_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS certificates (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'module',
  code VARCHAR(40) NOT NULL UNIQUE,
  user_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  module_id VARCHAR(64) NULL,
  title VARCHAR(255) NOT NULL,
  books_json LONGTEXT NULL,
  best_book_id VARCHAR(64) NULL,
  best_book VARCHAR(255) NULL,
  performance INT NOT NULL DEFAULT 0,
  objective_score INT NULL,
  user_name VARCHAR(255) NOT NULL,
  tenant_name VARCHAR(255) NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id), INDEX (tenant_id), INDEX (module_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS thoughts (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  `text` LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id)
) ENGINE=InnoDB;


