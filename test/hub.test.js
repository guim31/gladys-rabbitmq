// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and a fake
// RabbitMQ answering with real recorded bodies: discovery, states, scene
// triggers, outages, the action, the scene actions and the widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { parseQueue, queueKey } from '../src/config.js';
import {
  CONFIG,
  addDevice,
  brokerId,
  createWorld,
  featureId,
  fixture,
  flush,
  queueDeviceId,
  queueFeatureId,
} from './helpers/world.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const keys = (world) => world.gladys.fake.sceneEvents.map((event) => event.key);

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await flush();
}

/**
 * A world with the broker (and the given queues, by config entry) added in
 * Gladys. Each queue answers with the recorded "consumed" queue (1 consumer,
 * nothing ready).
 */
async function addedWorld(t, { queues = [] } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const world = await createWorld({ config: { ...CONFIG, queues: queues.join(',') } });
  t.after(() => world.app.stop());
  for (const key of queues.map(toKey)) {
    world.rabbit.setQueue(key, {});
  }
  await world.hub.poll();
  await addDevice(world, brokerId(world.gladys));
  for (const key of queues.map(toKey)) {
    await addDevice(world, queueDeviceId(world.gladys, key));
  }
  await flush();
  return world;
}

/** A config entry ("zigbee", "iot/a", "/a/b") to its key ("//zigbee", "iot/a", "//a/b"). */
const toKey = (entry) => queueKey(parseQueue(entry));

test('the broker is discovered at the first answer, with Basic credentials', async () => {
  const world = await createWorld();
  try {
    const devices = world.gladys.fake.discoveredDevices;
    assert.deepEqual(
      devices.map((device) => device.external_id),
      [brokerId(world.gladys)],
    );
    assert.equal(devices[0].model, 'RabbitMQ');
    assert.equal(devices[0].features[0].name, 'Joignable');
    const { url, options } = world.rabbit.requests[0];
    assert.match(url, /^http:\/\/rabbitmq\.example:15672\/api\//);
    assert.equal(
      options.authorization,
      `Basic ${Buffer.from(`${CONFIG.username}:${CONFIG.password}`).toString('base64')}`,
    );
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    world.app.stop();
  }
});

test('nothing is discovered while RabbitMQ never answered', async () => {
  const world = await createWorld({ connect: false });
  world.rabbit.down = true;
  await world.gladys.connect();
  await flush();
  try {
    assert.deepEqual(world.gladys.fake.discoveredDevices, []);
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /injoignable/);
  } finally {
    world.app.stop();
  }
});

test('adding the broker publishes every state at once (4.4.0 numbers)', async (t) => {
  const world = await addedWorld(t);
  const { fake } = world.gladys;
  const state = (key) => fake.lastState(featureId(world.gladys, key));
  assert.equal(state('reachable'), 1);
  assert.equal(state('connections'), 2);
  assert.equal(state('channels'), 4);
  assert.equal(state('consumers'), 2);
  assert.equal(state('queues'), 2);
  assert.equal(state('messages_ready'), 1193);
  assert.equal(state('messages_unacknowledged'), 2);
  assert.equal(state('messages_published'), 1188);
  assert.equal(state('messages_delivered'), 600);
  assert.equal(state('memory_alarm'), 0);
  assert.equal(state('disk_alarm'), 0);
  assert.equal(state('nodes_running'), 1);
  assert.equal(state('version'), '4.4.0');
  assert.deepEqual(fake.widgetRefreshes.slice(-1), ['broker']);
});

test('the container reads RabbitMQ itself every 30 s, without any core poll', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  const before = world.rabbit.requests.length;
  world.rabbit.setOverview({ object_totals: { connections: 7, queues: 2 } });
  await tick(t, 30 * SECOND);
  assert.equal(world.rabbit.requests.length, before + 3);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'connections')), 7);
  assert.ok(world.gladys.fake.discoveredDevices.every((device) => device.should_poll === false));
});

test('only the changed states are published', async (t) => {
  const world = await addedWorld(t);
  const before = world.gladys.fake.states.length;
  await tick(t, 30 * SECOND);
  assert.equal(world.gladys.fake.states.length, before);
  world.rabbit.setOverview({
    object_totals: { exchanges: 15, queues: 3, channels: 4, consumers: 2, connections: 2 },
  });
  await tick(t, 30 * SECOND);
  assert.deepEqual(world.gladys.fake.states.slice(before), [
    { device_feature_external_id: featureId(world.gladys, 'queues'), state: 3 },
  ]);
});

test('an outage: Reachable at 0, triggers after 1 and 5 minutes, then back', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.down = true;
  await tick(t, 30 * SECOND);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'reachable')), 0);
  assert.deepEqual(keys(world), []);
  await tick(t, 6 * MINUTE);
  const unreachable = world.gladys.fake.sceneEvents.filter(
    (event) => event.key === 'broker_unreachable',
  );
  assert.deepEqual(
    unreachable.map((event) => event.data.after_minutes),
    ['1', '5'],
  );
  assert.equal(unreachable[0].data.broker, 'RabbitMQ');
  world.rabbit.down = false;
  await tick(t, 30 * SECOND);
  const back = world.gladys.fake.sceneEvents.at(-1);
  assert.equal(back.key, 'broker_back');
  assert.ok(back.data.offline_minutes >= 6);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'reachable')), 1);
});

test('a refused user is not an outage: no trigger, a clear status', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.failWith(401);
  await tick(t, 10 * MINUTE);
  assert.deepEqual(keys(world), []);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'reachable')), 1);
  assert.match(world.gladys.fake.connectionStatus.message.en, /refused the user/);
});

test('a 404 on the API tells that the management plugin is not there', async () => {
  const world = await createWorld({ connect: false });
  world.rabbit.failWith(404, { error: 'not_found' });
  await world.gladys.connect();
  await flush();
  try {
    assert.match(world.gladys.fake.connectionStatus.message.en, /No management API/);
    const ack = await world.gladys.fake.action('check_connection', {});
    assert.equal(ack.success, false);
  } finally {
    world.app.stop();
  }
});

test('the memory alarm fires alarm_raised, then alarm_cleared with its duration', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.setNodes({ mem_alarm: true });
  await tick(t, 30 * SECOND);
  assert.deepEqual(keys(world), ['alarm_raised']);
  assert.deepEqual(world.gladys.fake.sceneEvents[0].data, {
    device: brokerId(world.gladys),
    broker: 'RabbitMQ',
    alarm: 'memory',
    node: 'rabbit@rabbit1',
  });
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'memory_alarm')), 1);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'disk_alarm')), 0);
  await tick(t, 3 * MINUTE);
  world.rabbit.setNodes({ mem_alarm: false, disk_free_alarm: true });
  await tick(t, 30 * SECOND);
  assert.deepEqual(keys(world), ['alarm_raised', 'alarm_raised', 'alarm_cleared']);
  const cleared = world.gladys.fake.sceneEvents.find((event) => event.key === 'alarm_cleared');
  assert.equal(cleared.data.alarm, 'memory');
  assert.ok(cleared.data.duration_minutes >= 3);
  assert.equal(world.gladys.fake.sceneEvents[1].data.alarm, 'disk');
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'memory_alarm')), 0);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'disk_alarm')), 1);
});

test('an alarm already raised at start fires nothing (baseline)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const world = await createWorld({ connect: false });
  t.after(() => world.app.stop());
  world.rabbit.routes[Object.keys(world.rabbit.routes)[1]].body = fixture('nodes-alarms');
  await world.gladys.connect();
  await flush();
  await addDevice(world, brokerId(world.gladys));
  await tick(t, 2 * MINUTE);
  assert.deepEqual(keys(world), []);
  assert.equal(world.gladys.fake.lastState(featureId(world.gladys, 'disk_alarm')), 1);
});

test('a followed queue: its states, then queue_no_consumer after a minute', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  const state = (key) => world.gladys.fake.lastState(queueFeatureId(world.gladys, '//zigbee', key));
  assert.equal(state('consumers'), 1);
  assert.equal(state('messages_ready'), 0);
  assert.equal(state('messages_published'), 600);
  assert.equal(state('messages_delivered'), 600);
  world.rabbit.setQueue('//zigbee', { consumers: 0, messages_ready: 4 });
  await tick(t, 30 * SECOND);
  assert.equal(state('consumers'), 0);
  await tick(t, 30 * SECOND);
  assert.deepEqual(keys(world), []);
  await tick(t, 30 * SECOND);
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: 'queue_no_consumer',
      data: {
        device: queueDeviceId(world.gladys, '//zigbee'),
        queue: 'zigbee',
        queue_name: 'zigbee',
        messages_ready: 4,
      },
    },
  ]);
  // Once per loss: back to a consumer re-arms it.
  await tick(t, 5 * MINUTE);
  assert.equal(keys(world).length, 1);
  world.rabbit.setQueue('//zigbee', { consumers: 2 });
  await tick(t, 30 * SECOND);
  world.rabbit.setQueue('//zigbee', { consumers: 0 });
  for (let i = 0; i < 3; i += 1) {
    await tick(t, 30 * SECOND);
  }
  assert.deepEqual(keys(world), ['queue_no_consumer', 'queue_no_consumer']);
});

test('a consumer that comes back within a minute fires nothing', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  world.rabbit.setQueue('//zigbee', { consumers: 0 });
  await tick(t, 30 * SECOND);
  world.rabbit.setQueue('//zigbee', { consumers: 1 });
  await tick(t, 2 * MINUTE);
  assert.deepEqual(keys(world), []);
});

test('a queue above a threshold fires queue_above per threshold, quietly', async (t) => {
  const world = await addedWorld(t, { queues: ['iot/sensors'] });
  world.rabbit.setQueue('iot/sensors', { messages_ready: 1200 });
  await tick(t, 30 * SECOND);
  assert.deepEqual(
    world.gladys.fake.sceneEvents.map((event) => event.data.above),
    ['10', '50', '100', '500', '1000'],
  );
  assert.equal(world.gladys.fake.sceneEvents[0].data.messages_ready, 1200);
  assert.equal(world.gladys.fake.sceneEvents[0].data.queue, 'iot/sensors');
  // Down and up again within 30 minutes: nothing, then reported when it ends.
  world.rabbit.setQueue('iot/sensors', { messages_ready: 0 });
  await tick(t, 30 * SECOND);
  world.rabbit.setQueue('iot/sensors', { messages_ready: 60 });
  await tick(t, 30 * SECOND);
  assert.equal(keys(world).length, 5);
  await tick(t, 30 * MINUTE);
  assert.deepEqual(
    world.gladys.fake.sceneEvents.slice(5).map((event) => event.data.above),
    ['10', '50'],
  );
});

test('a queue already above at start fires nothing (baseline)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const world = await createWorld({ config: { ...CONFIG, queues: 'zigbee' }, connect: false });
  t.after(() => world.app.stop());
  world.rabbit.setQueue('//zigbee', { messages_ready: 5000, consumers: 0 });
  await world.gladys.connect();
  await flush();
  await addDevice(world, brokerId(world.gladys));
  await addDevice(world, queueDeviceId(world.gladys, '//zigbee'));
  await tick(t, 5 * MINUTE);
  assert.deepEqual(keys(world), []);
});

test('a missing queue: no state, logged as missing, reported by check_connection', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee', 'ghost'] });
  world.rabbit.setQueue('//ghost', null);
  await tick(t, 30 * SECOND);
  assert.equal(world.hub.queues.get('//ghost').known, false);
  // Its last numbers stay as they were: nothing new is published for it.
  const ghost = queueFeatureId(world.gladys, '//ghost', 'consumers');
  const before = world.gladys.fake.states.filter((s) => s.device_feature_external_id === ghost);
  await tick(t, 30 * SECOND);
  assert.equal(
    world.gladys.fake.states.filter((s) => s.device_feature_external_id === ghost).length,
    before.length,
  );
  const ack = await world.gladys.fake.action('check_connection', {});
  assert.match(
    ack.data.message.en,
    /Followed queues: 1 of 2 found\. Not found \(or no permission on their virtual host\): ghost\./,
  );
});

test('a queue name with slashes and spaces keeps a stable, encoded external id', async (t) => {
  const world = await addedWorld(t, { queues: ['iot/sensors/kitchen', '/a b'] });
  const names = world.gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, ['RabbitMQ', 'iot/sensors/kitchen', 'a b']);
  assert.equal(
    world.gladys.fake.discoveredDevices[1].external_id,
    'ext:test-integration:queue:iot%2Fsensors%2Fkitchen',
  );
  assert.equal(
    world.gladys.fake.discoveredDevices[2].external_id,
    'ext:test-integration:queue:%2F%2Fa%20b',
  );
  assert.ok(
    world.rabbit.requests.some(({ url }) => /\/queues\/iot\/sensors%2Fkitchen\?/.test(url)),
  );
  assert.ok(world.rabbit.requests.some(({ url }) => /\/queues\/%2F\/a%20b\?/.test(url)));
});

test('a node whose uptime goes backwards fires broker_restarted', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.setUptime(5 * SECOND);
  await tick(t, 30 * SECOND);
  assert.deepEqual(keys(world), ['broker_restarted']);
  assert.equal(world.gladys.fake.sceneEvents[0].data.node, 'rabbit@rabbit1');
  assert.equal(world.gladys.fake.sceneEvents[0].data.version, '4.4.0');
});

test('a recreated container (new node name, young uptime) fires broker_restarted', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.setNodes({ name: 'rabbit@4f2a9c', uptime: 4000 });
  await tick(t, 30 * SECOND);
  assert.deepEqual(keys(world), ['broker_restarted']);
  assert.equal(world.gladys.fake.sceneEvents[0].data.node, 'rabbit@4f2a9c');
});

test('check_connection reads RabbitMQ now and reports in four languages', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  const ack = await world.gladys.fake.action('check_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /RabbitMQ 4\.4\.0/);
  assert.match(ack.data.message.fr, /Files suivies : 1 sur 1 trouvées/);
  assert.deepEqual(Object.keys(ack.data.message).sort(), ['de', 'en', 'es', 'fr']);
  world.rabbit.down = true;
  const failed = await world.gladys.fake.action('check_connection', {});
  assert.equal(failed.success, false);
  assert.match(failed.error ?? failed.message ?? JSON.stringify(failed), /injoignable/);
});

test('broker_summary gives a sentence and the numbers', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.setNodes({ mem_alarm: true });
  await tick(t, 30 * SECOND);
  const ack = await world.gladys.fake.sceneAction('broker_summary', {});
  const outputs = ack.data.outputs;
  assert.equal(outputs.reachable, true);
  assert.equal(outputs.active_alarms, 1);
  assert.equal(outputs.alarm_names, 'mémoire');
  assert.equal(outputs.version, '4.4.0');
  assert.equal(outputs.messages_ready, 1193);
  assert.match(
    outputs.summary,
    /^RabbitMQ 4\.4\.0 fonctionne depuis .* alarme en cours : mémoire\.$/,
  );
  world.rabbit.down = true;
  await tick(t, 30 * SECOND);
  const down = (await world.gladys.fake.sceneAction('broker_summary', {})).data.outputs;
  assert.equal(down.reachable, false);
  assert.equal(down.summary, 'RabbitMQ est injoignable.');
  assert.equal(down.connections, null);
});

test('queue_summary reads the chosen queue, refuses another device', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  world.rabbit.setQueue('//zigbee', { messages_ready: 7, messages_unacknowledged: 2 });
  await tick(t, 30 * SECOND);
  const ack = await world.gladys.fake.sceneAction('queue_summary', {
    device: queueDeviceId(world.gladys, '//zigbee'),
  });
  assert.deepEqual(ack.data.outputs, {
    summary: 'File zigbee : 7 messages prêts, consommateurs : 1, 2 non acquittés.',
    reachable: true,
    exists: true,
    messages_ready: 7,
    messages_unacknowledged: 2,
    consumers: 1,
    messages_published_per_minute: 600,
    messages_delivered_per_minute: 600,
    queue: 'zigbee',
  });
  const wrong = await world.gladys.fake.sceneAction('queue_summary', {
    device: brokerId(world.gladys),
  });
  assert.equal(wrong.success, false);
  world.rabbit.setQueue('//zigbee', null);
  await tick(t, 30 * SECOND);
  const gone = await world.gladys.fake.sceneAction('queue_summary', {
    device: queueDeviceId(world.gladys, '//zigbee'),
  });
  assert.equal(gone.data.outputs.exists, false);
  assert.equal(gone.data.outputs.consumers, null);
  assert.equal(gone.data.outputs.summary, "La file zigbee n'existe pas sur RabbitMQ.");
});

test('the widget shows the state, the alarms, the queues and live tiles, within the budget', async (t) => {
  const queues = Array.from({ length: 12 }, (_, i) => `q${i}`);
  const world = await addedWorld(t, { queues });
  world.rabbit.setNodes({ mem_alarm: true, disk_free_alarm: true });
  world.rabbit.setQueue('//q1', { consumers: 0, messages_ready: 30 });
  await tick(t, 30 * SECOND);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.gladys.fake.widgetGet('broker', {
      settings: { device: brokerId(world.gladys) },
      language,
    });
    const { content } = ack.data;
    const report = validateWidgetContent(content);
    assert.deepEqual(report.errors ?? [], [], JSON.stringify(report));
    assert.deepEqual(report.warnings ?? [], [], JSON.stringify(report));
    assert.ok(content.components.length <= 8);
    assert.ok(content.components.filter((c) => c.type === 'text').length <= 2);
    const status = content.components[0].items;
    assert.ok(status.length <= 10, `${status.length} rows`);
    assert.equal(status.filter((item) => item.icon === 'alert-triangle').length, 2);
    // State, version, uptime, 2 alarms, 4 queues, then "+8 more".
    assert.equal(status.at(-1).value.includes('8'), true, JSON.stringify(status.at(-1)));
    assert.equal(status[6].color, 'warning', 'q1 has no consumer');
    // Every live tile is bound to a feature of the broker as discovered.
    const discovered = new Set(
      world.gladys.fake.discoveredDevices[0].features.map((feature) => feature.external_id),
    );
    const tiles = content.components.filter((c) => c.device_feature);
    assert.equal(tiles.length, 4);
    for (const component of tiles) {
      assert.ok(discovered.has(component.device_feature), component.device_feature);
    }
  }
});

test('the widget asks for the configuration, the device, or to add the broker', async () => {
  const world = await createWorld({ config: {} });
  try {
    const get = async (settings) =>
      (await world.gladys.fake.widgetGet('broker', { settings, language: 'en' })).data.content
        .components[0].text;
    assert.match(await get({}), /address of RabbitMQ/);
    await world.gladys.fake.configUpdated(CONFIG);
    await flush();
    assert.match(await get({}), /Pick the broker/);
    assert.match(await get({ device: brokerId(world.gladys) }), /Add the RabbitMQ broker/);
  } finally {
    world.app.stop();
  }
});

test('a new list of queues updates the Discovery tab, an old queue is forgotten', async (t) => {
  const world = await addedWorld(t, { queues: ['zigbee'] });
  await world.gladys.fake.configUpdated({ ...CONFIG, queues: 'iot/sensors' });
  await flush();
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((device) => device.name),
    ['RabbitMQ', 'iot/sensors'],
  );
  assert.ok(!world.hub.queues.has('//zigbee'));
});

test('a redirect of a proxy is not an outage: no management API there', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.failWith(301, null);
  await tick(t, 3 * MINUTE);
  assert.deepEqual(keys(world), []);
  assert.match(world.gladys.fake.connectionStatus.message.en, /No management API/);
  const summary = (await world.gladys.fake.sceneAction('broker_summary', {})).data.outputs;
  assert.equal(summary.reachable, false);
});

test('a queue that cannot be read is not republished as fresh', async (t) => {
  const world = await addedWorld(t, { queues: ['flaky'] });
  const device = queueDeviceId(world.gladys, '//flaky');
  world.rabbit.failing.add('queues/%2F/flaky');
  await tick(t, 30 * SECOND);
  assert.ok(world.hub.unreadQueues.has('//flaky'));
  const count = () =>
    world.gladys.fake.states.filter((s) => s.device_feature_external_id.startsWith(device)).length;
  const before = count();
  await world.gladys.fake.deviceCreated(
    world.gladys.fake.discoveredDevices.find((d) => d.external_id === device),
  );
  await flush();
  assert.equal(count(), before);
  world.rabbit.failing.clear();
  await tick(t, 30 * SECOND);
  assert.ok(!world.hub.unreadQueues.has('//flaky'));
});

test('a configuration saved during a slow read is read at once', async (t) => {
  const world = await addedWorld(t);
  world.rabbit.failWith(401);
  await tick(t, 30 * SECOND);
  assert.equal(world.hub.link, 'refused');
  // A slow read is in flight when the user fixes the password.
  let release;
  world.rabbit.gate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = world.hub.poll();
  const saved = world.gladys.fake.configUpdated({ ...CONFIG, password: 'fixed' });
  world.rabbit.failWith(0);
  world.rabbit.gate = null;
  release();
  await slow;
  await saved;
  await flush();
  assert.equal(world.hub.link, 'connected');
});
