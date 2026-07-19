-- Baseline schema (migration 0000).
-- Snapshot of the schema produced by the legacy startup migrations at
-- "Migration 37" (server/storage.ts, pre-versioned-migrations). Captured by
-- booting the legacy build against an empty DB and dumping sqlite_master, so
-- a fresh install reproduces the exact production schema in one step.
-- Statements are separated by drizzle-style breakpoint marker comments.

CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  , username TEXT);
--> statement-breakpoint
CREATE TABLE audit_log_system (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
  );
--> statement-breakpoint
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_type TEXT NOT NULL,
    company_name TEXT,
    contact_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  , created_by INTEGER);
--> statement-breakpoint
CREATE TABLE invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '1',
    unit_price TEXT NOT NULL DEFAULT '0',
    amount TEXT NOT NULL DEFAULT '0',
    sort_order INTEGER NOT NULL DEFAULT 0
  , visit_number INTEGER);
--> statement-breakpoint
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    service_call_id INTEGER,
    bill_to_type TEXT NOT NULL DEFAULT 'contractor',
    bill_to_name TEXT NOT NULL,
    bill_to_address TEXT,
    bill_to_city TEXT,
    bill_to_state TEXT,
    bill_to_email TEXT,
    bill_to_phone TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    payment_terms TEXT DEFAULT 'Net 30',
    status TEXT NOT NULL DEFAULT 'Draft',
    notes TEXT,
    subtotal TEXT NOT NULL DEFAULT '0',
    total TEXT NOT NULL DEFAULT '0',
    paid_date TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
--> statement-breakpoint
CREATE TABLE login_attempts (
        ip TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );
--> statement-breakpoint
CREATE TABLE parts_used (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    part_number TEXT NOT NULL,
    part_description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    source TEXT
  , unit_cost TEXT);
--> statement-breakpoint
CREATE TABLE photo_label_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL
  );
--> statement-breakpoint
CREATE TABLE photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    photo_url TEXT NOT NULL,
    caption TEXT,
    photo_type TEXT NOT NULL DEFAULT 'Other'
  , sort_order INTEGER NOT NULL DEFAULT 0, visit_number INTEGER NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE scheduled_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT,
      created_by_id INTEGER REFERENCES users(id),
      created_by_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
--> statement-breakpoint
CREATE TABLE service_call_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      product_index INTEGER NOT NULL DEFAULT 1,
      manufacturer TEXT NOT NULL,
      manufacturer_other TEXT,
      product_model TEXT,
      product_serial TEXT,
      product_type TEXT,
      installation_date TEXT,
      issue_description TEXT,
      diagnosis TEXT,
      resolution TEXT,
      claim_status TEXT NOT NULL DEFAULT 'Not Filed',
      claim_number TEXT,
      claim_notes TEXT,
      parts_cost TEXT,
      labor_cost TEXT,
      other_cost TEXT,
      claim_amount TEXT,
      discovered_visit_number INTEGER NOT NULL DEFAULT 1,
      voided INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
--> statement-breakpoint
CREATE TABLE service_call_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      visit_number INTEGER NOT NULL,
      visit_date TEXT NOT NULL,
      technician_id INTEGER REFERENCES users(id),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'Scheduled',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    , hours_on_job TEXT, miles_traveled TEXT);
--> statement-breakpoint
CREATE TABLE service_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_date TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    manufacturer_other TEXT,
    customer_name TEXT,
    job_site_name TEXT,
    job_site_address TEXT,
    job_site_city TEXT,
    job_site_state TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    site_contact_name TEXT,
    site_contact_phone TEXT,
    site_contact_email TEXT,
    product_model TEXT,
    product_serial TEXT,
    installation_date TEXT,
    issue_description TEXT,
    diagnosis TEXT,
    resolution TEXT,
    status TEXT NOT NULL DEFAULT 'Scheduled',
    claim_status TEXT NOT NULL DEFAULT 'Not Filed',
    claim_notes TEXT,
    tech_notes TEXT,
    latitude TEXT,
    longitude TEXT,
    created_at TEXT NOT NULL
  , hours_on_job TEXT, miles_traveled TEXT, scheduled_date TEXT, scheduled_time TEXT, parent_call_id INTEGER, product_type TEXT, parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT, claim_number TEXT, follow_up_date TEXT, created_by INTEGER, updated_by INTEGER, wholesaler_name TEXT, wholesaler_phone TEXT, job_site_zip TEXT, call_type TEXT DEFAULT 'residential', contact_company TEXT, is_test INTEGER DEFAULT 0, service_method TEXT DEFAULT 'In-Person', updated_at TEXT, completed_date TEXT, flagged_internal INTEGER NOT NULL DEFAULT 0, flagged_reason TEXT, installation_review_notes TEXT, coords_locked INTEGER DEFAULT 0, assigned_technician_id INTEGER);
--> statement-breakpoint
CREATE TABLE sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        ip TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
--> statement-breakpoint
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'tech',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
--> statement-breakpoint
CREATE INDEX idx_activity_log_service_call_id ON activity_log(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_entity ON audit_log_system(entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_system_created_at ON audit_log_system(created_at);
--> statement-breakpoint
CREATE INDEX idx_audit_log_system_user_id ON audit_log_system(user_id);
--> statement-breakpoint
CREATE INDEX idx_contacts_type ON contacts(contact_type);
--> statement-breakpoint
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
--> statement-breakpoint
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
--> statement-breakpoint
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);
--> statement-breakpoint
CREATE INDEX idx_invoices_service_call_id ON invoices(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_invoices_status ON invoices(status);
--> statement-breakpoint
CREATE INDEX idx_parts_service_call_id ON parts_used(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_photo_label_presets_label ON photo_label_presets(label);
--> statement-breakpoint
CREATE INDEX idx_photos_service_call_id ON photos(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_sched_appts_call ON scheduled_appointments(call_id);
--> statement-breakpoint
CREATE INDEX idx_scp_call_id ON service_call_products(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_service_call_visits_call_id ON service_call_visits(service_call_id);
--> statement-breakpoint
CREATE INDEX idx_service_calls_call_date ON service_calls(call_date);
--> statement-breakpoint
CREATE INDEX idx_service_calls_completed_date ON service_calls(completed_date);
--> statement-breakpoint
CREATE INDEX idx_service_calls_created_by ON service_calls(created_by);
--> statement-breakpoint
CREATE INDEX idx_service_calls_flagged_internal ON service_calls(flagged_internal) WHERE flagged_internal = 1;
--> statement-breakpoint
CREATE INDEX idx_service_calls_parent_call_id ON service_calls(parent_call_id);
--> statement-breakpoint
CREATE INDEX idx_service_calls_scheduled_date ON service_calls(scheduled_date);
--> statement-breakpoint
CREATE INDEX idx_service_calls_status ON service_calls(status);
--> statement-breakpoint
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
--> statement-breakpoint
CREATE INDEX idx_users_username ON users(username);
--> statement-breakpoint
CREATE INDEX idx_visits_visit_date ON service_call_visits(visit_date);
