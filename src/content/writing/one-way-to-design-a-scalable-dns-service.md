---
title: "One way to design a scalable DNS service"
summary: "i started with one nameserver, got stuck on replication, and found that DNS already had most of the machinery i was trying to invent."
date: 2026-08-29
tags: [tech, dns, architecture]
draft: true
---

Say I want to host `example.com`.

The first version is almost offensively small. I install Knot on a VM, write a zone file, open UDP and TCP port 53, and point the domain at it.

```text
resolver -> authoritative server -> zone file
```

If the zone contains:

```text
example.com.      3600  IN  SOA  ns1.example.net. hostmaster.example.com. (
                                1 3600 600 1209600 300 )
example.com.      3600  IN  NS   ns1.example.net.
api.example.com.   300  IN  A    203.0.113.10
```

then `dig api.example.com A` returns `203.0.113.10`.

That is already a DNS service. It answers DNS correctly, even if it has no redundancy and is unpleasant for anybody else to use. Starting here matters because the shape of the query path is already good: Knot has the zone locally and can answer without waiting for another system.

Before adding anything, it helps to understand what led the query to this VM.

## what happens before the query reaches us

An application usually does not walk the DNS tree itself. It asks a recursive resolver, often one run by an ISP, a company network or a public resolver.

If the resolver has a valid cached answer, our authoritative server sees nothing. It returns the cached record immediately. The record's TTL controls how long that answer may stay in the cache.

On a cache miss, the resolver starts following referrals. Very roughly:

```text
application
    |
    v
recursive resolver
    |
    +-> root servers: who handles .com?
    |
    +-> .com servers: who handles example.com?
    |
    +-> example.com authoritative server: what is api.example.com?
```

The parent zone contains NS records delegating `example.com` to its authoritative nameservers. Those nameservers hold a zone, which is the portion of the DNS tree for which they have complete local knowledge.

The recursive resolver is not part of the service I am building here. Our public servers are authoritative only. Mixing recursion into them would add an unrelated cache, more attack surface and a second job with very different scaling behavior.

This resolver, authority and zone distinction is laid out in [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.html). The message format and record encoding live in [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035.html). They are old documents, but the basic design is still recognizable: resolvers chase referrals and cache answers; authoritative servers answer from their zones.

The caching has an important consequence for our design. Changing a record does not instantly change every answer on the internet. Old answers can remain in recursive caches until their TTL expires. Our job is narrower: get a new, coherent version of the zone onto every authoritative server quickly, answer correctly from then on and make the delay visible.

With one zone on one VM, none of that is difficult. The first real problem is letting somebody else change a record without giving them SSH access.

## the API made writes sane

I could put an HTTP endpoint in front of the zone file. Read the file, add a record, write it back and ask Knot to reload.

Then two requests arrive together. Both read the same old file, both produce a different new file and the last rename wins. I also need to know which customer owns the zone, validate record names and prevent combinations which DNS does not allow.

So I move the desired state into Postgres.

The API authenticates the caller, validates the change and stores one row per RRset. An RRset is all records with the same owner name, type and class. The three `A` records for `api.example.com` belong together because DNS returns and caches them as a set. Treating each address as an unrelated row makes updates much harder to reason about.

Creating a zone is one transaction:

```text
create zone
create initial SOA RRset
create NS RRset
commit
```

Changing a record and changing the zone version should also commit together. We will need that version very soon.

Now the control plane has a clean source of truth.

```text
user -> API -> Postgres
```

I still need to turn those rows into DNS answers.

The shortest path is to write an authoritative server in Go. When it receives a question, it parses the name and type, looks up the RRset in Postgres and writes a DNS response.

I liked this for about five minutes.

## one Postgres restart away from SERVFAIL

The implementation is simple, but the failure mode is terrible.

Every cache miss on the internet now depends on a database query. A slow migration makes DNS slow. An exhausted connection pool makes names disappear. If Postgres restarts, the control plane and the public serving plane fail together.

I could add a cache inside the Go server. Then I need cache invalidation, persistence, negative answers, wildcard behavior, DNSSEC support eventually, and correct DNS response construction around all of it. I am slowly writing an authoritative nameserver because I wanted to avoid configuring one.

This was the point where I got stuck. I wanted Postgres to remain the source of truth, but I did not want Postgres anywhere near a normal DNS query. Copying every change into Knot through an internal API was possible, though it created another distributed write: commit the database, update Knot, decide what success means if one finishes and the other does not.

So I went into research mode.

The useful sentence was sitting in RFC 1034: authoritative information is organized into zones, and those zones can be automatically distributed to the nameservers which provide redundant service for them.

DNS already has a replication protocol.

Actually, it has a few cooperating mechanisms: the SOA serial tells a secondary whether its copy is old, AXFR copies a complete zone, IXFR can copy only the changes, and NOTIFY tells secondaries that they should check now instead of waiting for their next timer.

That was the missing part of the design.

## the SOA record is a version and a set of timers

Every zone has one Start of Authority record. The example above is easier to read with names:

```text
primary:  ns1.example.net.
contact:  hostmaster.example.com.
serial:   1042
refresh:  3600
retry:    600
expire:   1209600
minimum:  300
```

The serial is a 32-bit version number for the whole zone. Every accepted group of changes increments it. A secondary asks the primary for the SOA, compares the returned serial with the one it has and starts a transfer if the primary is newer.

The comparison is slightly stranger than normal integer comparison because a 32-bit serial eventually wraps around. [RFC 1982](https://www.rfc-editor.org/rfc/rfc1982.html) defines the sequence-space arithmetic. In practice, the important rules are boring: increment the serial for every committed zone change, do not casually set it backward and use a library which implements the comparison correctly.

The other fields tell a secondary how to behave when nobody sends it an immediate notification:

- after `refresh` seconds, check the primary again
- if the check fails, retry after `retry` seconds
- if the secondary cannot refresh the zone for `expire` seconds, stop serving the stale copy

The minimum field is now used for negative caching. It helps determine how long a resolver may cache an NXDOMAIN or NODATA response, as specified by [RFC 2308](https://www.rfc-editor.org/rfc/rfc2308.html).

Postgres can now store desired serial `1042`, while every authoritative server reports which serial it has loaded. We no longer have to compare thousands of records to ask whether publication finished.

## AXFR is the full copy

[AXFR](https://www.rfc-editor.org/rfc/rfc5936.html) is an authoritative zone transfer. The secondary asks for a zone and the primary sends the complete set of resource records.

The response begins with the zone's SOA record and ends with the same SOA. Everything between them is the zone. A large transfer spans multiple DNS messages over a TCP connection.

```text
secondary                          primary
    |                                 |
    |--- AXFR example.com ----------->|
    |<-- SOA serial 1042 -------------|
    |<-- NS, A, AAAA, MX, TXT... -----|
    |<-- SOA serial 1042 -------------|
    |                                 |
```

The secondary does not replace its working copy record by record while packets arrive. It receives the transfer, checks it and then makes the new zone active. A failed transfer should leave the previous coherent version serving.

AXFR is wonderfully simple and wasteful. Change one `A` record in a large zone and the secondary may copy the entire zone again. For a small service with small zones, that can be completely fine. Full transfers are easy to inspect, and a secondary joining with no existing copy needs one anyway.

## IXFR sends the history between two serials

Once full transfers become expensive, [IXFR](https://www.rfc-editor.org/rfc/rfc1995.html) gives the secondary a smaller request.

The secondary includes the SOA for the version it already has. If it has serial `1041` and the primary has `1042`, the primary can return the records deleted and added between those versions.

```text
secondary                          primary
    |                                 |
    |--- IXFR, I have serial 1041 --->|
    |<-- delete old api A record -----|
    |<-- add new api A record --------|
    |<-- current serial 1042 ---------|
```

This requires the primary to keep a journal of changes. If it no longer has the history the secondary needs, or the delta would be larger than a full copy, it can fall back to AXFR. IXFR is an optimization, not a separate source of truth.

The fallback keeps IXFR from becoming a requirement for correctness. Start with the mechanism which is hardest to misunderstand. Add a change journal when transfer bytes or publication time show that full copies are hurting. A new server and a badly outdated server still have a path back through AXFR.

## NOTIFY makes it prompt

The SOA refresh timer is enough for eventual convergence, but a one-hour refresh means a record change may sit on the primary for nearly an hour before a secondary asks about it.

Setting the refresh timer to five seconds would make publication faster and make every secondary query the primary constantly, including during the weeks where no records change.

[DNS NOTIFY](https://www.rfc-editor.org/rfc/rfc1996.html) fixes this without turning the timer into polling abuse. When a zone changes, the primary sends a small NOTIFY message to its secondaries. The message is a prompt, not the new zone data. A secondary still performs the normal SOA check and pulls through IXFR or AXFR.

```text
record change commits at serial 1042
              |
              v
primary sends NOTIFY
              |
              v
secondary asks for SOA
              |
              v
secondary pulls IXFR or AXFR
```

If the NOTIFY gets lost, the normal refresh timer repairs it later. If the same NOTIFY arrives twice, comparing the serial makes the second one cheap. The fast path improves latency; the slow path keeps the system convergent.

I like systems with both.

## the primary should not be public

This leads to a much better shape.

The Go DNS server becomes a hidden primary. It knows how to read a zone from Postgres and present it through standard SOA and transfer queries. Public authoritative servers run Knot as secondaries and serve their local copies.

```text
control plane:

user -> API -> Postgres
                  |
                  v
           hidden primary

publication:

hidden primary -- NOTIFY ----------> Knot secondary
hidden primary <-- SOA / IXFR / AXFR -- Knot secondary
hidden primary -- zone data -------> Knot secondary

public queries:

resolver -> Knot secondary -> local zone
```

The hidden primary is not listed in the public delegation. Ordinary resolvers have no reason to know it exists. It can live on a private network and only accept transfer traffic from the authoritative fleet.

Now stop Postgres and ask for `api.example.com` again. Existing records continue to answer because Knot already has serial `1042` locally. New changes cannot publish until the control plane and hidden primary recover, but a control-plane outage is no longer immediately a DNS outage.

That is a much better failure. Stale for a while is very different from gone.

Zone transfers also need authentication. An open AXFR endpoint can hand the entire zone to anyone who asks, and the secondary needs to know that the response came from the primary it trusts.

[TSIG](https://www.rfc-editor.org/rfc/rfc8945.html) adds a message authentication code using a shared secret. It authenticates the two DNS peers and detects modification of messages in transit. I would issue a separate key per zone or per narrowly scoped relationship so one leaked secret does not authorize the whole service.

TSIG is not encryption, and it is not DNSSEC. It protects a transfer between systems which already share a secret. DNSSEC lets resolvers validate the origin and integrity of public DNS data. Those are different jobs.

One public secondary still leaves one public failure.

## three copies before a scheduler

I would add two more authoritative servers and copy every zone to all three.

```text
                         +-> authoritative 1
hidden primary ----------+-> authoritative 2
                         +-> authoritative 3
```

The DNS specifications require at least two servers for a delegated zone, and [RFC 2182](https://www.rfc-editor.org/rfc/rfc2182.html) recommends three for most organization-level zones. Placement matters more than the number alone. Three VMs on the same hypervisor behind the same switch are one failure wearing three process IDs.

Put them in different failure domains and, when possible, on meaningfully different network paths.

This unscheduled version can last for a surprisingly long time. Zones are usually small, authoritative lookups are cheap and every server has the same data. Adding a fourth server means copying everything once, but there is no placement database to corrupt and no scheduler to debug at 3 AM.

I would keep it until the costs become real.

## then copying everything becomes the problem

Eventually a new authoritative server may need hours to transfer every zone before it is useful. A customer receiving absurd query traffic shares the same serving fleet with every quiet zone. One bad deployment or network incident has the largest possible blast radius because every zone lives on the same set.

Now a scheduler has earned a place.

Instead of putting every zone everywhere, assign each zone to a small stable serving set. A serving cell is a logical authoritative identity with its own capacity and failure domain. It may begin as one Knot process behind one unicast address. Later, the same identity can have multiple replicas or multiple anycast sites behind it.

```text
example.com
    |
    +-> cell 2
    +-> cell 7
    +-> cell 9
```

The first scheduler can be boring: choose three healthy cells with the fewest assigned zones, store the assignment with the zone and return those nameservers to the customer.

Counting zones will eventually lie. Ten tiny zones and ten very busy zones both look like ten. That does not make it a bad first scheduler. Once query metrics exist, placement can account for QPS, response size, transfer load and failure-domain diversity.

The assignment must remain stable. Moving a zone changes its NS records and usually its parent delegation. Resolvers cache delegations, so a safe move is a small migration:

1. publish the zone to the new serving set
2. verify that the new set has the current serial
3. update the parent delegation through the registrar
4. keep the old set serving through the delegation TTL
5. remove the old copy after the overlap

Deleting the old copy first creates an outage which lasts exactly as long as somebody cached the old nameservers.

## fixed sets still share failures

Suppose a scheduler repeatedly picks cells 2, 7 and 9 because they are the emptiest. Thousands of zones now have three copies but still share one failure set. If cell 7 has a bad deployment, all of them lose a third of their authority at once. If 2, 7 and 9 share some hidden dependency, all of those zones disappear together.

Shuffle sharding reduces that overlap. Each zone receives a small combination drawn from a larger pool:

```text
zone A -> [cell 1, cell 4, cell 8]
zone B -> [cell 2, cell 4, cell 9]
zone C -> [cell 1, cell 6, cell 9]
```

Zone A and B share cell 4, but not their whole serving set. One bad cell affects many zones a little instead of giving a large group the exact same outage. [AWS describes this idea well in its Route 53 shuffle-sharding write-up](https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/).

The scheduler can prefer combinations with low existing overlap while still respecting capacity and geography. This is more work than sorting by zone count, so I would add it after there are enough cells and zones for correlated placement to matter.

## success needs to mean more than a database commit

The API updates `api.example.com`, commits desired serial `1042` and returns success.

Cell 2 loads `1042`. Cell 7 loads it too. Cell 9 is still serving `1041`.

Did the update work?

The database says yes because it answered a different question. It knows the requested state was accepted. It does not know what an internet resolver can receive right now.

Every serving cell should report the serial it has applied, and an external probe should query each real authoritative address directly.

```text
example.com. desired serial: 1042

cell 2  applied 1042  800ms ago
cell 7  applied 1042  760ms ago
cell 9  applied 1041  14s ago

publication: 2 of 3
```

The API can return once the desired state commits and expose publication status separately. A caller which needs stronger confirmation can wait until every assigned cell reports the new serial. Internally, publication latency, unapplied serial age and failed transfers tell us which part is unhealthy.

I would not trust the agent report alone. Query the same address a resolver reaches and inspect its SOA. This catches cases where the process believes it loaded `1042` but a stale replica, load balancer or routing mistake is serving `1041`.

This observability also tells us when the simple implementation has stopped being enough.

## the queue can still wait

There are two kinds of state to reconcile on an authoritative cell.

The first is assignment: which zones should this cell serve? A small agent can poll Postgres every few seconds, render the Knot configuration and reload only when it changes.

The second is zone content. Once Knot knows it is a secondary for `example.com`, DNS handles that path through NOTIFY, SOA refreshes and transfers.

Polling assignments repeats database reads. It also repairs missed work naturally. If an agent crashes for ten minutes, it does not need a perfect replay of everything which happened while it was gone. It asks what it should serve now and converges.

When the fleet becomes large enough that those polls hurt Postgres, the transaction which changes an assignment can append an event to an outbox. A dispatcher publishes it to a queue and wakes only the affected cells. Keep the full poll at a slower interval because queues lose messages, consumers fail and repair paths are worth having.

```text
API transaction
    |
    +-> update desired state
    +-> append outbox event
                 |
                 v
               queue
                 |
                 v
        targeted reconciliation
```

The queue improves promptness and database load. It should not become the only place where the truth exists.

## where this design gets hurt next

The basic shape is sound, though there are plenty of ways to hurt it. The next changes should come from specific pressure rather than from wanting a larger diagram.

### a transfer storm hits the hidden primary

One hidden primary is fine until a restart, a large batch update or a new serving cell makes hundreds of secondaries transfer at once.

IXFR reduces the bytes when most secondaries are only one or two serials behind. NOTIFY avoids constant low refresh intervals. After that, run multiple hidden primaries, let zones have more than one transfer source and spread refreshes so every secondary does not wake on the same second. Track concurrent transfers, transfer duration and bytes by zone. Those numbers tell us whether we need more primary capacity or whether one enormous customer zone needs separate treatment.

The database behind the primaries needs normal high availability and backups, but it still stays out of the public query path. If all primaries disappear, serving continues from the last transferred versions until the SOA expire timer is reached.

### authoritative traffic outgrows one location

Adding processes behind one load balancer gives more CPU but not geographic reach or protection from losing the location.

The next step is usually to keep the nameserver identity stable and advertise its service address from multiple sites with anycast. Internet routing sends a resolver toward one of the available sites. [RFC 4786](https://www.rfc-editor.org/rfc/rfc4786.html) explains the operational model and its failure modes; [RFC 9199](https://www.rfc-editor.org/rfc/rfc9199.html) discusses the choices available to large authoritative DNS operators.

Anycast makes monitoring harder. A probe in Mumbai and a probe in Frankfurt may reach different instances of the same IP, so both need to exist. Withdrawal behavior, route leaks and partial reachability become DNS problems even when every Knot process is healthy.

### one customer becomes everybody's incident

A hot or attacked zone can consume packet capacity, fill transfer queues or trigger expensive responses on every cell which serves it.

Shuffle sharding limits how many other zones share the exact serving set. Per-zone traffic measurements make the scheduler less naive. At a larger scale, very hot zones can get dedicated capacity while retaining the same external nameserver contract.

This is also where response-rate controls and DDoS capacity enter the design, but they need care. An authoritative server must not become an open recursive resolver, and dropping legitimate repeated queries too aggressively can turn an attack on one name into our own outage.

### the scheduler becomes important enough to fail

The first scheduler can be one process because placement is not in the DNS query path. If it is down, existing zones keep answering. We only stop placing new zones or changing assignments.

When its availability matters, run several scheduler workers which coordinate through durable placement state. Make assignment operations idempotent and protect them with database constraints or leases so two workers cannot give one zone conflicting transitions. The serving cells remain dumb: they reconcile toward the assignment they are given.

Scaling the scheduler does not require redesigning the authoritative server, hidden primary or API. That is the benefit of keeping placement as its own problem.

### customers ask for DNSSEC

TSIG secured the private transfer relationship. It did nothing for a resolver trying to verify that the public answer for `api.example.com` was authentic.

DNSSEC adds signatures and a chain of trust from the parent zone, introduced in [RFC 4033](https://www.rfc-editor.org/rfc/rfc4033.html). Returning RRSIG records is the mechanical part. A hosted service also has to handle keys, signing, rollover, denial-of-existence records and DS coordination with the parent.

That deserves a separate design. Signing can sit in the publication path before a zone reaches public secondaries. Normal queries should still be answered from local authoritative state. I would not bolt signing onto every incoming DNS packet.

## back to one query

After all of this, a resolver asking for `api.example.com` still reaches an authoritative server which answers from a local zone.

The scheduler may be restarting. The queue may be behind. Postgres may be unavailable. A hidden primary may be handling a transfer storm. Existing records should continue answering.

That is the part I would protect while scaling everything around it.

The service can begin as one API, one Postgres instance, one hidden primary and three authoritative servers. Full transfers and a polling reconciler may be enough for much longer than expected. Transfer volume might eventually earn IXFR a journal. A larger fleet might earn the control plane a queue. Global traffic might earn the nameserver addresses an anycast deployment. The order depends on which limit arrives first.

Some services will never need most of that.

The zone file on one VM was not fake scaffolding. It was the first complete version of the same idea: keep authoritative data close to the process answering the query, then improve how that data gets there when the current path gives us a reason.
