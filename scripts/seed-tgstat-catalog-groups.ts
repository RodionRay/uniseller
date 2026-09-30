#!/usr/bin/env npx tsx
/**
 * Заливает verified GROUP_CATALOG в локальную D1 (owner=SEED_OWNER, по умолчанию local_seedy).
 * Usage: npm run db:migrate && npm run seed:tgstat-catalog   (D1_PERSIST_DIR, по умолчанию .wrangler/state)
 */
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {GROUP_CATALOG, catalogStats} from '../lib/group-catalog';
import {locateD1File} from './wrangler-local.mjs';

// The records table comes from drizzle migrations (npm run db:migrate), not from this script.
const dbPath: string = locateD1File();
const db = new Database(dbPath, {fileMustExist: true});

const owner = process.env.SEED_OWNER?.trim() || 'local_seedy';
const existing = db.prepare("SELECT data FROM records WHERE owner=? AND kind='group'").all(owner) as {data: string}[];
const byUrl = new Set<string>();
for (const row of existing) {
  try {
    const d = JSON.parse(row.data) as {url?: string};
    if (d.url) byUrl.add(String(d.url).toLowerCase().replace(/\/$/, ''));
  } catch {
    /* ignore */
  }
}

const insert = db.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)');
const verified = GROUP_CATALOG.filter((g) => g.verified && g.url?.startsWith('https://t.me/'));
let added = 0;
const tx = db.transaction(() => {
  for (const g of verified) {
    const url = g.url.replace(/\/$/, '');
    const key = url.toLowerCase();
    if (byUrl.has(key)) continue;
    const data = {
      name: g.name,
      url,
      accountId: '',
      status: 'setup',
      error: '',
      membership: 'none',
      joinedAt: '',
      leadsTotal: 0,
      leadsHot: 0,
      leadsWarm: 0,
      leadsCold: 0,
      scanMatched: 0,
      rating: 0,
      lastScanned: '',
      catalogId: g.id,
      niches: g.niches,
      description: g.description,
      audience: g.audience,
      source: g.niches.includes('blogs') ? 'tgstat-blogs' : 'catalog',
    };
    insert.run(randomUUID(), owner, 'group', JSON.stringify(data), null, new Date().toISOString());
    byUrl.add(key);
    added += 1;
  }
});
tx();

const count = db.prepare("SELECT count(*) AS c FROM records WHERE owner=? AND kind='group'").get(owner) as {c: number};
const blogs = db
  .prepare("SELECT count(*) AS c FROM records WHERE owner=? AND kind='group' AND data LIKE '%tgstat-blogs%'")
  .get(owner) as {c: number};
console.log(JSON.stringify({dbPath, owner, catalog: catalogStats(), seededAdded: added, groupsInDb: count.c, tgstatBlogsTagged: blogs.c}, null, 2));
