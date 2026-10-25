// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with blanks, strings or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Each followed queue is one device and one request per cycle.
export const MAX_QUEUES = 20;

export const DEFAULT_VHOST = '/';

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  tls_insecure: false,
  queues: '',
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The address of the management plugin: users type `192.0.2.10`,
 * `192.0.2.10:15672` or a full `http://` / `https://` URL, sometimes with the
 * `/api` path copied from the documentation, or a `#/queues` page of the UI.
 * @returns {string} '' when absent or not an HTTP URL; no trailing slash
 */
export function normalizeUrl(value) {
  const raw = text(value);
  if (raw === '') {
    return '';
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const withScheme = hasScheme ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return '';
    }
    if (!hasScheme && !url.port) {
      // A bare host: the management plugin listens on 15672 by default. A
      // full URL without port (a reverse proxy) is kept as typed.
      url.port = '15672';
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    // A path prefix (management.path_prefix, a reverse proxy) is kept.
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return '';
  }
}

/**
 * One followed queue, written `name` (virtual host "/"), `vhost/name`, or
 * `/name` for a queue of "/" whose name holds a slash. Purely syntactic, so
 * the identity of a queue never depends on what the broker answered.
 * @returns {{ vhost: string, name: string }|null}
 */
export function parseQueue(entry) {
  const raw = text(entry);
  if (raw === '') {
    return null;
  }
  if (raw.startsWith('/')) {
    const name = raw.slice(1);
    return name === '' ? null : { vhost: DEFAULT_VHOST, name };
  }
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return { vhost: DEFAULT_VHOST, name: raw };
  }
  const name = raw.slice(slash + 1);
  return name === '' ? null : { vhost: raw.slice(0, slash), name };
}

/** The stable key of a queue: `vhost/name` ("//name" in the default vhost). */
export const queueKey = (queue) => `${queue.vhost}/${queue.name}`;

/** The queue as the user reads it: `name` in "/", `vhost/name` elsewhere. */
export const queueLabel = (queue) =>
  queue.vhost === DEFAULT_VHOST ? queue.name : `${queue.vhost}/${queue.name}`;

/**
 * The queues to follow: separated by commas, semicolons or new lines (a
 * queue name may hold spaces). Duplicates removed, order kept, MAX_QUEUES at
 * most.
 * @returns {Array<{ vhost: string, name: string }>}
 */
export function parseQueues(value) {
  const queues = [];
  const keys = new Set();
  for (const entry of text(value).split(/[,;\n\r]+/)) {
    const queue = parseQueue(entry);
    if (queue && !keys.has(queueKey(queue))) {
      keys.add(queueKey(queue));
      queues.push(queue);
    }
  }
  return queues.slice(0, MAX_QUEUES);
}

/**
 * @param {object} [raw] the values received from Gladys
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  return {
    url: normalizeUrl(source.url),
    username: text(source.username),
    // A password may begin or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    tls_insecure: source.tls_insecure === true || source.tls_insecure === 'true',
    queues: parseQueues(source.queues),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

export const isConfigured = (config) => Boolean(config?.url && config.username && config.password);
