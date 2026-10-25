# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-25

### Added

- The RabbitMQ broker (or cluster) as a Gladys device, read from the management API (port 15672,
  a user with the `monitoring` tag) every 30 seconds: reachable, connections, channels, consumers,
  queues, messages ready and unacknowledged, messages published and delivered per minute, memory
  alarm, disk alarm, running nodes, uptime and version.
- Followed queues (up to 20, `name` or `vhost/name`): one device each, with messages ready and
  unacknowledged, consumers, messages published and delivered per minute.
- Scene triggers: broker unreachable for N minutes, broker back, broker restarted, alarm raised,
  alarm cleared (memory, disk, network partition, node stopped), queue without consumer, queue above
  a threshold.
- Scene actions "Broker summary" and "Queue summary": a sentence and the key numbers.
- Dashboard widget "RabbitMQ broker": state, version, uptime, nodes, alarms, followed queues and four
  live tiles.
- "Check the connection" action, and a connection status telling a refused user, an unreachable
  broker or an address without management API apart.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-rabbitmq/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-rabbitmq/releases/tag/v1.0.0
