// Seed logic, extracted out of storage.ts (server H5).
//
// Two distinct concerns, kept separate on purpose:
//
//  - seedAdmin(): the S6 credential-hardening behavior. Must run on a fresh/empty
//    DB so a brand-new deploy has a login. It is idempotent (guarded on an empty
//    users table) and is invoked at startup from storage.ts. Never bakes a
//    well-known password into the app; a supplied SEED_ADMIN_PASSWORD (>= 8
//    chars) is used, otherwise a crypto-random password is generated and NEVER
//    logged, and the account is flagged must_change_password.
//
//  - seedInitialData(): the initial CRM contacts (the Fitzpatrick customer list
//    and the TEST CUSTOMER row). This is demo/initial data, not schema, so it is
//    NOT run on every boot; invoke it explicitly via `npm run seed`
//    (script/seed.ts). Each insert is guarded so re-running is a no-op.
//
// Neither function rewrites existing rows — both only insert when the target is
// absent, so running against the populated production DB does nothing.

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type DatabaseType from "better-sqlite3";

type DB = DatabaseType.Database;

export function seedAdmin(sqlite: DB, log: (m: string) => void = console.log): void {
  const userCount = (sqlite.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;
  if (userCount !== 0) return;

  const envPw = process.env.SEED_ADMIN_PASSWORD?.trim();
  const useEnvPw = !!envPw && envPw.length >= 8;
  const seedPw = useEnvPw ? (envPw as string) : randomBytes(24).toString("base64url");
  const hashedPw = bcrypt.hashSync(seedPw, 12);
  sqlite
    .prepare(
      `INSERT INTO users (username, password, display_name, email, role, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("admin", hashedPw, "Kevin Fitzpatrick", "kevin@fitzpatricksales.com", "manager", 1, 1, new Date().toISOString());
  if (useEnvPw) {
    log("Seed: created default admin user 'admin' from SEED_ADMIN_PASSWORD (must change at first login).");
  } else {
    if (envPw) {
      log("Seed: SEED_ADMIN_PASSWORD was set but under 8 chars — ignored; used a random password instead.");
    }
    log(
      "Seed: created default admin user 'admin' with a random password (not logged). " +
        "Set a known password with scripts/reset-password.mjs from the Render Shell, " +
        "or provide SEED_ADMIN_PASSWORD before first boot.",
    );
  }
}

export function seedInitialData(sqlite: DB, log: (m: string) => void = console.log): void {
  // Fitzpatrick Sales customer list (40 contacts). Guarded on a sentinel row.
  const existingCount =
    (sqlite.prepare(`SELECT COUNT(*) as c FROM contacts WHERE company_name = 'Allreds Inc.'`).get() as any)?.c || 0;
  if (existingCount === 0) {
    log("Seed: importing 40 contacts from Fitzpatrick Sales customer list...");
    const stmt = sqlite.prepare(
      `INSERT INTO contacts (contact_type, company_name, contact_name, phone, email, address, city, state, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    stmt.run("wholesaler", "Allreds Inc.", "Allreds Inc.", "801-561-8300", null, "631 West Commerce Park Drive Midvale UT 84047", "Midvale", "UT", "Fax: 801-561-8383; ZIP: 84047");
    stmt.run("contractor", "All States Mechanical", "All States Mechanical", null, null, null, null, null, null);
    stmt.run("wholesaler", "Alpine Supply Company", "Alpine Supply Company", "(801) 768-8411", "aleda.gardner@alpinesc.com", "782 West State Street Lehi UT 84043 USA", "Lehi", "UT", "ZIP: 84043");
    stmt.run("wholesaler", "Appliance Parts Company", "Appliance Parts Company", null, "darcy@appliancepartscompany.com", "6825 South Kyrene Rd 102 Tempe AZ 85283", "Tempe", "AZ", "ZIP: 85283");
    stmt.run("wholesaler", "Applied Industrial Technologies, Inc.", "Applied Industrial Technologies, Inc.", null, "rgull@applied.com", "Applied Industrial Technologies, Inc. PO Box 93018 Cleveland Ohio 44101-5018", "Cleveland", "Ohio", "ZIP: 44101-5018");
    stmt.run("wholesaler", "BJ Plumbing", "BJ Plumbing", "(801) 224-6600", "ap@bjplumbingsupply.com", "968 North 1200 West Orem UT 84057", "Orem", "UT", "Fax: (801) 224-6242; ZIP: 84057");
    stmt.run("contractor", "Bowles Plumbing Inc.", "Bowles Plumbing Inc.", "(801) 699-2789", null, "14273 South Fort Pierce Way Herriman UT 84096", "Herriman", "UT", "ZIP: 84096");
    stmt.run("contractor", "Buss Mechanical Services, Inc.", "Buss Mechanical Services, Inc.", "(208) 562-0600", "marggie@bussmechanical.com", "PO Box 190476 Boise ID 83719-0476 USA", "Boise", "ID", "Fax: (208) 562-0555; ZIP: 83719-0476");
    stmt.run("contractor", "CL Wayman Piping, LLC", "CL Wayman Piping, LLC", null, null, "5565 West Leo Park RoadUt. West Jordan UT 84081", "West Jordan", "UT", "ZIP: 84081");
    stmt.run("wholesaler", "Commercial Kitchen Supply", "Commercial Kitchen Supply", "(801) 292-1611", "cksinvoice@commercialkitchensupply.com", "1030 W 650 N Centerville UT 84104", "Centerville", "UT", "ZIP: 84104");
    stmt.run("wholesaler", "Consolidated Supply, Co.", "Consolidated Supply, Co.", null, "trade@consolidatedsupply.com", "Consolidated Supply, Co. P.O. Box 5788 Portland Oregon 97228", "Portland", "Oregon", "ZIP: 97228");
    stmt.run("wholesaler", "Decker Plumbing Supply", "Decker Plumbing Supply", null, "apadvantage.haj@pnc.com", "Hajoca Corporation Service Center PO Box 951 Baton Rouge, Baton Rouge LA 70821-0951", "Baton Rouge", "LA", "ZIP: 70821-0951");
    stmt.run("wholesaler", "Durk's Plumbing Supply", "Durk's Plumbing Supply", null, null, "Durk's Plumbing Supply 1592 No. Main Street Layton Utah 84041 US", "Layton", "Utah", "ZIP: 84041");
    stmt.run("wholesaler", "Falls Plumbing Supply", "Falls Plumbing Supply", null, null, "525 East Anderson Idaho Falls ID 83401", "Idaho Falls", "ID", "ZIP: 83401");
    stmt.run("wholesaler", "Ferguson Enterprises", "Ferguson Enterprises", null, "sac266.vendorinvoices@ferguson.com", "Ferguson Enterprises PO Box 9285 Hampton Virginia 23670", "Hampton", "Virginia", "ZIP: 23670");
    stmt.run("wholesaler", "Great Western Plumbing Supply, Inc.", "Great Western Plumbing Supply, Inc.", "801-621-5412", "ap@gwsupply.com", "PO Box 6151 Ogden UT 84402", "Ogden", "UT", "Fax: 801-621-5417; ZIP: 84402");
    stmt.run("wholesaler", "Hajoca Corporation", "Hajoca Corporation", null, "vendorinvoices@hajoca.com", "Hajoca Corporation PO Box 842912 Boston Massachusetts 02284-2912", "Boston", "Massachusetts", "ZIP: 02284-2912");
    stmt.run("wholesaler", "HD Supply Waterworks", "HD Supply Waterworks", null, "wwapinventory@hdsupply.com", "P.O. Box 28446 St. Louis MO 63146", "St. Louis", "MO", "ZIP: 63146");
    stmt.run("wholesaler", "Heritage Landscape Supply Group", "Heritage Landscape Supply Group", "(214) 491-4149", "heritageinvoices@heritagelsg.com", "100 Enterprise Dr. STE 204 Rockaway NJ 07866 USA", "Rockaway", "NJ", "ZIP: 07866");
    stmt.run("wholesaler", "Idaho Industrial Supply Co.", "Idaho Industrial Supply Co.", null, null, "P.O. Box 7793Idaho Boise ID 83707", "Boise", "ID", "ZIP: 83707");
    stmt.run("wholesaler", "Jerry's Plumbing Specialties", "Jerry's Plumbing Specialties", null, "randyg@jpsonline.biz", "P.O. Box 1007 Ogden UT 84402-1007", "Ogden", "UT", "ZIP: 84402-1007");
    stmt.run("wholesaler", "Johnstone Supply", "Johnstone Supply", null, null, "PO Box 3010 Portland OR 97208 USA", "Portland", "OR", "ZIP: 97208");
    stmt.run("wholesaler", "Keller Supply", "Keller Supply", null, "ap@kellersupply.com", "Main OfficeP O Box 79014 Seattle WA 98119", "Seattle", "WA", "ZIP: 98119");
    stmt.run("contractor", "Mark McBride Plumbing, Inc.", "Mark McBride Plumbing, Inc.", "801-261-4462", null, "5944 South 350 EastUt Murray UT 84107", "Murray", "UT", "ZIP: 84107");
    stmt.run("wholesaler", "McCall Industrial Supply", "McCall Industrial Supply", null, null, "7614 West Lemhi #1Idaho Boise ID 83705", "Boise", "ID", "ZIP: 83705");
    stmt.run("wholesaler", "MLSC Holding Co., Inc", "MLSC Holding Co., Inc", null, "mlsap@mountainland.com", "MLSC Holding Co., Inc P.O. Box 190 Orem Utah 84059", "Orem", "Utah", "ZIP: 84059");
    stmt.run("wholesaler", "M-One Specialties", "M-One Specialties", null, "mone.payables@gmail.com", "974 West 100 South Salt Lake City UT 84115", "Salt Lake City", "UT", "ZIP: 84115");
    stmt.run("wholesaler", "Morcon Industrial Specialty, Inc.", "Morcon Industrial Specialty, Inc.", "(307) 789-6235", "ap@morcon-ind.com", "PO Box 1670 Evanston WY 82931-1670", "Evanston", "WY", "ZIP: 82931-1670");
    stmt.run("wholesaler", "Paramount Supply Co., Inc", "Paramount Supply Co., Inc", "(208) 345-5432", "accounts@paramountpipelc.com", "P.O. Box 5628 Boise ID 83705", "Boise", "ID", "Fax: (208) 338-9257; ZIP: 83705");
    stmt.run("wholesaler", "Peterson Plumbing Supply", "Peterson Plumbing Supply", null, "ap@petersonplumbingsupply.com", "Peterson Plumbing Supply c/o Marci Stubblefield 1036 N 1430 W Orem Utah 84057 USA", "Orem", "Utah", "ZIP: 84057");
    stmt.run("wholesaler", "Pipeco Inc.", "Pipeco Inc.", null, "ap@dbcirrigation.com", "8550 Chinden Blvd. Idaho Boise ID 83714", "Boise", "ID", "ZIP: 83714");
    stmt.run("wholesaler", "Pipe Valve & Fitting Co.", "Pipe Valve & Fitting Co.", null, null, "P.O. Box 65765 Salt Lake City UT 84115", "Salt Lake City", "UT", "ZIP: 84115");
    stmt.run("wholesaler", "Scholzen Products Co.", "Scholzen Products Co.", null, "ap@scholzens.com", "P.O. Box 628 Hurricane UT 84737", "Hurricane", "UT", "ZIP: 84737");
    stmt.run("contractor", "Schoonover Plumbing & Heating", "Schoonover Plumbing & Heating", "801-768-4021", null, "1530 N. State Street, Unit D Lehi UT 84043", "Lehi", "UT", "ZIP: 84043");
    stmt.run("contractor", "Shamrock Plumbing, LLC", "Shamrock Plumbing, LLC", "801-295-1690", null, "340 West 500 NorthUtah NSL UT 84054", "NSL", "UT", "Fax: 801-295-1699; ZIP: 84054");
    stmt.run("wholesaler", "Southwest Plumbing Supply", "Southwest Plumbing Supply", "(435) 586-6464", "ap@swplumb.com", "Southwest Plumbing Supply 506 N. 200 West Cedar City Utah 84721", "Cedar City", "Utah", "Fax: (435) 865-7200; ZIP: 84721");
    stmt.run("wholesaler", "Standard Plumbing Supply", "Standard Plumbing Supply", "(801) 255-7145", "abigail.ortiz@standardplumbing.com", "P O Box 708490 Sandy UT 84070", "Sandy", "UT", "ZIP: 84070");
    stmt.run("contractor", "Valley Plumbing", "Valley Plumbing", null, null, "5698 Dannon WaySuite #11 West Jordan UT 84081", "West Jordan", "UT", "ZIP: 84081");
    stmt.run("wholesaler", "Winston Water Cooler of Rigby, LP", "Winston Water Cooler of Rigby, LP", "(208) 709-9600", "acctg@winstonwatercooler.com", "6626 Oakbrrok Blvd. Dallas TX 75235", "Dallas", "TX", "ZIP: 75235");
    stmt.run("wholesaler", "WinWholesale", "WinWholesale", "(866) 351-3493", "apcentral@winwholesale.com", "3110 Kettering Blvd Dayton OH 45439", "Dayton", "OH", "ZIP: 45439");
    log("Seed: 40 contacts imported");
  }

  // TEST CUSTOMER contact (excluded from reports; used for smoke testing).
  const testExists =
    (sqlite.prepare(`SELECT COUNT(*) as c FROM contacts WHERE company_name = 'TEST CUSTOMER'`).get() as any)?.c || 0;
  if (testExists === 0) {
    sqlite
      .prepare(
        `INSERT INTO contacts (contact_type, company_name, contact_name, phone, email, address, city, state, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run("customer", "TEST CUSTOMER", "Test Account", "000-000-0000", "test@test.com", "123 Test Street", "Test City", "UT", "Test account — excluded from reports");
    log("Seed: TEST CUSTOMER contact inserted");
  }
}
