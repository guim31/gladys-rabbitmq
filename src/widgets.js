// -----------------------------------------------------------------------------
// The "RabbitMQ broker" dashboard widget: the state of the broker, its alarms
// in progress, its followed queues and its key numbers.
//
// Content budget of the core: 8 components, 2 texts at most, 10 rows in a
// status list. Here: 1 status list (state, version, uptime, nodes of a
// cluster, alarms, then the followed queues added to Gladys), up to 4 live
// tiles bound to the broker's features (they follow the published states
// without any refresh), 1 caption. Pre-localized from the viewer's
// `language` (the core caches the content per settings, language and units).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { isConfigured, queueKey } from './config.js';
import { brokerIds } from './devices.js';
import { ALARM_NAMES, formatDuration, formatNumber, pick, relativeTime } from './i18n.js';
import { WIDGET_KEY } from './hub.js';

export const WIDGET = {
  BROKER: WIDGET_KEY,
};

export const CONTENT_TTL_SECONDS = 30;
// Rows of a status list, at most (core budget).
export const MAX_ROWS = 10;
// Alarm rows, at most (the last one sums up the rest).
export const MAX_ALARM_ROWS = 4;

export const TEXT = {
  en: {
    notConfigured:
      'Enter the address of RabbitMQ, a user and its password in the integration configuration.',
    pickBroker: 'Pick the broker in the widget settings.',
    unknownBroker: 'Add the RabbitMQ broker to Gladys first (Discovery tab), then pick it here.',
    broker: 'Broker',
    online: 'Online',
    unreachable: 'Unreachable',
    refused: 'User refused',
    incompatible: 'No management API',
    connecting: 'Connecting…',
    version: 'Version',
    uptime: 'Uptime',
    nodes: 'Nodes',
    alarms: 'Alarms',
    alarm: 'Alarm',
    noAlarm: 'None',
    queueValue: (ready, consumers) => `${ready} ready · ${consumers} cons.`,
    queueMissing: 'Not found',
    queueUnknown: '…',
    moreQueues: (count) => `+${count} more`,
    queues: 'Queues',
    ready: 'Ready',
    published: 'Published /min',
    delivered: 'Delivered /min',
    connections: 'Connections',
    updated: (ago) => `Read ${ago}`,
  },
  fr: {
    notConfigured:
      "Saisissez l'adresse de RabbitMQ, un utilisateur et son mot de passe dans la configuration de l'intégration.",
    pickBroker: 'Choisissez le broker dans les réglages du widget.',
    unknownBroker:
      "Ajoutez d'abord le broker RabbitMQ à Gladys (onglet Découverte), puis choisissez-le ici.",
    broker: 'Broker',
    online: 'En ligne',
    unreachable: 'Injoignable',
    refused: 'Utilisateur refusé',
    incompatible: "Pas d'API de gestion",
    connecting: 'Connexion…',
    version: 'Version',
    uptime: 'En marche depuis',
    nodes: 'Nœuds',
    alarms: 'Alarmes',
    alarm: 'Alarme',
    noAlarm: 'Aucune',
    queueValue: (ready, consumers) => `${ready} prêts · ${consumers} cons.`,
    queueMissing: 'Introuvable',
    queueUnknown: '…',
    moreQueues: (count) => `${count} de plus`,
    queues: 'Files',
    ready: 'Prêts',
    published: 'Publiés /min',
    delivered: 'Livrés /min',
    connections: 'Connexions',
    updated: (ago) => `Lu ${ago}`,
  },
  de: {
    notConfigured:
      'Gib die Adresse von RabbitMQ, einen Benutzer und sein Passwort in der Konfiguration der Integration ein.',
    pickBroker: 'Wähle den Broker in den Einstellungen des Widgets.',
    unknownBroker:
      'Füge den RabbitMQ-Broker zuerst zu Gladys hinzu (Tab „Erkennung“) und wähle ihn dann hier.',
    broker: 'Broker',
    online: 'Online',
    unreachable: 'Nicht erreichbar',
    refused: 'Benutzer abgelehnt',
    incompatible: 'Keine Management-API',
    connecting: 'Verbinde…',
    version: 'Version',
    uptime: 'Laufzeit',
    nodes: 'Knoten',
    alarms: 'Alarme',
    alarm: 'Alarm',
    noAlarm: 'Keine',
    queueValue: (ready, consumers) => `${ready} bereit · ${consumers} Cons.`,
    queueMissing: 'Nicht gefunden',
    queueUnknown: '…',
    moreQueues: (count) => `${count} weitere`,
    queues: 'Queues',
    ready: 'Bereit',
    published: 'Veröffentlicht /min',
    delivered: 'Zugestellt /min',
    connections: 'Verbindungen',
    updated: (ago) => `Gelesen ${ago}`,
  },
  es: {
    notConfigured:
      'Introduzca la dirección de RabbitMQ, un usuario y su contraseña en la configuración de la integración.',
    pickBroker: 'Elija el broker en los ajustes del widget.',
    unknownBroker:
      'Añada primero el broker RabbitMQ a Gladys (pestaña Descubrimiento) y luego elíjalo aquí.',
    broker: 'Broker',
    online: 'En línea',
    unreachable: 'Inaccesible',
    refused: 'Usuario rechazado',
    incompatible: 'Sin API de gestión',
    connecting: 'Conectando…',
    version: 'Versión',
    uptime: 'En marcha desde hace',
    nodes: 'Nodos',
    alarms: 'Alarmas',
    alarm: 'Alarma',
    noAlarm: 'Ninguna',
    queueValue: (ready, consumers) => `${ready} listos · ${consumers} cons.`,
    queueMissing: 'No encontrada',
    queueUnknown: '…',
    moreQueues: (count) => `${count} más`,
    queues: 'Colas',
    ready: 'Listos',
    published: 'Publicados /min',
    delivered: 'Entregados /min',
    connections: 'Conexiones',
    updated: (ago) => `Leído ${ago}`,
  },
};

// The live tiles: feature key, label key, icon.
const TILES = [
  ['messages_ready', 'ready', 'inbox'],
  ['messages_published', 'published', 'upload'],
  ['messages_delivered', 'delivered', 'download'],
  ['connections', 'connections', 'link'],
];

const LINK = {
  connected: ['online', WIDGET_COLORS.SUCCESS],
  refused: ['refused', WIDGET_COLORS.DANGER],
  incompatible: ['incompatible', WIDGET_COLORS.DANGER],
  unreachable: ['unreachable', WIDGET_COLORS.DANGER],
};

// A status value holds 40 characters at most.
const clip = (value) => (value.length > 40 ? `${value.slice(0, 39)}…` : value);

const textContent = (text) => ({
  ttl_seconds: CONTENT_TTL_SECONDS,
  components: [{ type: 'text', variant: 'body', text }],
});

/** The status row of a followed queue. */
function queueRow(text, language, label, read) {
  const n = (value) => (Number.isFinite(value) ? formatNumber(value, language, 0) : '?');
  if (!read) {
    return { label: clip(label), value: text.queueUnknown, icon: 'inbox' };
  }
  if (!read.known) {
    return {
      label: clip(label),
      value: text.queueMissing,
      icon: 'alert-triangle',
      color: WIDGET_COLORS.WARNING,
    };
  }
  return {
    label: clip(label),
    value: clip(text.queueValue(n(read.ready), n(read.consumers))),
    icon: 'inbox',
    // A queue nobody reads piles up its messages.
    color: read.consumers === 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
  };
}

/**
 * Pure builder of the widget content.
 * @param {object} input
 * @param {object} input.gladys
 * @param {string|null} input.link
 * @param {object} input.stats
 * @param {Set<string>} input.features the feature keys of the added device
 * @param {Array<{ label: string, read: object|undefined }>} [input.queues] the
 *   followed queues added to Gladys
 * @param {string} input.language
 * @param {number|null} input.statsAt ms
 * @param {number} input.now ms
 */
export function buildBrokerContent({
  gladys,
  link,
  stats,
  features,
  queues = [],
  language,
  statsAt,
  now,
}) {
  const text = pick(TEXT, language);
  const [stateKey, color] = LINK[link] ?? ['connecting', WIDGET_COLORS.NEUTRAL];
  const items = [{ label: text.broker, value: text[stateKey], icon: 'server', color }];
  if (stats.version) {
    items.push({ label: text.version, value: stats.version, icon: 'tag' });
  }
  const live = link === 'connected';
  if (live && Number.isFinite(stats.uptimeSeconds)) {
    items.push({
      label: text.uptime,
      value: formatDuration(stats.uptimeSeconds, language),
      icon: 'clock',
    });
  }
  if (live && stats.nodesTotal > 1) {
    items.push({
      label: text.nodes,
      value: `${stats.nodesRunning}/${stats.nodesTotal}`,
      icon: 'layers',
      color: stats.nodesRunning < stats.nodesTotal ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  if (live && Array.isArray(stats.alarms)) {
    if (stats.alarms.length === 0) {
      items.push({
        label: text.alarms,
        value: text.noAlarm,
        icon: 'check-circle',
        color: WIDGET_COLORS.SUCCESS,
      });
    } else {
      const names = pick(ALARM_NAMES, language);
      const multi = stats.nodesTotal > 1;
      // One row per alarm, the node only in a cluster; the last row sums up
      // the rest.
      const shown =
        stats.alarms.length <= MAX_ALARM_ROWS
          ? stats.alarms
          : stats.alarms.slice(0, MAX_ALARM_ROWS - 1);
      for (const alarm of shown) {
        items.push({
          label: text.alarm,
          value: clip(`${names[alarm.name] ?? alarm.name}${multi ? ` (${alarm.node})` : ''}`),
          icon: 'alert-triangle',
          color: WIDGET_COLORS.DANGER,
        });
      }
      if (shown.length < stats.alarms.length) {
        items.push({
          label: text.alarms,
          value: text.moreQueues(stats.alarms.length - shown.length),
          icon: 'alert-triangle',
          color: WIDGET_COLORS.DANGER,
        });
      }
    }
  }
  if (live && queues.length > 0) {
    // The rows left for the queues; the last one sums up the rest.
    const room = MAX_ROWS - items.length;
    const shown = queues.length <= room ? queues : queues.slice(0, Math.max(0, room - 1));
    for (const queue of shown) {
      items.push(queueRow(text, language, queue.label, queue.read));
    }
    if (shown.length < queues.length) {
      items.push({
        label: text.queues,
        value: text.moreQueues(queues.length - shown.length),
        icon: 'inbox',
      });
    }
  }
  const components = [{ type: 'status', items }];
  const ids = brokerIds(gladys);
  for (const [key, label, icon] of TILES) {
    if (features.has(key)) {
      components.push({
        type: 'value',
        label: text[label],
        icon,
        device_feature: ids.feature(key),
      });
    }
  }
  if (statsAt !== null) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: text.updated(relativeTime((now - statsAt) / 1000, language)),
    });
  }
  return { ttl_seconds: CONTENT_TTL_SECONDS, components };
}

/**
 * The onWidgetGet handler of the broker widget.
 * @param {import('./hub.js').RabbitHub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function getBrokerWidget(hub, { settings = {}, language = 'en' } = {}) {
  const text = pick(TEXT, language);
  if (!isConfigured(hub.config)) {
    return textContent(text.notConfigured);
  }
  if (!settings.device) {
    return textContent(text.pickBroker);
  }
  const device = hub.addedBroker();
  if (!device || device.external_id !== settings.device) {
    return textContent(text.unknownBroker);
  }
  // Tiles only for the features of the device as added.
  const ids = brokerIds(hub.gladys);
  const added = new Set((device.features ?? []).map((feature) => feature.external_id));
  const features = new Set(TILES.map(([key]) => key).filter((key) => added.has(ids.feature(key))));
  return buildBrokerContent({
    gladys: hub.gladys,
    link: hub.link,
    stats: hub.stats,
    features,
    queues: hub.addedQueues().map(([queue, device]) => ({
      label: device.name || queue.name,
      // A queue whose latest read failed has no fresh numbers.
      read: hub.unreadQueues.has(queueKey(queue)) ? undefined : hub.queues.get(queueKey(queue)),
    })),
    language,
    statsAt: hub.statsAt,
    now: hub.now(),
  });
}
