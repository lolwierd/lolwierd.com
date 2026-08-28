---
title: "One way to design a scalable DNS service"
summary: "start with one nameserver, keep the query path boring, and add the rest when the previous version gives you a reason."
date: 2026-08-28
tags: [tech, dns, architecture]
draft: true
---

Say I want to host `example.com`.

I put Knot on a VM, write a zone file, point the domain at it and open UDP and TCP port 53.

```text
resolver -> authoritative server -> zone file
```

That is already a DNS service. Not much of one, but `dig api.example.com` gets an answer, which is the important bit.

For one domain this is excellent. Knot loads the zone into memory and answers without consulting anything else. There is no database, no queue and no API to wake me up.

The first problem is not scale.

The first problem is letting somebody else change a record without giving them SSH access.

## the API fixed writes and made reads worse

I could make an API which edits zone files and reloads Knot. Then two changes arrive together, both read the old file, both write a new one and one quietly wins. I also need to know which customer owns which zone and reject bad records before they turn into bad files.

Fine. Put the desired state in Postgres.

The API authenticates the request, validates it and writes one row per RRset. So the three `A` records for `api.example.com` live together as one set instead of three unrelated rows. Updating the set and bumping the zone's SOA serial happens in one transaction.

Creating a zone works the same way. The zone and its initial NS and SOA records either appear together or they do not appear at all.

```text
user -> API -> Postgres
```

Now I need to answer DNS queries from this state. The obvious version is a Go DNS server which looks up the requested RRset in Postgres and writes it into a DNS response.

It works.

Then Postgres restarts and `api.example.com` starts returning `SERVFAIL` along with the control plane. A slow query, an exhausted connection pool or a migration now has a direct line into every customer lookup. Putting a cache in front only means I am slowly writing another authoritative server around the database.

Postgres should describe what DNS ought to serve. It should not be involved in serving every DNS packet.

## oh. DNS already knows how to copy DNS

DNS has its own mechanism for this. A primary can answer an SOA query, a secondary can compare the serial it has, and if it is behind it can transfer the zone.

So the Go server becomes a hidden primary instead. It reads the RRsets from Postgres and translates them into normal DNS resource records. Public authoritative servers run Knot and keep their own local copy of the zone.

```text
control plane:

user -> API -> Postgres -> hidden primary

publication:

hidden primary <--- SOA / transfer request --- authoritative server
hidden primary ---- zone data -------------> authoritative server

queries:

resolver -> authoritative server -> local zone
```

The public servers pull. The API does not call each of them during a customer request.

Each zone can have its own TSIG key, so SOA and transfer requests are signed. The hidden primary is not in the domain's public delegation and has no reason to answer ordinary internet queries.

Now I can stop Postgres and query `api.example.com` again. Existing records still answer because Knot already has them. New changes will not publish until Postgres and the primary come back, but a control-plane outage no longer immediately becomes a DNS outage.

Much better.

There is still only one public server, though. So I add two more and copy every zone to all three.

```text
                     +-> authoritative 1
hidden primary ------+-> authoritative 2
                     +-> authoritative 3
```

This version can last for a surprisingly long time. Zones are small. Authoritative lookups are cheap. Every server has everything, so there is no scheduler to debug and no placement state to recover.

I would keep it this way until it becomes annoying.

## then copying everything became annoying

At some point a new authoritative server has to transfer every zone before it is useful. One customer receiving a stupid amount of traffic shares the exact same serving fleet with everybody else. One bad deployment still has the largest possible blast radius.

Now a scheduler earns its box.

Instead of sending every zone everywhere, give each zone a stable serving set. The first scheduler does not need to know much. Pick three or four healthy clusters with the fewest assigned zones, then store that assignment in the same transaction which creates the zone and return those nameservers.

```text
                           +-> nameserver cluster 2
example.com serving set ---+-> nameserver cluster 7
                           +-> nameserver cluster 9
```

A cluster can begin as one machine behind one unicast address. If query traffic grows, that same identity can later sit in front of several replicas or an anycast cell. Transfer load is separate again: add more hidden primaries without adding more API instances or changing the public query path.

Counting zones is obviously not a great scheduler forever. Ten nearly unused zones and ten extremely popular zones both look like ten. But it is enough until traffic data proves it is not.

Fixed sets have another problem. If a thousand zones all get clusters 2, 7 and 9, those zones share the same failure even though the rest of the fleet is healthy.

This is where shuffle sharding gets useful. Give each zone a small, mostly unique combination drawn from a larger set of serving cells:

```text
zone A -> [cell 1, cell 4, cell 8]
zone B -> [cell 2, cell 4, cell 9]
zone C -> [cell 1, cell 6, cell 9]
```

Zone A and B share cell 4, but they do not share the entire set. A broken or overloaded cell affects both a little instead of giving both the exact same outage. [AWS uses the same basic idea in Route 53](https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/).

The scheduler can now use traffic and failure-domain data to pick combinations with as little overlap as possible. The zone still has a serving set.

Moving a zone between sets is not instant, unfortunately. Nameservers are part of the parent delegation and get cached. The safe move is to publish the zone on the new set first, update the parent delegation through the registrar, wait for old caches and only then remove the old copy.

## the API said success. cluster 9 disagreed.

The API updates `api.example.com`, bumps the SOA serial to `1042` and returns success.

Cluster 2 loads `1042`. Cluster 7 does too. Cluster 9 is still serving `1041`.

Did the update work?

Postgres says yes. A query sent directly to cluster 9 says no. Telling the customer that DNS is eventually consistent and they should wait is not observability.

The serial already gives us the version. Store the desired serial for the zone and have every assigned cluster report the serial it has applied.

```text
zone example.com. desired serial: 1042

cluster 2  applied 1042  800ms ago
cluster 7  applied 1042  760ms ago
cluster 9  applied 1041  14s ago

publication: 2 of 3
```

The API can still return as soon as the desired state commits. Callers which need to wait get a publication-status endpoint. Internally, we can alert on a cluster which stays behind and stop assigning new zones to it.

I would not trust the cluster report alone either. A small external probe should query every authoritative address directly and compare its SOA with the desired serial. That catches the fun case where the local agent reports `1042` but the address customers reach is somehow still serving `1041`.

Publication latency and the oldest unapplied serial now tell us whether polling or transfers are actually slow enough to replace.

## the queue can wait

The first control mechanism can be a poller. Every few seconds, a reconciler on each cluster asks Postgres which zones belong to it and compares that with its local Knot configuration. Record data still comes from the hidden primary through normal SOA refreshes and transfers.

This repeats work. It also fixes a missed update by itself on the next pass, which is a very good property for a small amount of code.

If the fleet gets large enough that all those reads hurt Postgres, or waiting for the next refresh holds publication latency back, the API transaction can also append an event to an outbox. Workers consume those events and prompt the assigned clusters to reconcile or refresh the affected zone immediately.

```text
API transaction
    |
    +-> update zone and serial
    +-> append publication event
                 |
                 v
               queue
                 |
                 v
        refresh workers
```

The state change and event commit together, so the prompt for serial `1042` cannot disappear between the database commit and the queue. I would keep periodic SOA refreshes and run the full reconciler at a slower interval. They repair anything the event path missed.

Maybe the poller never becomes expensive. Then I would leave it alone.

The whole system can still begin as one API, one Postgres instance, one hidden primary and three authoritative servers. Growing one of those parts does not force all the others to grow with it.

After all of that, a resolver asking for `api.example.com` still reaches an authoritative server which answers from local state. The scheduler can be down. The queue can be behind. Postgres can be restarting. The old record should continue answering.

A lot of DNS services will never need shuffle sharding, anycast or a queue. That is fine. The zone file on one VM was not fake scaffolding. It was already a working DNS service.
