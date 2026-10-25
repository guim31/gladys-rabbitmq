# RabbitMQ for Gladys Assistant

Watches the health of your [RabbitMQ](https://www.rabbitmq.com/) broker in
[Gladys Assistant](https://gladysassistant.com): connections, consumers, messages ready and
unacknowledged, publish and delivery rates, memory and disk alarms, cluster nodes, uptime and
outages, plus the queues you choose to follow.

It reads the HTTP API of the management plugin with a `monitoring` user, every 30 seconds, and never
changes anything on the broker: no publish, no purge, no delete, no AMQP connection. Everything stays
on your local network.

User documentation: [English](docs/en.md), [Français](docs/fr.md), [Deutsch](docs/de.md),
[Español](docs/es.md).

## Features

- **Broker device**: reachable, connections, channels, consumers, queues, messages ready and
  unacknowledged, messages published and delivered per minute, memory alarm, disk alarm, running
  nodes, uptime, version.
- **Followed queues**: one device per queue (up to 20, `name` or `vhost/name`), with messages ready
  and unacknowledged, consumers, messages published and delivered per minute.
- **Scene triggers**: broker unreachable (1 to 60 minutes), broker back, broker restarted, alarm
  raised and cleared (memory, disk, network partition, node stopped), queue without consumer, queue
  above a threshold.
- **Scene actions** "Broker summary" and "Queue summary": a sentence ready for a message and the key
  numbers.
- **Dashboard widget** "RabbitMQ broker": state, version, uptime, nodes, alarms, followed queues and
  four live tiles.
- **Check the connection** action on the configuration page.
- Texts and documentation in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- RabbitMQ 3.x or 4.x (tested with 4.4.0) with the `rabbitmq_management` plugin enabled, its port
  (15672 by default) reachable from Gladys.
- A user with the `monitoring` tag, and a permission (empty patterns are enough) on each virtual host
  of a followed queue:

  ```sh
  rabbitmqctl add_user gladys 'a-long-password'
  rabbitmqctl set_user_tags gladys monitoring
  rabbitmqctl set_permissions -p / gladys '^$' '^$' '^$'
  ```

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-rabbitmq`.
2. Fill in the address of the management interface, the user and its password, and optionally the
   queues to follow.
3. Open the **Discovery** tab and add the broker and the queues.

## Limitations

- Read every 30 seconds: a consumer away for less than a minute fires nothing.
- The rates are the 5-second averages of RabbitMQ, shown per minute.
- 20 followed queues at most; a queue name holding a comma cannot be followed.
- Exchanges, bindings, shovels and federation links are not watched.

## Development

Node.js 22+, ESM, no build step. Only runtime dependency:
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, on the SDK's fake Gladys and a fake RabbitMQ answering with real recorded bodies
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/app.js                handlers: discovery, action, scene actions, widget, configuration
src/hub.js                30 s reading loop, link state, changed states, scene events
src/devices.js            the broker and queue devices, their features and states
src/triggers.js           outages, restarts, alarms, consumers, thresholds
src/scenes.js             "Broker summary" and "Queue summary" scene actions
src/widgets.js            "RabbitMQ broker" dashboard widget
src/i18n.js               every text, in en/fr/de/es
src/rabbitmq/client.js    management API client (HTTP Basic, GET only)
src/rabbitmq/snapshot.js  API answers -> numbers
test/                     node --test; real answers of RabbitMQ 4.4.0 in test/fixtures/rabbitmq/
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table
extracted from the Gladys core.

To run the integration outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="rabbitmq" \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by
hand. A hand-pushed `vX.Y.Z` tag also builds the image and the GitHub Release, but then `version`
in `package.json` and in the manifest (with the `docker_image` tag) must be bumped and committed
before tagging. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [RabbitMQ](https://github.com/rabbitmq/rabbitmq-server) and its
  [management plugin](https://www.rabbitmq.com/docs/management) (HTTP API). The fixtures are answers
  of the official `rabbitmq:4-management` image; no code of RabbitMQ is included.
- Cover: the official RabbitMQ logo (`static/img/rabbitmq-logo-with-name.svg` of the
  [rabbitmq-website](https://github.com/rabbitmq/rabbitmq-website) repository), in white on the
  brand's orange.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Broadcom Inc. or the RabbitMQ project.
"RabbitMQ" is a trademark of Broadcom Inc. and/or its subsidiaries.

## License

[Apache-2.0](LICENSE).
