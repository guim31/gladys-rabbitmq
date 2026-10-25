// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`).
//
// `broker_summary` — the state of the broker as a ready-made sentence
// ("RabbitMQ 4.4.0 has been running for 3 days, 5 connections, 12 messages
// ready and 0 unacknowledged, …, no alarm.") plus its numbers, for a daily
// report or a check before a scene that relies on the broker.
// `queue_summary` — the same for one followed queue (messages ready,
// unacknowledged, consumers), picked among the devices.
//
// Their language is the one of the configuration (a scene action does not
// receive the user's language). An unreachable broker is an answer, not an
// error: the scene can branch on `reachable`. The numbers are those of the
// latest read (30 s old at most). Nothing is ever written to the broker.
// -----------------------------------------------------------------------------

import { queueKey, queueLabel } from './config.js';
import { round } from './devices.js';
import { MESSAGES, alarmNames, brokerSentence, pick, queueSentence } from './i18n.js';

export const SCENE_ACTION = {
  BROKER_SUMMARY: 'broker_summary',
  QUEUE_SUMMARY: 'queue_summary',
};

const language = (hub) => hub.config?.language ?? 'fr';

/**
 * @param {import('./hub.js').RabbitHub} hub
 */
export function brokerSummary(hub) {
  const data = hub.data();
  const stats = hub.live() ? data.stats : {};
  const alarms = Array.isArray(stats.alarms) ? stats.alarms : [];
  return {
    summary: brokerSentence(data, language(hub)),
    // The numbers are readable: a refused user or a wrong address is not fine.
    reachable: hub.live(),
    connections: round(stats.connections),
    queues: round(stats.queues),
    messages_ready: round(stats.messagesReady),
    messages_unacknowledged: round(stats.messagesUnacked),
    messages_published_per_minute: round(stats.messagesPublished),
    messages_delivered_per_minute: round(stats.messagesDelivered),
    active_alarms: hub.live() ? alarms.length : null,
    alarm_names: alarmNames(alarms, language(hub)),
    uptime_hours: Number.isFinite(stats.uptimeSeconds)
      ? round(stats.uptimeSeconds / 3600, 1)
      : null,
    version: stats.version ?? '',
  };
}

/**
 * @param {import('./hub.js').RabbitHub} hub
 * @param {{ device?: string }} [fields] the resolved fields: the chosen device
 */
export function queueSummary(hub, fields = {}) {
  const added = hub.addedQueues().find(([, device]) => device.external_id === fields?.device);
  if (!added) {
    // A device of another type, or a queue no longer followed.
    throw new Error(pick(MESSAGES.unknownQueue, language(hub)));
  }
  const [queue] = added;
  const key = queueKey(queue);
  // A queue whose latest read failed has no fresh numbers.
  const read = hub.live() && !hub.unreadQueues.has(key) ? hub.queues.get(key) : undefined;
  const known = read?.known === true;
  return {
    summary: queueSentence(hub.data(), queueLabel(queue), read, language(hub)),
    reachable: hub.live(),
    exists: known,
    messages_ready: known ? round(read.ready) : null,
    messages_unacknowledged: known ? round(read.unacked) : null,
    consumers: known ? round(read.consumers) : null,
    messages_published_per_minute: known ? round(read.published) : null,
    messages_delivered_per_minute: known ? round(read.delivered) : null,
    queue: queueLabel(queue),
  };
}
