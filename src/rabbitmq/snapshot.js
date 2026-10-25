// -----------------------------------------------------------------------------
// From the raw answers of the management API to the numbers the integration
// uses.
//
// - `GET /api/overview`: the cluster-wide totals. `queue_totals` holds the
//   messages ready and unacknowledged, `object_totals` the connections,
//   channels, consumers and queues, `message_stats` the rates in messages per
//   second (averaged by the broker over its last 5 s sample): published here
//   per minute, like the Mosquitto and EMQX integrations, since Gladys has no
//   "per second" unit for messages and a home broker carries a few per second.
//   `message_stats` is empty before the first message, and missing when the
//   metrics collector is disabled: counts stay null then.
// - `GET /api/nodes`: one entry per node (running, uptime in ms, mem_alarm,
//   disk_free_alarm, partitions). The node statistics are refreshed every 5 s
//   by the broker: an alarm shows up to 5 s late.
// - `GET /api/queues/{vhost}/{name}`: one queue, or a 404.
//
// Checked on RabbitMQ 4.4.0 (rabbitmq:4-management), see test/fixtures/rabbitmq/.
// -----------------------------------------------------------------------------

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const perMinute = (value) => (num(value) === null ? null : Math.round(value * 60));

const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/**
 * The rate of a message_stats entry (`publish`, `deliver_get`…), per minute:
 * 0 while that kind of message never happened (the entry is absent then).
 */
function rate(stats, key) {
  return perMinute(obj(obj(stats)[`${key}_details`]).rate) ?? 0;
}

// The alarm names, stable: they are the `alarm` variable of the scene
// triggers.
export const ALARM = {
  MEMORY: 'memory',
  DISK: 'disk',
  PARTITION: 'partition',
  NODE_DOWN: 'node_down',
};

/**
 * @param {unknown} overview the body of GET /api/overview
 * @param {unknown} nodes the body of GET /api/nodes
 */
export function parseBroker(overview, nodes) {
  const o = obj(overview);
  const totals = obj(o.object_totals);
  const queued = obj(o.queue_totals);
  const stats = o.message_stats && typeof o.message_stats === 'object' ? o.message_stats : null;
  const list = Array.isArray(nodes) ? nodes.filter((node) => node && typeof node === 'object') : [];
  const running = list.filter((node) => node.running === true);
  // The cluster runs since its youngest running node started: a restart of
  // any node shows.
  const uptimes = running.map((node) => num(node.uptime)).filter((value) => value !== null);
  const alarms = [];
  for (const node of list) {
    const name = typeof node.name === 'string' ? node.name : '';
    if (node.running === false) {
      alarms.push({ name: ALARM.NODE_DOWN, node: name });
      continue;
    }
    if (node.mem_alarm === true) {
      alarms.push({ name: ALARM.MEMORY, node: name });
    }
    if (node.disk_free_alarm === true) {
      alarms.push({ name: ALARM.DISK, node: name });
    }
    if (Array.isArray(node.partitions) && node.partitions.length > 0) {
      alarms.push({ name: ALARM.PARTITION, node: name });
    }
  }
  // queue_totals is {} while the broker has no queue (0 then), and also when
  // the metrics collector is disabled (message_stats gone too: unknown).
  const noQueue = stats !== null && Object.keys(queued).length === 0;
  return {
    version: typeof o.rabbitmq_version === 'string' ? o.rabbitmq_version : null,
    clusterName: typeof o.cluster_name === 'string' ? o.cluster_name : null,
    nodesTotal: list.length,
    nodesRunning: running.length,
    nodeUptimes: Object.fromEntries(
      running
        .filter((node) => typeof node.name === 'string' && num(node.uptime) !== null)
        .map((node) => [node.name, node.uptime]),
    ),
    uptimeSeconds: uptimes.length > 0 ? Math.floor(Math.min(...uptimes) / 1000) : null,
    connections: num(totals.connections),
    channels: num(totals.channels),
    consumers: num(totals.consumers),
    queues: num(totals.queues),
    messagesReady: num(queued.messages_ready) ?? (noQueue ? 0 : null),
    messagesUnacked: num(queued.messages_unacknowledged) ?? (noQueue ? 0 : null),
    messagesPublished: stats ? rate(stats, 'publish') : null,
    messagesDelivered: stats ? rate(stats, 'deliver_get') : null,
    memoryAlarm: alarms.some((alarm) => alarm.name === ALARM.MEMORY),
    diskAlarm: alarms.some((alarm) => alarm.name === ALARM.DISK),
    alarms,
  };
}

/** The key of an alarm: one alarm of a name per node. */
export const alarmKey = (alarm) => `${alarm.name}@${alarm.node}`;

/**
 * One followed queue.
 * @param {unknown} body the body of GET /api/queues/{vhost}/{name}, null on a 404
 */
export function parseQueue(body) {
  if (!body || typeof body !== 'object') {
    return {
      known: false,
      ready: null,
      unacked: null,
      consumers: null,
      published: null,
      delivered: null,
      type: null,
      state: null,
    };
  }
  const stats =
    body.message_stats && typeof body.message_stats === 'object' ? body.message_stats : {};
  return {
    known: true,
    ready: num(body.messages_ready),
    unacked: num(body.messages_unacknowledged),
    consumers: num(body.consumers),
    // A queue that never got a message has no message_stats: no rate is 0.
    published: rate(stats, 'publish'),
    delivered: rate(stats, 'deliver_get'),
    type: typeof body.type === 'string' ? body.type : null,
    state: typeof body.state === 'string' ? body.state : null,
  };
}
