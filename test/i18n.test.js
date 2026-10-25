// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code and the four documentation files, which share the same sections.
// German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { FEATURES, QUEUE_FEATURES } from '../src/devices.js';
import {
  ALARM_NAMES,
  FEATURE_NAMES,
  MESSAGES,
  QUEUE_FEATURE_NAMES,
  REPORT_TEXT,
  SUMMARY_TEXT,
  brokerSentence,
  queueSentence,
} from '../src/i18n.js';
import { ALARM } from '../src/rabbitmq/snapshot.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

const renderFunction = (value) =>
  typeof value === 'function'
    ? value('https://rabbitmq.example:15672', '4.4.0', '117', '12')
    : value;

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const options = manifest.config_schema.find((field) => field.key === 'language').options;
  assert.deepEqual(
    options.map((option) => option.value),
    LANGS,
  );
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 40, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the feature names exist in every language, for every feature', () => {
  assert.deepEqual(tableProblems(FEATURE_NAMES, 'FEATURE_NAMES', MAX.featureName), []);
  assert.deepEqual(
    sorted(Object.keys(FEATURE_NAMES.en)),
    sorted(FEATURES.map((feature) => feature.key)),
  );
  assert.deepEqual(tableProblems(QUEUE_FEATURE_NAMES, 'QUEUE_FEATURE_NAMES', MAX.featureName), []);
  assert.deepEqual(
    sorted(Object.keys(QUEUE_FEATURE_NAMES.en)),
    sorted(QUEUE_FEATURES.map((feature) => feature.key)),
  );
  assert.deepEqual(tableProblems(ALARM_NAMES, 'ALARM_NAMES', MAX.status), []);
  assert.deepEqual(sorted(Object.keys(ALARM_NAMES.en)), sorted(Object.values(ALARM)));
});

test('the message tables of the code have the four languages', () => {
  const found = [
    ...Object.entries(MESSAGES).flatMap(([key, value]) =>
      problems(value, `MESSAGES.${key}`, MAX.message),
    ),
    ...tableProblems(SUMMARY_TEXT, 'SUMMARY_TEXT', MAX.message, renderFunction),
    ...tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, renderFunction),
    ...tableProblems(TEXT, 'TEXT', MAX.message, renderFunction),
  ];
  assert.deepEqual(found, []);
});

test('the widget status values and tile labels fit', () => {
  for (const lang of LANGS) {
    for (const key of [
      'online',
      'unreachable',
      'refused',
      'incompatible',
      'connecting',
      'noAlarm',
      'queueMissing',
    ]) {
      assert.ok(TEXT[lang][key].length <= MAX.status, `TEXT.${lang}.${key} is too long`);
    }
    for (const key of [
      'ready',
      'published',
      'delivered',
      'connections',
      'alarms',
      'alarm',
      'nodes',
      'queues',
    ]) {
      assert.ok(TEXT[lang][key].length <= MAX.short, `TEXT.${lang}.${key} is too long`);
    }
  }
});

test('the generated sentences exist in every language', () => {
  const stats = {
    version: '4.4.0',
    uptimeSeconds: 3 * 86400 + 3600,
    connections: 5,
    messagesReady: 12,
    messagesUnacked: 0,
    messagesPublished: 40,
    messagesDelivered: 38,
    alarms: [],
  };
  const sentences = Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      brokerSentence({ reachable: true, link: 'connected', stats }, lang),
    ]),
  );
  assert.deepEqual(problems(sentences, 'brokerSentence', MAX.message), []);
  assert.equal(
    sentences.en,
    'RabbitMQ 4.4.0 has been running for 3 days, 5 connections, 12 messages ready and 0 unacknowledged, 40 messages published and 38 delivered per minute, no alarm.',
  );
  assert.equal(
    sentences.fr,
    'RabbitMQ 4.4.0 fonctionne depuis 3 jours, 5 connexions, 12 messages prêts et 0 non acquittés, 40 messages publiés et 38 livrés par minute, aucune alarme.',
  );
  const alarms = [
    { name: 'memory', node: 'rabbit@a' },
    { name: 'disk', node: 'rabbit@a' },
  ];
  assert.match(
    brokerSentence({ reachable: true, link: 'connected', stats: { ...stats, alarms } }, 'fr'),
    /alarme en cours : mémoire, espace disque\.$/,
  );
  for (const data of [
    { reachable: false, link: 'unreachable', stats },
    { reachable: true, link: 'refused', stats },
    { reachable: null, link: null, stats: {} },
    { reachable: true, link: 'connected', stats: { ...stats, alarms } },
  ]) {
    const other = Object.fromEntries(LANGS.map((lang) => [lang, brokerSentence(data, lang)]));
    assert.deepEqual(problems(other, 'brokerSentence', MAX.message), []);
  }
  const queue = { known: true, ready: 3, unacked: 2, consumers: 1 };
  assert.equal(
    queueSentence({ reachable: true, link: 'connected' }, 'iot/sensors', queue, 'en'),
    'Queue iot/sensors: 3 messages ready, consumers: 1, 2 unacknowledged.',
  );
  for (const read of [queue, { known: false }, undefined]) {
    const other = Object.fromEntries(
      LANGS.map((lang) => [
        lang,
        queueSentence({ reachable: true, link: 'connected' }, 'zigbee', read, lang),
      ]),
    );
    assert.deepEqual(problems(other, 'queueSentence', MAX.message), []);
  }
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Rain', fr: 'Pluie', de: 'Regen' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Rain', fr: 'Pluie', de: '', es: 'Lluvia' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Konto', 'Ihre Station', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation ------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

/** The structure of a doc: the level of each heading, in order. */
const outline = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four docs exist and have the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].trim().length >= 300, `docs/${lang}.md is too short`);
  }
  const reference = outline(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'docs/en.md has few sections');
  for (const lang of LANGS) {
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md sections differ from en`);
  }
});

test('the docs name every trigger, action and widget, and how to create the user', () => {
  const keys = [
    ...manifest.scene_triggers.map((trigger) => trigger.label),
    ...manifest.scene_actions.map((action) => action.label),
    ...manifest.widgets.map((widget) => widget.label),
    ...manifest.actions.map((action) => action.label),
  ];
  for (const lang of LANGS) {
    for (const label of keys) {
      // The label without its "RabbitMQ: " prefix, as the docs write it.
      const name = label[lang].replace(/^RabbitMQ ?: /, '');
      // Case aside: the docs start the name with a capital letter.
      assert.ok(
        docs[lang].toLowerCase().includes(name.toLowerCase()),
        `docs/${lang}.md does not mention "${name}"`,
      );
    }
    assert.match(docs[lang], /set_user_tags/);
    assert.match(docs[lang], /15672/);
  }
});

test('German docs say "du"', () => {
  assert.doesNotMatch(docs.de, POLITE_GERMAN);
});
