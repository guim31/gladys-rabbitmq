# Recorded answers of RabbitMQ

Real answers of the management API of RabbitMQ 4.4.0 (`rabbitmq:4-management`, 25/10/2026), read with
a user tagged `monitoring`, with the very paths the integration requests (`columns` included). The
broker ran in a throwaway Docker container (host name `rabbit1`), with two queues (`zigbee` in `/`,
classic, one consumer acknowledging; `sensors/kitchen` in `iot`, quorum, one consumer holding two
messages) fed by a real AMQP publisher at 10 messages per second each.

- `overview.json`, `nodes.json`, `queue-consumed.json`, `queue-held.json`: during that traffic.
- `nodes-alarms.json`: after `rabbitmqctl set_vm_memory_high_watermark absolute 50MB` and
  `rabbitmqctl set_disk_free_limit 10000GB` (both alarms raised).
- `queue-not-found.json`: a queue that does not exist (also the answer for a virtual host the user has
  no permission on).
- `bad-auth.json`: a wrong password (HTTP 401).
