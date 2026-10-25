// -----------------------------------------------------------------------------
// The Gladys devices: the RabbitMQ broker (or cluster), and one device per
// followed queue.
//
// The broker is keyed on a fixed id: a new address (another host, HTTPS)
// keeps the same device and its history. A queue is keyed on its virtual
// host and name (`vhost/name`), URI-encoded (both may hold "/"). Feature keys
// are forever (Gladys keys the history, scenes and dashboards on them): add
// new ones, never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { queueKey, queueLabel } from './config.js';
import { FEATURE_NAMES, QUEUE_FEATURE_NAMES, pick } from './i18n.js';

export const BROKER_TYPE = 'broker';
export const BROKER_ID = 'rabbitmq';
export const QUEUE_TYPE = 'queue';
export const DEFAULT_NAME = 'RabbitMQ';

// Display bounds only: a backlog of a billion messages is not a home broker.
const MAX_COUNT = 1000000000;

export const round = (value, decimals = 0) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const counter = (key, stat) => ({
  key,
  category: C.COUNTER_SENSOR,
  type: T.SENSOR.INTEGER,
  min: 0,
  max: MAX_COUNT,
  read: ({ stats }) => round(stats[stat]),
});

// A queue reads its own numbers.
const queueCounter = (key, stat) => ({
  ...counter(key, stat),
  read: ({ queue }) => (queue?.known ? round(queue[stat]) : null),
});

const flag = (value) => (value === true ? 1 : value === false ? 0 : null);

const binary = (key, read) => ({
  key,
  category: C.INPUT,
  type: T.SENSOR.BINARY,
  min: 0,
  max: 1,
  read,
});

/**
 * The features of the broker, in display order. `read` turns the broker data
 * ({ reachable, stats }) into the state, or null when unknown (nothing is
 * published then).
 */
export const FEATURES = [
  binary('reachable', ({ reachable }) => flag(reachable)),
  counter('connections', 'connections'),
  counter('channels', 'channels'),
  counter('consumers', 'consumers'),
  counter('queues', 'queues'),
  counter('messages_ready', 'messagesReady'),
  counter('messages_unacknowledged', 'messagesUnacked'),
  counter('messages_published', 'messagesPublished'),
  counter('messages_delivered', 'messagesDelivered'),
  // 1 while the broker blocks its publishers (memory or disk watermark).
  binary('memory_alarm', ({ stats }) => flag(stats.memoryAlarm)),
  binary('disk_alarm', ({ stats }) => flag(stats.diskAlarm)),
  counter('nodes_running', 'nodesRunning'),
  {
    // In days: Gladys has no "uptime" display, and days read best on a tile.
    key: 'uptime',
    category: C.DURATION,
    type: T.DURATION.DECIMAL,
    unit: U.DAYS,
    min: 0,
    max: 36500,
    keepHistory: false,
    read: ({ stats }) =>
      Number.isFinite(stats.uptimeSeconds) ? round(stats.uptimeSeconds / 86400, 2) : null,
  },
  {
    key: 'version',
    category: C.TEXT,
    type: T.TEXT.TEXT,
    // NOT NULL in the core, even for a text (422 on "Add to Gladys").
    min: 0,
    max: 0,
    keepHistory: false,
    read: ({ stats }) => (stats.version ? { text: stats.version } : null),
  },
];

/** The features of a followed queue. */
export const QUEUE_FEATURES = [
  queueCounter('messages_ready', 'ready'),
  queueCounter('messages_unacknowledged', 'unacked'),
  queueCounter('consumers', 'consumers'),
  queueCounter('messages_published', 'published'),
  queueCounter('messages_delivered', 'delivered'),
];

/** The external ids of the broker. */
export const brokerIds = (gladys) => gladys.externalIds(BROKER_TYPE, BROKER_ID);

/** The external ids of a followed queue. */
export const queueIds = (gladys, queue) =>
  gladys.externalIds(QUEUE_TYPE, encodeURIComponent(queueKey(queue)));

/** The queue key (`vhost/name`) behind a device external id, or null if not a queue. */
export function queueKeyOf(gladys, externalId) {
  const prefix = gladys.externalIds(QUEUE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  try {
    return decodeURIComponent(externalId.slice(prefix.length));
  } catch {
    return null;
  }
}

const toFeature = (ids, names) => (feature) => ({
  name: names[feature.key],
  external_id: ids.feature(feature.key),
  category: feature.category,
  type: feature.type,
  ...(feature.unit ? { unit: feature.unit } : {}),
  min: feature.min,
  max: feature.max,
  read_only: true,
  has_feedback: false,
  keep_history: feature.keepHistory ?? true,
});

/**
 * The discovered device of the broker.
 * @param {object} gladys
 * @param {{ language: string }} options
 */
export function buildBrokerDevice(gladys, { language }) {
  const ids = brokerIds(gladys);
  return {
    name: DEFAULT_NAME,
    external_id: ids.device,
    model: 'RabbitMQ',
    // Read by the container every 30 s: the core never polls.
    should_poll: false,
    features: FEATURES.map(toFeature(ids, pick(FEATURE_NAMES, language))),
  };
}

/**
 * The discovered device of a followed queue, named after it.
 * @param {object} gladys
 * @param {{ queue: { vhost: string, name: string }, language: string }} options
 */
export function buildQueueDevice(gladys, { queue, language }) {
  const ids = queueIds(gladys, queue);
  return {
    name: queueLabel(queue),
    external_id: ids.device,
    model: 'RabbitMQ queue',
    should_poll: false,
    features: QUEUE_FEATURES.map(toFeature(ids, pick(QUEUE_FEATURE_NAMES, language))),
  };
}

function toStates(ids, features, data) {
  const states = [];
  for (const feature of features) {
    const value = feature.read(data);
    if (value === null || value === undefined) {
      continue;
    }
    const id = ids.feature(feature.key);
    // A text feature takes `text`, never an empty one (the core ignores it).
    states.push(
      typeof value === 'object'
        ? { device_feature_external_id: id, text: value.text }
        : { device_feature_external_id: id, state: value },
    );
  }
  return states;
}

/**
 * The states of the broker, in the publishStates format.
 * @param {object} gladys
 * @param {{ reachable: boolean|null, stats: object }} data
 */
export const buildBrokerStates = (gladys, data) => toStates(brokerIds(gladys), FEATURES, data);

/**
 * The states of a followed queue.
 * @param {object} gladys
 * @param {{ vhost: string, name: string }} queue
 * @param {object|null} read parseQueue()
 */
export const buildQueueStates = (gladys, queue, read) =>
  toStates(queueIds(gladys, queue), QUEUE_FEATURES, { queue: read });
