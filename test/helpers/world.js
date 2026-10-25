// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake RabbitMQ management
// API that answers with real recorded bodies (test/fixtures/rabbitmq/), and
// the integration wired on top through registerHandlers — the same wiring as
// index.js.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { NODES_PATH, OVERVIEW_PATH } from '../../src/rabbitmq/client.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const VERSIONS = ['4.4.0'];

/** A recorded body. */
export function fixture(name, version = '4.4.0') {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/rabbitmq/${version}/${name}.json`, import.meta.url), 'utf8'),
  );
}

export const URL_BASE = 'http://rabbitmq.example:15672';
export const USERNAME = 'gladys';
export const PASSWORD = 'test-password-value';
export const CONFIG = { url: URL_BASE, username: USERNAME, password: PASSWORD };

/**
 * A fake RabbitMQ: the httpGet seam of the client. `routes` maps an API path
 * (after /api/) to { status, body }; `queues` maps "vhost/name" to a queue
 * body; `down` makes every request fail like a stopped broker.
 */
export function createFakeRabbit(version = '4.4.0') {
  const rabbit = {
    requests: [],
    down: false,
    routes: {
      [OVERVIEW_PATH]: { status: 200, body: fixture('overview', version) },
      [NODES_PATH]: { status: 200, body: fixture('nodes', version) },
    },
    queues: {},
    // The uptime grows with the (mocked) clock, like a running broker's.
    uptime: { base: null, at: Date.now() },
    // API paths (without query) answering 500, and a promise every request waits for.
    failing: new Set(),
    gate: null,
    /** Answer every request with a status (401, 500…). */
    failWith(status, body = null) {
      rabbit.status = status;
      rabbit.statusBody = body;
    },
    setOverview(patch) {
      const route = rabbit.routes[OVERVIEW_PATH];
      route.body = { ...route.body, ...patch };
    },
    setNodes(patch) {
      const route = rabbit.routes[NODES_PATH];
      route.body = route.body.map((node) => ({ ...node, ...patch }));
    },
    /** The uptime of every node now (ms); it keeps growing from there. */
    setUptime(ms) {
      rabbit.uptime = { base: ms, at: Date.now() };
    },
    /** A queue: a patch of the recorded body, or null (404). */
    setQueue(key, patch, base = 'queue-consumed') {
      rabbit.queues[key] = patch === null ? null : { ...fixture(base, version), ...patch };
    },
    async get(url, options) {
      rabbit.requests.push({ url, options });
      if (rabbit.gate) {
        await rabbit.gate;
      }
      if (rabbit.down) {
        const err = new Error('connect ECONNREFUSED 192.0.2.10:15672');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      if (rabbit.status) {
        return { status: rabbit.status, body: rabbit.statusBody ?? fixture('bad-auth', version) };
      }
      const path = url.replace(/^.*?\/api\//, '');
      if (rabbit.failing.has(path.replace(/\?.*$/, ''))) {
        return { status: 500, body: null };
      }
      const queue = path.match(/^queues\/([^/]+)\/([^/?]+)\?/);
      if (queue) {
        const key = `${decodeURIComponent(queue[1])}/${decodeURIComponent(queue[2])}`;
        const body = rabbit.queues[key];
        if (!body) {
          return { status: 404, body: fixture('queue-not-found', version) };
        }
        return { status: 200, body };
      }
      const route = rabbit.routes[path];
      if (path === NODES_PATH && route?.status === 200) {
        const grown = Date.now() - rabbit.uptime.at;
        return {
          status: 200,
          body: route.body.map((node) =>
            node.uptime === undefined
              ? node
              : { ...node, uptime: (rabbit.uptime.base ?? node.uptime) + grown },
          ),
        };
      }
      return route ?? { status: 404, body: { error: 'not_found', reason: 'Not Found' } };
    },
  };
  return rabbit;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {string} [options.version] the RabbitMQ fixtures to answer with
 * @param {Array<object>} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {object} [options.timings]
 */
export async function createWorld({
  config = CONFIG,
  version = '4.4.0',
  devices = [],
  connect = true,
  timings,
} = {}) {
  const rabbit = createFakeRabbit(version);
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, { httpGet: rabbit.get, timings });
  if (connect) {
    await gladys.connect();
    await flush();
  }
  return { gladys, rabbit, app, hub: app.hub };
}

/** Let the pending promise callbacks and zero-delay timers run. */
export const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Create a discovered device in Gladys, as the user would. */
export async function addDevice(world, externalId) {
  const discovered = world.gladys.fake.discoveredDevices;
  const device = discovered.find((entry) => entry.external_id === externalId);
  if (!device) {
    throw new Error(`${externalId} was not discovered`);
  }
  await world.gladys.fake.deviceCreated(device);
  return device;
}

export const brokerId = (gladys) => gladys.externalIds('broker', 'rabbitmq').device;
/** The device of a queue, by its key "vhost/name" ("//zigbee" in the default vhost). */
export const queueDeviceId = (gladys, key) =>
  gladys.externalIds('queue', encodeURIComponent(key)).device;
export const featureId = (gladys, key) => `${brokerId(gladys)}:${key}`;
export const queueFeatureId = (gladys, queueKey, key) =>
  `${queueDeviceId(gladys, queueKey)}:${key}`;
