---
title: Proxy tutorial
source: https://egernapp.com/docs/example/proxy
language: en
fetched: 2026-11-20
---

> Step-by-step setup of a proxy configuration.

> Source: https://egernapp.com/docs/example/proxy

# Egern as a Proxy Tool

Egern can serve as a proxy tool to route network traffic. The following examples demonstrate how to add a proxy server and use a remote proxy subscription.

## Using a Proxy Server

### Adding a Shadowsocks Proxy Server

Click `Tools` -> `Proxies` -> `+`, fill in `Name`, `Server`, `Port`, `Method`, and `Password`, then click Save.

![Adding a Shadowsocks Proxy Server](https://egernapp.com/assets/images/02-proxy-01-05a2f13f0abc65f9cb7baf33af7bbbae.png)

### Adding the Proxy Server to a Policy Group

Click `Policy Groups` -> `Proxy` -> `ss` -> `Save`.

![Adding the Proxy Server to a Policy Group](https://egernapp.com/assets/images/02-proxy-02-2ba6fc5aae16ec735732e568ab2ffa52.png)

## Using a Remote Proxy Subscription URL

### Changing Proxy to an External Policy Group

Click `Policy Groups` -> `Proxy` -> `Type` -> `External` -> `Add New URL`, enter the remote proxy's URL address, and click `Save`.

![Changing Proxy to an External Policy Group](https://egernapp.com/assets/images/02-proxy-03-91934057a6f3a10c594e806904876345.png)
