/**
 * Update notifier -- non-blocking check for newer npm versions.
 *
 * Checks at most once every 24 hours. Caches the result in
 * ~/.config/notion/update-check.json. Never blocks command execution.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = 'https://registry.npmjs.org/notion-cli-agent/latest';
const CACHE_PATH = join(homedir(), '.config', 'notion', 'update-check.json');

interface UpdateCache {
  lastCheck: number;
  latestVersion?: string;
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    // Silent fail -- not critical
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Fire-and-forget: fetch latest version from npm, cache it.
 * Returns immediately. The result is picked up on the next run.
 */
export function checkForUpdateInBackground(currentVersion: string): void {
  const cache = readCache();

  // Already checked recently -- show cached result if available
  if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
    if (cache.latestVersion && isNewer(cache.latestVersion, currentVersion)) {
      printUpdateBanner(currentVersion, cache.latestVersion);
    }
    return;
  }

  // Fetch in background (non-blocking)
  fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) })
    .then(res => res.json())
    .then((data) => {
      const latest = (data as { version?: string }).version;
      if (!latest) return;
      writeCache({ lastCheck: Date.now(), latestVersion: latest });
      if (isNewer(latest, currentVersion)) {
        printUpdateBanner(currentVersion, latest);
      }
    })
    .catch(() => {
      // Network error, timeout, offline -- silently ignore
      writeCache({ lastCheck: Date.now() });
    });
}

function printUpdateBanner(current: string, latest: string): void {
  process.stderr.write(
    `\n  Update available: ${current} → ${latest}\n` +
    `  Run: npm install -g notion-cli-agent\n\n`,
  );
}
