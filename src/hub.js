// -----------------------------------------------------------------------------
// The state of the integration: the link to the management API, the latest
// numbers, the followed queues, and what is published to Gladys.
//
// The container reads the API every pollMs (30 s): 2 requests for the broker
// (overview, nodes) and one per followed queue. The devices
// are published with should_poll: false — the core never polls them, which
// also sidesteps the 5.2.0 polling bug (see CLAUDE.md). Only the states that
// changed are sent (300 states a minute at most in the core, scenes
// re-evaluated at each one), plus a heartbeat.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, queueKey, queueLabel } from './config.js';
import {
  brokerIds,
  buildBrokerDevice,
  buildBrokerStates,
  buildQueueDevice,
  buildQueueStates,
  queueKeyOf,
} from './devices.js';
import { createRabbitClient } from './rabbitmq/client.js';
import { parseBroker, parseQueue } from './rabbitmq/snapshot.js';
import { MESSAGES, REPORT_TEXT, formatNumber } from './i18n.js';
import { createIssueLog } from './issues.js';
import { TRIGGER, createTriggerTracker } from './triggers.js';

const logger = createLogger({ name: 'rabbitmq' });

export const WIDGET_KEY = 'broker';

export const DEFAULT_TIMINGS = {
  pollMs: 30 * 1000,
  // Republish an unchanged value at least this often, or the front shows "no
  // recent value" after 48 h.
  heartbeatMs: 6 * 60 * 60 * 1000,
};

const LANGS = ['en', 'fr', 'de', 'es'];

/** The link state behind a failed read of the broker. */
// A 404 or another unexpected status (a redirect of a proxy, a web page…):
// something answers, but not the management API.
const LINK_OF_ERROR = { refused: 'refused', not_found: 'incompatible', http: 'incompatible' };

// Followed queues read at the same time.
const QUEUE_CONCURRENCY = 5;

export class RabbitHub {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {() => number} [options.now]
   * @param {Function} [options.httpGet] test seam: the HTTP transport
   * @param {object} [options.timings]
   */
  constructor({ gladys, now = () => Date.now(), httpGet, timings = {} }) {
    this.gladys = gladys;
    this.now = now;
    this.httpGet = httpGet;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.issues = createIssueLog(logger);
    this.triggers = createTriggerTracker({ now });
    this.config = null;
    this.api = null;
    // null before the first read, then connected / refused / incompatible / unreachable.
    this.link = null;
    this.linkDetail = '';
    this.stats = {};
    this.statsAt = null;
    // Followed queues read in the latest cycle: key -> parseQueue().
    this.queues = new Map();
    this.discovered = false;
    this.pollTimer = null;
    this.polling = null;
    this.pollingGeneration = 0;
    // Followed queues whose latest read failed: not republished as fresh.
    this.unreadQueues = new Set();
    this.status = null;
    this.generation = 0;
  }

  // --- Configuration and lifecycle ----------------------------------------------

  /** (Re)start everything with a configuration. */
  async configure(config) {
    this.stopTimer();
    this.generation += 1;
    const previous = this.config;
    this.config = config;
    // Sent again after a reconnection: Gladys may have restarted.
    this.status = null;
    if (previous && (previous.url !== config.url || previous.username !== config.username)) {
      // Another broker: its numbers, alarms and queues are not ours.
      this.stats = {};
      this.statsAt = null;
      this.queues.clear();
      this.triggers.reset();
      this.link = null;
    }
    const followed = new Set(config.queues.map(queueKey));
    for (const key of this.queues.keys()) {
      if (!followed.has(key)) {
        this.queues.delete(key);
        this.triggers.forgetQueue(key);
      }
    }
    if (!isConfigured(config)) {
      this.api = null;
      this.link = null;
      logger.warn('RabbitMQ is not configured: waiting for its address, a user and a password');
      await this.updateStatus();
      return;
    }
    this.api = createRabbitClient({
      url: config.url,
      username: config.username,
      password: config.password,
      tlsInsecure: config.tls_insecure,
      ...(this.httpGet ? { get: this.httpGet } : {}),
    });
    const queues = config.queues.length;
    logger.info(
      `Watching RabbitMQ at ${config.url}${queues ? `, ${queues} followed queue(s)` : ''}`,
    );
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => logger.error(`Reading RabbitMQ failed: ${err.message}`));
    }, this.timings.pollMs);
    this.pollTimer.unref?.();
    // The followed queues may have changed: the Discovery tab follows.
    if (this.discovered) {
      await this.publishDiscovery();
    }
    await this.poll();
  }

  stopTimer() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  stop() {
    this.stopTimer();
    this.generation += 1;
  }

  /** The API answers (even with a refusal: a key problem is not an outage), or null. */
  reachable() {
    return this.link === null ? null : this.link !== 'unreachable';
  }

  /** The numbers are live: anything else only publishes "Reachable". */
  live() {
    return this.link === 'connected';
  }

  // --- Reading RabbitMQ-----------------------------------------------------------

  /**
   * One cycle; overlapping calls share it. A cycle started under an older
   * configuration gives up on its result: a new one follows it.
   */
  poll() {
    if (this.polling && this.pollingGeneration === this.generation) {
      return this.polling;
    }
    const previous = this.polling ?? Promise.resolve();
    const run = previous
      .catch(() => {})
      .then(() => this.readOnce())
      .finally(() => {
        if (this.polling === run) {
          this.polling = null;
        }
      });
    this.polling = run;
    this.pollingGeneration = this.generation;
    return run;
  }

  async readOnce() {
    const { api, config } = this;
    if (!api) {
      return;
    }
    const generation = this.generation;
    let snapshot = null;
    let link;
    try {
      const [overview, nodes] = await Promise.all([api.overview(), api.nodes()]);
      snapshot = parseBroker(overview, nodes);
      link = 'connected';
      this.linkDetail = '';
    } catch (err) {
      link = LINK_OF_ERROR[err.kind] ?? 'unreachable';
      this.linkDetail = err.message;
    }
    const queues = new Map();
    const unread = new Set();
    if (snapshot) {
      const pending = [...config.queues];
      const worker = async () => {
        while (pending.length > 0) {
          const queue = pending.shift();
          const key = queueKey(queue);
          const label = queueLabel(queue);
          try {
            const read = parseQueue(await api.queue(queue));
            queues.set(key, read);
            this.issues.ok(`queue:${key}`, `The queue "${label}" can be read again`);
            if (read.known) {
              this.issues.ok(`missing:${key}`, `The queue "${label}" exists again`);
            } else {
              this.issues.fail(
                `missing:${key}`,
                `The queue "${label}" does not exist (or the user has no permission on its virtual host)`,
              );
            }
          } catch (err) {
            unread.add(key);
            this.issues.fail(`queue:${key}`, `Reading the queue "${label}" failed: ${err.message}`);
          }
        }
      };
      await Promise.all(Array.from({ length: QUEUE_CONCURRENCY }, worker));
    }
    if (generation !== this.generation) {
      // A newer configuration took over during the requests.
      return;
    }
    if (snapshot) {
      this.unreadQueues = unread;
    }
    await this.apply(link, snapshot, queues, generation);
  }

  /** The result of one cycle: link, numbers, triggers, then Gladys. */
  async apply(link, snapshot, queues, generation = this.generation) {
    const linkChanged = link !== this.link;
    this.logLink(link);
    this.link = link;
    const { back, offlineMinutes } = this.triggers.onLink(this.reachable() === true);
    const events = [];
    if (back) {
      events.push([TRIGGER.BROKER_BACK, null, { offline_minutes: offlineMinutes }]);
    }
    let alarmsChanged = false;
    if (snapshot) {
      this.stats = snapshot;
      this.statsAt = this.now();
      events.push(...this.brokerEvents(snapshot));
      alarmsChanged = events.some(([key]) => key.startsWith('alarm_'));
      for (const [key, queue] of queues) {
        this.queues.set(key, queue);
        const { noConsumer, above } = this.triggers.onQueue(key, queue);
        if (noConsumer) {
          logger.info(`The queue "${key}" has no consumer any more`);
          events.push([TRIGGER.QUEUE_NO_CONSUMER, key, { messages_ready: queue.ready ?? 0 }]);
        }
        for (const threshold of above) {
          events.push([
            TRIGGER.QUEUE_ABOVE,
            key,
            { above: String(threshold), messages_ready: queue.ready },
          ]);
        }
      }
    }
    const { unreachable, offlineMinutes: down } = this.triggers.onTick();
    for (const minutes of unreachable) {
      events.push([
        TRIGGER.BROKER_UNREACHABLE,
        null,
        { after_minutes: String(minutes), minutes: down },
      ]);
    }
    await this.updateStatus();
    if (snapshot && (!this.discovered || this.issues.isFailing('discovery'))) {
      await this.publishDiscovery();
    }
    await this.publish();
    for (const [key, queue, extra] of events) {
      if (generation !== this.generation) {
        // Another broker configured meanwhile: these events are not its own.
        break;
      }
      await this.fireScene(key, queue, extra);
    }
    if (linkChanged || alarmsChanged) {
      this.requestWidgetRefresh();
    }
  }

  /** The broker triggers of a fresh snapshot, as [key, queueKey, variables]. */
  brokerEvents(snapshot) {
    const events = [];
    for (const node of this.triggers.onUptimes(snapshot.nodeUptimes)) {
      logger.info(`RabbitMQ node ${node} restarted`);
      events.push([TRIGGER.BROKER_RESTARTED, null, { node, version: snapshot.version ?? '' }]);
    }
    const { raised, cleared } = this.triggers.onAlarms(snapshot.alarms);
    for (const alarm of raised) {
      logger.info(`RabbitMQ alarm raised: ${alarm.name} on ${alarm.node}`);
      events.push([TRIGGER.ALARM_RAISED, null, { alarm: alarm.name, node: alarm.node }]);
    }
    for (const { alarm, minutes } of cleared) {
      logger.info(`RabbitMQ alarm cleared: ${alarm.name} on ${alarm.node}`);
      events.push([
        TRIGGER.ALARM_CLEARED,
        null,
        { alarm: alarm.name, node: alarm.node, duration_minutes: minutes },
      ]);
    }
    return events;
  }

  logLink(link) {
    const url = this.config.url;
    if (link === 'connected') {
      if (this.issues.isFailing('link')) {
        this.issues.ok('link', `RabbitMQ at ${url} answers again`);
      } else if (this.link !== 'connected') {
        logger.info(`Connected to RabbitMQ at ${url}`);
      }
      return;
    }
    const what = {
      refused: 'refused the user or its password',
      incompatible: 'has no management API (wrong port, or plugin not enabled)',
      unreachable: 'cannot be reached',
    }[link];
    this.issues.fail('link', `RabbitMQ at ${url} ${what} (${this.linkDetail})`);
  }

  /**
   * The connection status shown by Gladys, sent when it changes. The core
   * wants a multi-language object (`en` required): the page picks the
   * viewer's language.
   */
  async updateStatus() {
    const { config, link } = this;
    let message = null;
    if (!config || !isConfigured(config)) {
      message = MESSAGES.notConfigured;
    } else if (this.issues.isFailing('discovery')) {
      message = MESSAGES.publishFailed;
    } else if (link === 'refused') {
      message = MESSAGES.refused;
    } else if (link === 'incompatible') {
      message = MESSAGES.incompatible;
    } else if (link === 'unreachable') {
      message = MESSAGES.unreachable;
    }
    const pending = message === null && link === null;
    const status = pending ? null : message === null ? 'ok' : message.en;
    if (status === this.status) {
      return;
    }
    this.status = status;
    if (pending) {
      return;
    }
    await this.gladys
      .setConnectionStatus(message === null, message === null ? undefined : message)
      .catch((err) => logger.debug(`Connection status not sent: ${err.message}`));
  }

  /** The data the broker features, the widget and the scene action read. */
  data() {
    return { reachable: this.reachable(), link: this.link, stats: this.stats };
  }

  // --- Gladys side ----------------------------------------------------------------

  /** The device of the broker as Gladys knows it, if added. */
  addedBroker() {
    const externalId = brokerIds(this.gladys).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId) ?? null;
  }

  /** The followed queues added to Gladys, as [queue, device]. */
  addedQueues() {
    const followed = new Map((this.config?.queues ?? []).map((queue) => [queueKey(queue), queue]));
    return (this.gladys.devices ?? [])
      .map((device) => [followed.get(queueKeyOf(this.gladys, device.external_id)), device])
      .filter(([queue]) => queue !== undefined);
  }

  /** The discovered devices: the broker and its followed queues, once RabbitMQ answered. */
  discoveredDevices() {
    if (!this.discovered && this.statsAt === null && !this.addedBroker()) {
      return [];
    }
    const language = this.config?.language ?? 'fr';
    return [
      buildBrokerDevice(this.gladys, { language }),
      ...(this.config?.queues ?? []).map((queue) =>
        buildQueueDevice(this.gladys, { queue, language }),
      ),
    ];
  }

  async publishDiscovery() {
    const devices = this.discoveredDevices();
    if (devices.length === 0) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = true;
      this.issues.ok('discovery', 'Gladys accepts the RabbitMQ devices again');
    } catch (err) {
      this.issues.fail('discovery', `Publishing the RabbitMQ devices failed: ${err.message}`);
    }
    await this.updateStatus();
  }

  /** Publish the changed states (a device just added: everything, see app.js). */
  async publish() {
    const states = [];
    if (this.addedBroker()) {
      const data = this.data();
      // Not live (outage, key refused): only "Reachable" changes, the numbers
      // keep their last value and age in Gladys instead of being republished
      // as fresh by the heartbeat.
      states.push(...buildBrokerStates(this.gladys, this.live() ? data : { ...data, stats: {} }));
    }
    if (this.live()) {
      for (const [queue] of this.addedQueues()) {
        const key = queueKey(queue);
        const read = this.queues.get(key);
        if (read && !this.unreadQueues.has(key)) {
          states.push(...buildQueueStates(this.gladys, queue, read));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      if (count > 0) {
        logger.debug(`${count} state(s) published`);
      }
      this.issues.ok('publish', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  /**
   * Fire a scene event on the broker (queue key null) or on a followed
   * queue, if that device is added in Gladys.
   */
  async fireScene(key, queue, extra) {
    const added = queue === null ? null : this.addedQueues().find(([q]) => queueKey(q) === queue);
    const device = queue === null ? this.addedBroker() : (added?.[1] ?? null);
    if (!device) {
      return;
    }
    const variables =
      queue === null
        ? { broker: device.name ?? 'RabbitMQ' }
        : { queue: queueLabel(added[0]), queue_name: device.name ?? queueLabel(added[0]) };
    try {
      await this.gladys.publishSceneEvent(key, {
        device: device.external_id,
        ...variables,
        ...extra,
      });
      logger.debug(`Scene event ${key} fired`);
      this.issues.ok('scene', 'Gladys accepts the scene events again');
    } catch (err) {
      this.issues.fail('scene', `Firing the scene event ${key} failed: ${err.message}`);
    }
  }

  /** Fire-and-forget nudge: the dashboards re-pull the widget content. */
  requestWidgetRefresh() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not sent: ${err.message}`);
    }
  }

  // --- "Check the connection" action ----------------------------------------------

  /**
   * Reads RabbitMQ now and tells what it gives, in the four languages.
   * @returns {Promise<Record<string, string>>}
   */
  async checkConnection() {
    const { config } = this;
    const language = config?.language ?? 'en';
    if (!config || !isConfigured(config)) {
      throw new Error(MESSAGES.notConfigured[language]);
    }
    await this.poll();
    const { link, stats } = this;
    const { url } = config;
    if (link === 'refused') {
      throw new Error(MESSAGES.refused[language]);
    }
    if (link === 'incompatible') {
      throw new Error(MESSAGES.incompatible[language]);
    }
    if (link !== 'connected') {
      const text = REPORT_TEXT[language] ?? REPORT_TEXT.en;
      throw new Error(
        link === null ? text.pending(url) : text.down(url, this.linkDetail || 'no answer'),
      );
    }
    const report = {};
    for (const lang of LANGS) {
      const text = REPORT_TEXT[lang];
      const n = (value) => (Number.isFinite(value) ? formatNumber(value, lang, 0) : '?');
      const lines = [text.ok(url, stats.version ?? '?')];
      lines.push(
        text.numbers(
          n(stats.connections),
          n(stats.queues),
          n(stats.messagesReady),
          n(stats.messagesUnacked),
        ),
      );
      lines.push(stats.alarms.length > 0 ? text.alarms(n(stats.alarms.length)) : text.noAlarm);
      if (config.queues.length > 0) {
        const found = config.queues.filter((queue) => this.queues.get(queueKey(queue))?.known);
        lines.push(text.queues(n(found.length), n(config.queues.length)));
        const missing = config.queues.filter(
          (queue) => this.queues.get(queueKey(queue))?.known === false,
        );
        if (missing.length > 0) {
          lines.push(text.missing(missing.map(queueLabel).join(', ')));
        }
      }
      report[lang] = lines.join(' ');
    }
    return report;
  }
}
