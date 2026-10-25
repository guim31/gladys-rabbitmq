# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.

What the integration handles:

- **Secrets**: the user and the password of RabbitMQ, kept by Gladys in the integration
  configuration (the password in a `secret` field, never sent back to the browser). They travel only
  in the `Authorization` header (HTTP Basic) of the requests to RabbitMQ, and are never logged; user
  names or passwords typed in the address are removed from it.
- **`/data`**: nothing is stored. The numbers and the states of the followed queues live in memory.
- **Network**: `GET` requests only, every 30 seconds, to the configured management address (HTTP or
  HTTPS): `/api/overview`, `/api/nodes` and `/api/queues/<vhost>/<name>` for each followed queue.
  Nothing is ever published, purged, deleted or changed on the broker, and no AMQP connection is
  opened; a user with the `monitoring` tag and empty permissions is enough. With "Accept a
  self-signed certificate", the certificate of RabbitMQ is not checked: use it on your own network
  only.
