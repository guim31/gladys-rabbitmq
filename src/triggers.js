// -----------------------------------------------------------------------------
// The scene triggers, as transitions.
//
// Scene filters only compare for equality (a threshold belongs to a device
// feature), so a trigger with a threshold fires once per threshold crossed,
// and the scene author picks one (required filter).
//
// `broker_unreachable` — the API has not answered for N minutes: once per
// outage and per threshold. A restart of a few seconds fires nothing, which
// the "Reachable" feature cannot offer.
// `broker_back` — the API answers again after an outage of at least
// OUTAGE_MIN_MS (one that could have fired `broker_unreachable`).
// `broker_restarted` — the uptime of a node went backwards: RabbitMQ restarted
// (or crashed) between two reads, even if no outage was seen.
// `alarm_raised` / `alarm_cleared` — a resource alarm of a node (memory or
// disk watermark: the broker blocks its publishers), a network partition, or
// a node of the cluster down, appears or ends.
// `queue_no_consumer` — a followed queue that had consumers has none for
// CONFIRM_MS: the service reading it stopped, its messages pile up.
// `queue_above` — more messages ready in a followed queue than N: once per
// crossing, at most once per QUIET_PERIOD_MS (a crossing within it is
// reported when it ends). Re-armed when the count is back at or below N.
//
// After a restart of the integration, the first values are a baseline: an
// alarm already raised, a queue already without consumer, a count already
// above a threshold fire nothing (it would re-run every scene).
// -----------------------------------------------------------------------------

import { alarmKey } from './rabbitmq/snapshot.js';

export const TRIGGER = {
  BROKER_UNREACHABLE: 'broker_unreachable',
  BROKER_BACK: 'broker_back',
  BROKER_RESTARTED: 'broker_restarted',
  ALARM_RAISED: 'alarm_raised',
  ALARM_CLEARED: 'alarm_cleared',
  QUEUE_NO_CONSUMER: 'queue_no_consumer',
  QUEUE_ABOVE: 'queue_above',
};

const MINUTE = 60 * 1000;

// Thresholds offered to the scene author.
export const UNREACHABLE_MINUTES = [1, 5, 15, 30, 60];
export const QUEUE_THRESHOLDS = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000];

export const OUTAGE_MIN_MS = UNREACHABLE_MINUTES[0] * MINUTE;
export const CONFIRM_MS = MINUTE;
export const QUIET_PERIOD_MS = 30 * MINUTE;
// The uptime is read with up to 5 s of delay (node statistics) and the clock
// of the container may drift: a start date moving by less is the same start.
export const RESTART_SLACK_MS = MINUTE;

/**
 * @param {object} options
 * @param {() => number} [options.now]
 */
export function createTriggerTracker({ now = () => Date.now() } = {}) {
  // Link: when the outage started (null: up or unknown).
  let linkKnown = false;
  let downSince = null;
  let unreachableFired = new Set();
  let lastUptimes = null;
  // Alarms in progress: key -> { ...alarm, since }; null before the first list.
  let alarms = null;
  // Followed queues: key -> { consumersArmed, noConsumerSince, armed, firedAt }.
  const queues = new Map();
  const queueState = (key) => {
    if (!queues.has(key)) {
      queues.set(key, {
        consumersArmed: false,
        noConsumerSince: null,
        armed: new Set(),
        firedAt: new Map(),
      });
    }
    return queues.get(key);
  };

  return {
    /**
     * A read of the API ended.
     * @param {boolean} up the broker answered (even with a refusal)
     * @returns {{ back: boolean, offlineMinutes: number }}
     */
    onLink(up) {
      const at = now();
      if (!up) {
        if (downSince === null) {
          downSince = at;
          unreachableFired = new Set();
        }
        linkKnown = true;
        return { back: false, offlineMinutes: 0 };
      }
      const wasDown = downSince;
      downSince = null;
      const known = linkKnown;
      linkKnown = true;
      if (!known || wasDown === null) {
        return { back: false, offlineMinutes: 0 };
      }
      // The consumer counts seen before the outage are stale.
      for (const queue of queues.values()) {
        queue.noConsumerSince = null;
      }
      const duration = at - wasDown;
      return {
        back: duration >= OUTAGE_MIN_MS,
        offlineMinutes: Math.floor(duration / MINUTE),
      };
    },

    /**
     * The outage, if any, at this time.
     * @returns {{ unreachable: number[], offlineMinutes: number }}
     */
    onTick() {
      const at = now();
      const unreachable = [];
      if (downSince === null) {
        return { unreachable, offlineMinutes: 0 };
      }
      for (const minutes of UNREACHABLE_MINUTES) {
        if (!unreachableFired.has(minutes) && at - downSince >= minutes * MINUTE) {
          unreachableFired.add(minutes);
          unreachable.push(minutes);
        }
      }
      return { unreachable, offlineMinutes: Math.floor((at - downSince) / MINUTE) };
    },

    /**
     * The uptime of every running node, in ms.
     * @param {Record<string, number>} uptimes
     * @returns {string[]} the nodes that restarted
     */
    onUptimes(uptimes) {
      const at = now();
      const nodes = Object.keys(uptimes);
      // Compared as start dates, not as uptimes: a restart during a long
      // outage leaves a larger uptime than the one read before it.
      const started = Object.fromEntries(nodes.map((node) => [node, at - uptimes[node]]));
      let restarted = [];
      if (lastUptimes !== null && nodes.length > 0) {
        restarted = nodes.filter(
          (node) =>
            lastUptimes[node] !== undefined && started[node] > lastUptimes[node] + RESTART_SLACK_MS,
        );
        // In Docker the node name holds the host name, the container id unless
        // set: a recreated container is a new node. The youngest node starting
        // after every node seen before tells it.
        const youngest = nodes.reduce((a, b) => (started[a] >= started[b] ? a : b));
        const previous = Object.values(lastUptimes);
        if (
          restarted.length === 0 &&
          previous.length > 0 &&
          started[youngest] > Math.max(...previous) + RESTART_SLACK_MS
        ) {
          restarted = [youngest];
        }
      }
      if (nodes.length > 0) {
        // The start date of each node (ms), despite the name.
        lastUptimes = started;
      }
      return restarted;
    },

    /** A cycle without fresh numbers (outage, refused user): consumer counts are stale. */
    onNoSnapshot() {
      for (const queue of queues.values()) {
        queue.noConsumerSince = null;
      }
    },

    /**
     * The alarms in progress.
     * @param {Array<{ name: string, node: string }>} list
     * @returns {{ raised: object[], cleared: Array<{ alarm: object, minutes: number }> }}
     */
    onAlarms(list) {
      const at = now();
      const previous = alarms;
      // The API gives no start date: the alarm runs since it was first seen.
      const current = new Map(
        list.map((alarm) => [
          alarmKey(alarm),
          previous?.get(alarmKey(alarm)) ?? { ...alarm, since: at },
        ]),
      );
      alarms = current;
      if (previous === null) {
        return { raised: [], cleared: [] };
      }
      const raised = [...current].filter(([key]) => !previous.has(key)).map(([, alarm]) => alarm);
      const cleared = [...previous]
        .filter(([key]) => !current.has(key))
        .map(([, alarm]) => ({
          alarm,
          minutes: Math.max(0, Math.floor((at - alarm.since) / MINUTE)),
        }));
      return { raised, cleared };
    },

    /**
     * A followed queue was read.
     * @param {string} key the queue key (vhost/name)
     * @param {{ known: boolean, ready: number|null, consumers: number|null }} queue
     * @returns {{ noConsumer: boolean, above: number[] }}
     */
    onQueue(key, queue) {
      const state = queueState(key);
      const result = { noConsumer: false, above: [] };
      if (!queue.known) {
        // Gone (deleted, auto-delete): nothing to compare with.
        state.noConsumerSince = null;
        return result;
      }
      const at = now();
      if (queue.consumers !== null) {
        if (queue.consumers > 0) {
          state.consumersArmed = true;
          state.noConsumerSince = null;
        } else if (state.consumersArmed) {
          state.noConsumerSince ??= at;
          if (at - state.noConsumerSince >= CONFIRM_MS) {
            state.consumersArmed = false;
            state.noConsumerSince = null;
            result.noConsumer = true;
          }
        }
      }
      if (queue.ready !== null) {
        for (const threshold of QUEUE_THRESHOLDS) {
          if (queue.ready <= threshold) {
            state.armed.add(threshold);
            continue;
          }
          if (!state.armed.has(threshold)) {
            continue;
          }
          // Within the quiet period the threshold stays armed: a backlog
          // still there when it ends is reported then.
          const last = state.firedAt.get(threshold);
          if (last === undefined || at - last >= QUIET_PERIOD_MS) {
            state.armed.delete(threshold);
            state.firedAt.set(threshold, at);
            result.above.push(threshold);
          }
        }
      }
      return result;
    },

    /** A queue no longer followed. */
    forgetQueue(key) {
      queues.delete(key);
    },

    /** A new configuration (another broker): forget everything. */
    reset() {
      linkKnown = false;
      downSince = null;
      unreachableFired = new Set();
      lastUptimes = null;
      alarms = null;
      queues.clear();
    },
  };
}
