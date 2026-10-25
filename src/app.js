// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys), so index.js stays a few lines and the tests drive the very same
// wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { RabbitHub } from './hub.js';
import { MESSAGES } from './i18n.js';
import { SCENE_ACTION, brokerSummary, queueSummary } from './scenes.js';
import { WIDGET, getBrokerWidget } from './widgets.js';

const logger = createLogger({ name: 'rabbitmq-app' });

export const ACTION = {
  CHECK_CONNECTION: 'check_connection',
};

/**
 * @param {object} gladys
 * @param {object} [options] test seams: httpGet, now, timings
 * @returns {{ hub: RabbitHub, stop: () => void }}
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new RabbitHub({
    gladys,
    now: options.now,
    httpGet: options.httpGet,
    timings: options.timings,
  });

  // --- Discovery: the broker and the followed queues, once RabbitMQ answered -----
  gladys.onScanRequest(async () => {
    logger.info('Scan requested');
    await hub.poll();
    await hub.publishDiscovery();
  });

  // --- Read-only devices -----------------------------------------------------------
  gladys.onSetValue(async (device, feature) => {
    throw new Error(`${feature.external_id} is read-only`);
  });

  // No core poll (should_poll: false, the container reads RabbitMQ itself).
  // Registered anyway, for a device that would have been created with
  // polling: nothing to do.
  gladys.onPoll(async () => {});

  // A device just added (or updated) in Gladys: the SDK forgot what it had
  // published and the core dropped the states sent before it existed. Send
  // everything now, and refresh the open widgets.
  const onDeviceChanged = async () => {
    await hub.publish();
    hub.requestWidgetRefresh();
  };
  gladys.onDeviceCreated(onDeviceChanged);
  gladys.onDeviceUpdated(onDeviceChanged);

  // --- Configuration screen action ----------------------------------------------
  gladys.onAction(ACTION.CHECK_CONNECTION, async () => {
    logger.info('Action check_connection');
    return hub.checkConnection();
  });

  // --- Scene actions --------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTION.BROKER_SUMMARY, () => brokerSummary(hub));
  gladys.onSceneAction(SCENE_ACTION.QUEUE_SUMMARY, (fields) => queueSummary(hub, fields));

  // --- Dashboard widget -----------------------------------------------------------
  gladys.onWidgetGet(WIDGET.BROKER, (request) => getBrokerWidget(hub, request));

  // --- Configuration -------------------------------------------------------------
  // A configuration saved while the initial getConfig() is in flight wins
  // over the (older) values it returns.
  let configUpdates = 0;
  gladys.onConfigUpdated(async (raw) => {
    configUpdates += 1;
    logger.info('Configuration updated');
    await hub.configure(normalizeConfig(raw));
  });

  // --- Connection lifecycle (the SDK logs the Gladys link itself) -------------
  gladys.on('connected', async () => {
    try {
      const updates = configUpdates;
      const raw = await gladys.getConfig();
      if (updates !== configUpdates) {
        return;
      }
      await hub.configure(normalizeConfig(raw));
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, MESSAGES.startFailed).catch(() => {});
    }
  });

  return {
    hub,
    stop() {
      hub.stop();
    },
  };
}
