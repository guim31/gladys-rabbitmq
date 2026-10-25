// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish says "usted" (house rule, enforced by
// test/i18n.test.js). Vocabulary follows the Gladys front translations.
//
// An integration of type "device" does not receive the user's language: the
// feature names, the scene action outputs and the action messages follow the
// `language` field of the configuration (French by default). Widgets get the
// viewer's language with every request.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

/** Pick the text of a language, English as the fallback. */
export function pick(texts, language) {
  return texts[LANGUAGES.includes(language) ? language : 'en'] ?? texts.en;
}

// Feature names, by feature key (src/devices.js). Frozen at device creation
// in Gladys: changing one only affects devices added afterwards.
export const FEATURE_NAMES = {
  en: {
    reachable: 'Reachable',
    connections: 'Connections',
    channels: 'Channels',
    consumers: 'Consumers',
    queues: 'Queues',
    messages_ready: 'Messages ready',
    messages_unacknowledged: 'Messages unacknowledged',
    messages_published: 'Messages published (/min)',
    messages_delivered: 'Messages delivered (/min)',
    memory_alarm: 'Memory alarm',
    disk_alarm: 'Disk alarm',
    nodes_running: 'Running nodes',
    uptime: 'Uptime',
    version: 'Version',
  },
  fr: {
    reachable: 'Joignable',
    connections: 'Connexions',
    channels: 'Canaux',
    consumers: 'Consommateurs',
    queues: 'Files',
    messages_ready: 'Messages prêts',
    messages_unacknowledged: 'Messages non acquittés',
    messages_published: 'Messages publiés (/min)',
    messages_delivered: 'Messages livrés (/min)',
    memory_alarm: 'Alarme mémoire',
    disk_alarm: 'Alarme disque',
    nodes_running: 'Nœuds en marche',
    uptime: 'Durée de fonctionnement',
    version: 'Version',
  },
  de: {
    reachable: 'Erreichbar',
    connections: 'Verbindungen',
    channels: 'Kanäle',
    consumers: 'Consumer',
    queues: 'Queues',
    messages_ready: 'Bereite Nachrichten',
    messages_unacknowledged: 'Unbestätigte Nachrichten',
    messages_published: 'Veröffentlichte Nachrichten (/min)',
    messages_delivered: 'Zugestellte Nachrichten (/min)',
    memory_alarm: 'Speicheralarm',
    disk_alarm: 'Festplattenalarm',
    nodes_running: 'Laufende Knoten',
    uptime: 'Laufzeit',
    version: 'Version',
  },
  es: {
    reachable: 'Accesible',
    connections: 'Conexiones',
    channels: 'Canales',
    consumers: 'Consumidores',
    queues: 'Colas',
    messages_ready: 'Mensajes listos',
    messages_unacknowledged: 'Mensajes sin confirmar',
    messages_published: 'Mensajes publicados (/min)',
    messages_delivered: 'Mensajes entregados (/min)',
    memory_alarm: 'Alarma de memoria',
    disk_alarm: 'Alarma de disco',
    nodes_running: 'Nodos en marcha',
    uptime: 'Tiempo en marcha',
    version: 'Versión',
  },
};

export const QUEUE_FEATURE_NAMES = {
  en: {
    messages_ready: 'Messages ready',
    messages_unacknowledged: 'Messages unacknowledged',
    consumers: 'Consumers',
    messages_published: 'Messages published (/min)',
    messages_delivered: 'Messages delivered (/min)',
  },
  fr: {
    messages_ready: 'Messages prêts',
    messages_unacknowledged: 'Messages non acquittés',
    consumers: 'Consommateurs',
    messages_published: 'Messages publiés (/min)',
    messages_delivered: 'Messages livrés (/min)',
  },
  de: {
    messages_ready: 'Bereite Nachrichten',
    messages_unacknowledged: 'Unbestätigte Nachrichten',
    consumers: 'Consumer',
    messages_published: 'Veröffentlichte Nachrichten (/min)',
    messages_delivered: 'Zugestellte Nachrichten (/min)',
  },
  es: {
    messages_ready: 'Mensajes listos',
    messages_unacknowledged: 'Mensajes sin confirmar',
    consumers: 'Consumidores',
    messages_published: 'Mensajes publicados (/min)',
    messages_delivered: 'Mensajes entregados (/min)',
  },
};

// The alarm names (src/rabbitmq/snapshot.js ALARM), for the sentences and
// the widget.
export const ALARM_NAMES = {
  en: {
    memory: 'memory',
    disk: 'disk space',
    partition: 'network partition',
    node_down: 'node stopped',
  },
  fr: {
    memory: 'mémoire',
    disk: 'espace disque',
    partition: 'partition réseau',
    node_down: 'nœud arrêté',
  },
  de: {
    memory: 'Speicher',
    disk: 'Speicherplatz',
    partition: 'Netzwerkpartition',
    node_down: 'Knoten gestoppt',
  },
  es: {
    memory: 'memoria',
    disk: 'espacio en disco',
    partition: 'partición de red',
    node_down: 'nodo detenido',
  },
};

// Connection status messages (Gladys shows them on the integration page) and
// errors of the actions.
export const MESSAGES = {
  notConfigured: {
    en: 'Enter the address of RabbitMQ, a user and its password in the configuration.',
    fr: "Saisissez l'adresse de RabbitMQ, un utilisateur et son mot de passe dans la configuration.",
    de: 'Gib die Adresse von RabbitMQ, einen Benutzer und sein Passwort in der Konfiguration ein.',
    es: 'Introduzca la dirección de RabbitMQ, un usuario y su contraseña en la configuración.',
  },
  unreachable: {
    en: 'RabbitMQ cannot be reached: check its address (management port, 15672 by default) and that it is running.',
    fr: 'RabbitMQ est injoignable : vérifiez son adresse (port de gestion, 15672 par défaut) et qu’il fonctionne.',
    de: 'RabbitMQ ist nicht erreichbar: Prüfe seine Adresse (Management-Port, standardmäßig 15672) und ob es läuft.',
    es: 'No se puede acceder a RabbitMQ: compruebe su dirección (puerto de gestión, 15672 por defecto) y que esté en marcha.',
  },
  refused: {
    en: 'RabbitMQ refused the user: check its name, its password and that it has the monitoring tag.',
    fr: "RabbitMQ refuse l'utilisateur : vérifiez son nom, son mot de passe et qu'il a le tag monitoring.",
    de: 'RabbitMQ lehnt den Benutzer ab: Prüfe Namen, Passwort und ob er den Tag monitoring hat.',
    es: 'RabbitMQ rechaza el usuario: compruebe su nombre, su contraseña y que tenga la etiqueta monitoring.',
  },
  incompatible: {
    en: 'No management API at this address: enable the rabbitmq_management plugin and point to its port (15672).',
    fr: "Pas d'API de gestion à cette adresse : activez le plugin rabbitmq_management et indiquez son port (15672).",
    de: 'Keine Management-API unter dieser Adresse: Aktiviere das Plugin rabbitmq_management und gib seinen Port an (15672).',
    es: 'No hay API de gestión en esta dirección: active el plugin rabbitmq_management e indique su puerto (15672).',
  },
  startFailed: {
    en: 'The integration could not read its configuration from Gladys: see its logs.',
    fr: "L'intégration n'a pas pu lire sa configuration dans Gladys : consultez ses journaux.",
    de: 'Die Integration konnte ihre Konfiguration nicht aus Gladys lesen: Sieh dir ihre Protokolle an.',
    es: 'La integración no pudo leer su configuración en Gladys: consulte sus registros.',
  },
  publishFailed: {
    en: 'Gladys refused the RabbitMQ devices: see the integration logs.',
    fr: "Gladys a refusé les appareils RabbitMQ : consultez les journaux de l'intégration.",
    de: 'Gladys hat die RabbitMQ-Geräte abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'Gladys rechazó los dispositivos de RabbitMQ: consulte los registros de la integración.',
  },
  unknownQueue: {
    en: 'Pick a followed queue added to Gladys.',
    fr: 'Choisissez une file suivie et ajoutée à Gladys.',
    de: 'Wähle eine beobachtete Queue, die zu Gladys hinzugefügt ist.',
    es: 'Elija una cola seguida y añadida a Gladys.',
  },
};

// The "Check the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (url, version) => `Connected to ${url} (RabbitMQ ${version}).`,
    numbers: (connections, queues, ready, unacked) =>
      `${connections} connections, ${queues} queues, ${ready} messages ready and ${unacked} unacknowledged.`,
    alarms: (count) => `${count} alarm(s) in progress.`,
    noAlarm: 'No alarm in progress.',
    queues: (found, total) => `Followed queues: ${found} of ${total} found.`,
    missing: (names) => `Not found (or no permission on their virtual host): ${names}.`,
    down: (url, detail) => `${url} cannot be reached (${detail}).`,
    pending: (url) => `Still reading ${url}: try again in a few seconds.`,
  },
  fr: {
    ok: (url, version) => `Connecté à ${url} (RabbitMQ ${version}).`,
    numbers: (connections, queues, ready, unacked) =>
      `${connections} connexions, ${queues} files, ${ready} messages prêts et ${unacked} non acquittés.`,
    alarms: (count) => `${count} alarme(s) en cours.`,
    noAlarm: 'Aucune alarme en cours.',
    queues: (found, total) => `Files suivies : ${found} sur ${total} trouvées.`,
    missing: (names) => `Introuvables (ou sans permission sur leur hôte virtuel) : ${names}.`,
    down: (url, detail) => `${url} est injoignable (${detail}).`,
    pending: (url) => `Lecture de ${url} en cours : réessayez dans quelques secondes.`,
  },
  de: {
    ok: (url, version) => `Verbunden mit ${url} (RabbitMQ ${version}).`,
    numbers: (connections, queues, ready, unacked) =>
      `${connections} Verbindungen, ${queues} Queues, ${ready} Nachrichten bereit und ${unacked} unbestätigt.`,
    alarms: (count) => `${count} Alarm(e) aktiv.`,
    noAlarm: 'Kein Alarm aktiv.',
    queues: (found, total) => `Beobachtete Queues: ${found} von ${total} gefunden.`,
    missing: (names) =>
      `Nicht gefunden (oder keine Berechtigung für ihren virtuellen Host): ${names}.`,
    down: (url, detail) => `${url} ist nicht erreichbar (${detail}).`,
    pending: (url) => `${url} wird noch gelesen: Versuche es in ein paar Sekunden erneut.`,
  },
  es: {
    ok: (url, version) => `Conectado a ${url} (RabbitMQ ${version}).`,
    numbers: (connections, queues, ready, unacked) =>
      `${connections} conexiones, ${queues} colas, ${ready} mensajes listos y ${unacked} sin confirmar.`,
    alarms: (count) => `${count} alarma(s) activa(s).`,
    noAlarm: 'Ninguna alarma activa.',
    queues: (found, total) => `Colas seguidas: ${found} de ${total} encontradas.`,
    missing: (names) => `No encontradas (o sin permiso en su host virtual): ${names}.`,
    down: (url, detail) => `No se puede acceder a ${url} (${detail}).`,
    pending: (url) => `Leyendo todavía ${url}: vuelva a intentarlo en unos segundos.`,
  },
};

export const SUMMARY_TEXT = {
  en: {
    up: (version, duration) => `RabbitMQ ${version} has been running for ${duration}`,
    connections: (count) => `${count} connections`,
    messages: (ready, unacked) => `${ready} messages ready and ${unacked} unacknowledged`,
    rates: (published, delivered) =>
      `${published} messages published and ${delivered} delivered per minute`,
    alarms: (names) => `alarm in progress: ${names}`,
    noAlarm: 'no alarm',
    unreachable: 'RabbitMQ cannot be reached.',
    refused: 'RabbitMQ refuses the user.',
    noData: 'No data from RabbitMQ yet.',
    queue: (name, ready, consumers) =>
      `Queue ${name}: ${ready} messages ready, consumers: ${consumers}`,
    queueUnacked: (count) => `${count} unacknowledged`,
    queueMissing: (name) => `The queue ${name} does not exist on RabbitMQ.`,
    queueNoData: (name) => `No data on the queue ${name} yet.`,
  },
  fr: {
    up: (version, duration) => `RabbitMQ ${version} fonctionne depuis ${duration}`,
    connections: (count) => `${count} connexions`,
    messages: (ready, unacked) => `${ready} messages prêts et ${unacked} non acquittés`,
    rates: (published, delivered) =>
      `${published} messages publiés et ${delivered} livrés par minute`,
    alarms: (names) => `alarme en cours : ${names}`,
    noAlarm: 'aucune alarme',
    unreachable: 'RabbitMQ est injoignable.',
    refused: "RabbitMQ refuse l'utilisateur.",
    noData: 'Aucune donnée de RabbitMQ pour le moment.',
    queue: (name, ready, consumers) =>
      `File ${name} : ${ready} messages prêts, consommateurs : ${consumers}`,
    queueUnacked: (count) => `${count} non acquittés`,
    queueMissing: (name) => `La file ${name} n'existe pas sur RabbitMQ.`,
    queueNoData: (name) => `Aucune donnée sur la file ${name} pour le moment.`,
  },
  de: {
    up: (version, duration) => `RabbitMQ ${version} läuft seit ${duration}`,
    connections: (count) => `${count} Verbindungen`,
    messages: (ready, unacked) => `${ready} Nachrichten bereit und ${unacked} unbestätigt`,
    rates: (published, delivered) =>
      `${published} Nachrichten veröffentlicht und ${delivered} zugestellt pro Minute`,
    alarms: (names) => `aktiver Alarm: ${names}`,
    noAlarm: 'kein Alarm',
    unreachable: 'RabbitMQ ist nicht erreichbar.',
    refused: 'RabbitMQ lehnt den Benutzer ab.',
    noData: 'Noch keine Daten von RabbitMQ.',
    queue: (name, ready, consumers) =>
      `Queue ${name}: ${ready} Nachrichten bereit, Consumer: ${consumers}`,
    queueUnacked: (count) => `${count} unbestätigt`,
    queueMissing: (name) => `Die Queue ${name} existiert auf RabbitMQ nicht.`,
    queueNoData: (name) => `Noch keine Daten zur Queue ${name}.`,
  },
  es: {
    up: (version, duration) => `RabbitMQ ${version} lleva en marcha ${duration}`,
    connections: (count) => `${count} conexiones`,
    messages: (ready, unacked) => `${ready} mensajes listos y ${unacked} sin confirmar`,
    rates: (published, delivered) =>
      `${published} mensajes publicados y ${delivered} entregados por minuto`,
    alarms: (names) => `alarma activa: ${names}`,
    noAlarm: 'ninguna alarma',
    unreachable: 'No se puede acceder a RabbitMQ.',
    refused: 'RabbitMQ rechaza el usuario.',
    noData: 'Todavía no hay datos de RabbitMQ.',
    queue: (name, ready, consumers) =>
      `Cola ${name}: ${ready} mensajes listos, consumidores: ${consumers}`,
    queueUnacked: (count) => `${count} sin confirmar`,
    queueMissing: (name) => `La cola ${name} no existe en RabbitMQ.`,
    queueNoData: (name) => `Todavía no hay datos de la cola ${name}.`,
  },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export const locale = (language) => LOCALES[language] ?? LOCALES.en;

// Plain spaces: the no-break ones of some locales would surprise a message.
const plainSpaces = (text) => text.replace(/[\u00a0\u202f]/g, ' ');

/** A number with the separators of the language. */
export function formatNumber(value, language, decimals = 0) {
  return plainSpaces(
    new Intl.NumberFormat(locale(language), {
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
    }).format(value),
  );
}

/** "3 days", "5 hours", "12 minutes", "40 seconds", in the language. */
export function formatDuration(seconds, language) {
  const abs = Math.max(0, seconds);
  const [unit, value] =
    abs >= 86400
      ? ['day', Math.floor(abs / 86400)]
      : abs >= 3600
        ? ['hour', Math.floor(abs / 3600)]
        : abs >= 60
          ? ['minute', Math.floor(abs / 60)]
          : ['second', Math.floor(abs)];
  return plainSpaces(
    new Intl.NumberFormat(locale(language), { style: 'unit', unit, unitDisplay: 'long' }).format(
      value,
    ),
  );
}

/** "3 minutes ago", in the language. */
export function relativeTime(seconds, language) {
  const format = new Intl.RelativeTimeFormat(locale(language), { numeric: 'auto' });
  const abs = Math.max(0, seconds);
  if (abs < 60) {
    return format.format(-Math.round(abs), 'second');
  }
  if (abs < 3600) {
    return format.format(-Math.round(abs / 60), 'minute');
  }
  return format.format(-Math.round(abs / 3600), 'hour');
}

/** The alarms in progress, named in the language ("memory, disk space"). */
export function alarmNames(alarms, language) {
  const names = pick(ALARM_NAMES, language);
  return [...new Set(alarms.map((alarm) => names[alarm.name] ?? alarm.name))].join(', ');
}

const sentence = (parts) => {
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/**
 * The broker as one sentence: "RabbitMQ 4.4.0 has been running for 3 days, 5
 * connections, 12 messages ready and 0 unacknowledged, 40 messages published
 * and 40 delivered per minute, no alarm."
 * @param {{ reachable: boolean|null, link: string|null, stats: object }} data
 * @param {string} language
 */
export function brokerSentence({ reachable, link, stats }, language) {
  const text = pick(SUMMARY_TEXT, language);
  if (link === 'refused') {
    return text.refused;
  }
  if (reachable === false || link === 'incompatible') {
    return text.unreachable;
  }
  const n = (value) => formatNumber(value, language, 0);
  const parts = [];
  if (stats.version && Number.isFinite(stats.uptimeSeconds)) {
    parts.push(text.up(stats.version, formatDuration(stats.uptimeSeconds, language)));
  }
  if (Number.isFinite(stats.connections)) {
    parts.push(text.connections(n(stats.connections)));
  }
  if (Number.isFinite(stats.messagesReady) && Number.isFinite(stats.messagesUnacked)) {
    parts.push(text.messages(n(stats.messagesReady), n(stats.messagesUnacked)));
  }
  if (Number.isFinite(stats.messagesPublished) && Number.isFinite(stats.messagesDelivered)) {
    parts.push(text.rates(n(stats.messagesPublished), n(stats.messagesDelivered)));
  }
  if (parts.length === 0) {
    return text.noData;
  }
  if (Array.isArray(stats.alarms)) {
    parts.push(
      stats.alarms.length > 0 ? text.alarms(alarmNames(stats.alarms, language)) : text.noAlarm,
    );
  }
  return sentence(parts);
}

/**
 * A followed queue as one sentence: "Queue zigbee: 12 messages ready,
 * consumers: 1, 2 unacknowledged."
 * @param {{ reachable: boolean|null, link: string|null }} data
 * @param {string} label the queue as the user reads it
 * @param {object|undefined} queue parseQueue()
 * @param {string} language
 */
export function queueSentence({ reachable, link }, label, queue, language) {
  const text = pick(SUMMARY_TEXT, language);
  if (link === 'refused') {
    return text.refused;
  }
  if (reachable === false || link === 'incompatible') {
    return text.unreachable;
  }
  if (!queue) {
    return text.queueNoData(label);
  }
  if (!queue.known) {
    return text.queueMissing(label);
  }
  const n = (value) => (Number.isFinite(value) ? formatNumber(value, language, 0) : '?');
  const parts = [text.queue(label, n(queue.ready), n(queue.consumers))];
  if (queue.unacked > 0) {
    parts.push(text.queueUnacked(n(queue.unacked)));
  }
  return sentence(parts);
}
