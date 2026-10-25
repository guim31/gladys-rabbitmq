// -----------------------------------------------------------------------------
// The configuration, the parsing of real RabbitMQ answers, and the HTTP
// client — the latter against a local server on 127.0.0.1 (no outside
// network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  normalizeConfig,
  normalizeUrl,
  parseQueue as parseQueueEntry,
  parseQueues,
  queueKey,
  queueLabel,
} from '../src/config.js';
import { NODES_PATH, createRabbitClient, httpGet, queuePath } from '../src/rabbitmq/client.js';
import { ALARM, parseBroker, parseQueue } from '../src/rabbitmq/snapshot.js';
import { fixture } from './helpers/world.js';

test('the address accepts a bare host, a port, a full URL and the /api path', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10:15672');
  assert.equal(normalizeUrl(' rabbit.local:8080 '), 'http://rabbit.local:8080');
  assert.equal(normalizeUrl('https://rabbit.example/'), 'https://rabbit.example');
  assert.equal(normalizeUrl('http://rabbit.local:15672/api/'), 'http://rabbit.local:15672');
  assert.equal(normalizeUrl('http://rabbit.local:15672/#/queues'), 'http://rabbit.local:15672');
  assert.equal(
    normalizeUrl('https://u:p@proxy.example/rabbitmq?x=1'),
    'https://proxy.example/rabbitmq',
  );
  assert.equal(normalizeUrl('amqp://rabbit.local:5672'), '');
  assert.equal(normalizeUrl(''), '');
});

test('a queue is "name" in the vhost /, "vhost/name" elsewhere, "/name" for a slash', () => {
  assert.deepEqual(parseQueueEntry('zigbee'), { vhost: '/', name: 'zigbee' });
  assert.deepEqual(parseQueueEntry('iot/sensors'), { vhost: 'iot', name: 'sensors' });
  assert.deepEqual(parseQueueEntry('iot/sensors/kitchen'), {
    vhost: 'iot',
    name: 'sensors/kitchen',
  });
  assert.deepEqual(parseQueueEntry('/a/b'), { vhost: '/', name: 'a/b' });
  assert.deepEqual(parseQueueEntry(' my queue '), { vhost: '/', name: 'my queue' });
  assert.equal(parseQueueEntry('/'), null);
  assert.equal(parseQueueEntry('iot/'), null);
  assert.equal(queueKey({ vhost: '/', name: 'zigbee' }), '//zigbee');
  assert.equal(queueLabel({ vhost: '/', name: 'zigbee' }), 'zigbee');
  assert.equal(queueLabel({ vhost: 'iot', name: 'a' }), 'iot/a');
});

test('the queues: commas, semicolons or lines, no duplicates, 20 at most', () => {
  assert.deepEqual(parseQueues('zigbee, iot/sensors\n/zigbee;  my queue '), [
    { vhost: '/', name: 'zigbee' },
    { vhost: 'iot', name: 'sensors' },
    { vhost: '/', name: 'my queue' },
  ]);
  assert.equal(parseQueues(Array.from({ length: 30 }, (_, i) => `q${i}`).join(',')).length, 20);
  assert.deepEqual(parseQueues(undefined), []);
});

test('the configuration is normalized, French by default', () => {
  assert.deepEqual(normalizeConfig({ url: 'rabbit.local', username: ' u ', password: ' p ' }), {
    url: 'http://rabbit.local:15672',
    username: 'u',
    password: ' p ',
    tls_insecure: false,
    queues: [],
    language: 'fr',
  });
  assert.equal(normalizeConfig(null).language, 'fr');
});

test('the real answers of RabbitMQ 4.4.0 are read', () => {
  const broker = parseBroker(fixture('overview'), fixture('nodes'));
  assert.equal(broker.version, '4.4.0');
  assert.equal(broker.nodesTotal, 1);
  assert.equal(broker.nodesRunning, 1);
  assert.equal(broker.uptimeSeconds, 264);
  assert.equal(broker.connections, 2);
  assert.equal(broker.channels, 4);
  assert.equal(broker.consumers, 2);
  assert.equal(broker.queues, 2);
  assert.ok(Number.isInteger(broker.messagesReady));
  assert.equal(broker.messagesUnacked, 2);
  // 19.8 and 10 per second in the capture.
  assert.equal(broker.messagesPublished, 1188);
  assert.equal(broker.messagesDelivered, 600);
  assert.deepEqual(broker.alarms, []);
  assert.equal(broker.memoryAlarm, false);
  assert.equal(broker.diskAlarm, false);

  const consumed = parseQueue(fixture('queue-consumed'));
  assert.equal(consumed.known, true);
  assert.equal(consumed.consumers, 1);
  assert.equal(consumed.ready, 0);
  assert.equal(consumed.type, 'classic');
  const held = parseQueue(fixture('queue-held'));
  assert.equal(held.type, 'quorum');
  assert.equal(held.unacked, 2);
  assert.ok(held.ready > 1000);
  assert.equal(held.published, 600);
  assert.equal(held.delivered, 0);
});

test('the memory and disk alarms of a real capture', () => {
  const broker = parseBroker(fixture('overview'), fixture('nodes-alarms'));
  assert.equal(broker.memoryAlarm, true);
  assert.equal(broker.diskAlarm, true);
  assert.deepEqual(broker.alarms, [
    { name: ALARM.MEMORY, node: 'rabbit@rabbit1' },
    { name: ALARM.DISK, node: 'rabbit@rabbit1' },
  ]);
});

test('a fresh broker: no queue, no message yet', () => {
  const broker = parseBroker(
    {
      rabbitmq_version: '4.4.0',
      message_stats: {},
      queue_totals: {},
      object_totals: { connections: 0, channels: 0, consumers: 0, queues: 0 },
    },
    fixture('nodes'),
  );
  assert.equal(broker.messagesReady, 0);
  assert.equal(broker.messagesUnacked, 0);
  assert.equal(broker.messagesPublished, 0);
  // The metrics collector disabled: no rate at all.
  assert.equal(parseBroker({ queue_totals: {} }, []).messagesPublished, null);
  const empty = parseQueue({ name: 'q', messages_ready: 0, consumers: 0 });
  assert.equal(empty.published, 0);
});

test('a cluster: running nodes counted, uptime of the youngest node, partitions', () => {
  const nodes = [
    { name: 'rabbit@a', running: true, uptime: 90000000, partitions: [] },
    { name: 'rabbit@b', running: true, uptime: 3600000, partitions: ['rabbit@a'] },
    { name: 'rabbit@c', running: false },
  ];
  const broker = parseBroker({}, nodes);
  assert.equal(broker.nodesTotal, 3);
  assert.equal(broker.nodesRunning, 2);
  assert.equal(broker.uptimeSeconds, 3600);
  assert.deepEqual(broker.alarms, [
    { name: ALARM.PARTITION, node: 'rabbit@b' },
    { name: ALARM.NODE_DOWN, node: 'rabbit@c' },
  ]);
  assert.equal(broker.connections, null);
});

test('a missing queue', () => {
  const gone = parseQueue(null);
  assert.equal(gone.known, false);
  assert.equal(gone.consumers, null);
});

/** A local HTTP server answering with a handler; resolves its base URL. */
async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('the client sends Basic credentials, encodes the vhost and reads JSON', async (t) => {
  const seen = [];
  const url = await serve(t, (req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(req.url.startsWith('/api/nodes') ? fixture('nodes') : fixture('queue-held')),
    );
  });
  const client = createRabbitClient({ url, username: 'gladys', password: 'secret' });
  const nodes = await client.nodes();
  assert.equal(nodes[0].name, 'rabbit@rabbit1');
  assert.equal(seen[0].url, `/api/${NODES_PATH}`);
  assert.equal(seen[0].auth, `Basic ${Buffer.from('gladys:secret').toString('base64')}`);
  await client.queue({ vhost: '/', name: 'sensors/kitchen' });
  assert.match(seen[1].url, /^\/api\/queues\/%2F\/sensors%2Fkitchen\?columns=/);
  assert.equal(queuePath({ vhost: 'iot', name: 'a b' }).split('?')[0], 'queues/iot/a%20b');
});

test('the client sorts the failures: refused, not found, unreachable, not the API', async (t) => {
  const url = await serve(t, (req, res) => {
    if (req.url.startsWith('/api/queues/')) {
      res.statusCode = 404;
      res.end(JSON.stringify(fixture('queue-not-found')));
      return;
    }
    if (req.url.startsWith('/api/overview')) {
      res.end('<html>not json</html>');
      return;
    }
    if (req.url.startsWith('/api/nodes')) {
      res.statusCode = 401;
      res.end(JSON.stringify(fixture('bad-auth')));
      return;
    }
    res.statusCode = 503;
    res.end('{}');
  });
  const client = createRabbitClient({ url, username: 'u', password: 'secret' });
  await assert.rejects(client.nodes(), { kind: 'refused', message: /401 not_authorized/ });
  await assert.rejects(client.overview(), { kind: 'http', message: /JSON/ });
  await assert.rejects(client.request('health/checks/alarms'), { kind: 'unreachable' });
  assert.equal(await client.queue({ vhost: '/', name: 'nope' }), null);
});

test('a closed port and a silent server are unreachable, without the password', async (t) => {
  const closed = createRabbitClient({
    url: 'http://127.0.0.1:1',
    username: 'u',
    password: 'secret',
  });
  await assert.rejects(closed.nodes(), (err) => {
    assert.equal(err.kind, 'unreachable');
    assert.doesNotMatch(err.message, /secret/);
    return true;
  });
  const url = await serve(t, () => {});
  await assert.rejects(
    httpGet(`${url}/api/overview`, { authorization: 'x', tlsInsecure: false, timeoutMs: 50 }),
    /no answer within 50 ms/,
  );
});
