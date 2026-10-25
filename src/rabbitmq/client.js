// -----------------------------------------------------------------------------
// The HTTP API of the RabbitMQ management plugin (port 15672), read with a
// user and its password in HTTP Basic. A user with the `monitoring` tag is
// enough. Only GET requests: the integration never changes anything on the
// broker (no purge, no delete, no publish).
//
// node:http(s) rather than fetch: the global fetch cannot skip the check of
// a self-signed certificate without an extra dependency.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const TIMEOUT_MS = 10 * 1000;
// The answers are trimmed with `columns`: a few kB.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Why a request failed:
 * - `unreachable` — no answer, a timeout, an HTTP 5xx, or a body that is not JSON;
 * - `refused` — 401/403: wrong key or secret, or a key without the rights;
 * - `not_found` — 404: no such queue, or no management API at this address;
 * - `http` — any other status.
 */
export class RabbitError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'RabbitError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * The default transport: one GET, the parsed JSON body.
 * @param {string} url
 * @param {{ authorization: string, tlsInsecure: boolean, timeoutMs: number }} options
 * @returns {Promise<{ status: number, body: unknown }>}
 */
export function httpGet(url, { authorization, tlsInsecure, timeoutMs }) {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = lib.request(
      target,
      {
        method: 'GET',
        headers: { accept: 'application/json', authorization },
        timeout: timeoutMs,
        // A fresh connection per request: a few requests every 30 s, and no
        // keep-alive socket left that the broker may have closed meanwhile.
        agent: false,
        ...(target.protocol === 'https:' ? { rejectUnauthorized: !tlsInsecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = text === '' ? null : JSON.parse(text);
          } catch {
            body = undefined;
          }
          resolve({ status: response.statusCode, body });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    request.on('error', reject);
    request.end();
  });
}

export const OVERVIEW_PATH =
  'overview?columns=rabbitmq_version,cluster_name,message_stats,queue_totals,object_totals';
export const NODES_PATH = 'nodes?columns=name,running,uptime,mem_alarm,disk_free_alarm,partitions';
const QUEUE_COLUMNS =
  'columns=name,vhost,type,state,messages_ready,messages_unacknowledged,consumers,message_stats';

/** The API path of one queue (both parts encoded: "/" is %2F). */
export const queuePath = ({ vhost, name }) =>
  `queues/${encodeURIComponent(vhost)}/${encodeURIComponent(name)}?${QUEUE_COLUMNS}`;

/**
 * @param {object} options
 * @param {string} options.url normalized base URL (src/config.js)
 * @param {string} options.username
 * @param {string} options.password
 * @param {boolean} [options.tlsInsecure]
 * @param {Function} [options.get] test seam, same contract as httpGet
 * @param {number} [options.timeoutMs]
 */
export function createRabbitClient({
  url,
  username,
  password,
  tlsInsecure = false,
  get = httpGet,
  timeoutMs = TIMEOUT_MS,
}) {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  /** GET /api/<path>, the JSON body or a RabbitError. */
  async function request(path) {
    let response;
    try {
      response = await get(`${url}/api/${path}`, { authorization, tlsInsecure, timeoutMs });
    } catch (err) {
      // The message of a network error never holds the credentials.
      throw new RabbitError('unreachable', err.code ? `${err.code}: ${err.message}` : err.message);
    }
    const { status, body } = response;
    const code =
      body && typeof body === 'object' && typeof body.error === 'string' ? ` ${body.error}` : '';
    if (status === 401 || status === 403) {
      throw new RabbitError('refused', `HTTP ${status}${code}`, status);
    }
    if (status === 404) {
      throw new RabbitError('not_found', `HTTP 404${code}`, status);
    }
    if (status >= 500) {
      throw new RabbitError('unreachable', `HTTP ${status}${code}`, status);
    }
    if (status < 200 || status >= 300) {
      throw new RabbitError('http', `HTTP ${status}${code}`, status);
    }
    if (body === undefined || body === null || typeof body !== 'object') {
      // A web page (a proxy, another service): not the management API.
      throw new RabbitError('http', `HTTP ${status} without a JSON body`, status);
    }
    return body;
  }

  return {
    request,
    overview: () => request(OVERVIEW_PATH),
    nodes: () => request(NODES_PATH),
    /**
     * One queue: its numbers, or null when the broker has no such queue (not
     * declared yet, deleted, auto-delete queue without consumer).
     */
    async queue(queue) {
      try {
        return await request(queuePath(queue));
      } catch (err) {
        if (err.kind === 'not_found') {
          return null;
        }
        throw err;
      }
    },
  };
}
