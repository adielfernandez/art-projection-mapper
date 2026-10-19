import { CONFIG_SCHEMA_VERSION } from './schema';

/**
 * Config migrations, keyed by the version they upgrade *from*.
 * Each takes the raw parsed JSON of version N and returns version N+1.
 * None yet: schemaVersion 1 is the first version.
 */
const configMigrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** Upgrade raw parsed config JSON to the current schema version (validation happens in configIO). */
export function migrateConfigJson(raw: Record<string, unknown>): Record<string, unknown> {
  let data = raw;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(`config.json schemaVersion ${version} is newer than this app supports (${CONFIG_SCHEMA_VERSION}).`);
  }
  while (version < CONFIG_SCHEMA_VERSION) {
    const step = configMigrations[version];
    if (!step) throw new Error(`No migration from config schemaVersion ${version}.`);
    data = step(data);
    version += 1;
    data.schemaVersion = version;
  }
  return data;
}
