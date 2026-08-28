---
title: "Build the version you can replace"
summary: "i kept treating simple parts as unfinished architecture. most of them were just waiting for a real reason to change."
date: 2026-08-28
tags: [tech, architecture]
draft: true
---

While writing about how I would build a DNS service, I kept finding things which would not scale forever.

The scheduler picks the nameservers with the fewest zones, which ignores actual query traffic. Publication polls Postgres. The hidden primary is one process and enough zone transfers will eventually need more of them.

I wrote all of this down as problems with the design. Then I read it back and it bothered me.

Of course one process will not scale forever. That does not make it the wrong first process. Each part had an obvious replacement and, more importantly, replacing it did not require replacing the DNS query path with it.

I was judging the first version for not already being the fifth.

I have done this before.

## i wanted the theoretically perfect system

When I joined Excloud, back when it was VaultCI, I applied for frontend and did frontend for maybe two days. Then Arjun explained that he wanted to build the compute platform on Firecracker. I had run some Firecracker experiments on an Oracle VM, said I was interested, and somehow ended up giving it a shot.

I did not know Go. I definitely did not know how to design a cloud.

For the first year I worked very closely with Arjun and he reviewed basically everything I built. I came in wanting to design the theoretically perfect system. If a thing might become distributed one day, I wanted to solve the distributed version now. It felt more correct. Also way more fun.

A lot of the architecture we actually built was Postgres state and reconciliation loops.

That sounded almost too simple to me at first. Put the state in a table. Have a worker repeatedly compare what should exist with what actually exists. Fix the difference. Repeat.

No grand event system. No scheduler which understood every future constraint. Sometimes not even another service, just a package with a loop and a clear bit of state it owned.

But it shipped, and when the loop failed halfway through something, the next pass could look at the full state and try again. I started appreciating that a lot.

## postgres and a loop

Take the DNS publication path.

An API changes a record in Postgres and bumps the zone's SOA serial. A reconciler notices the new desired state and gets it onto the authoritative nameservers.

The dumb version polls every few seconds.

```text
desired state in Postgres
          |
          v
      reconciler
          |
          v
authoritative serving state
```

There are many ways to make this more impressive. I could put every mutation through an event bus, partition the consumers by zone and build retries and replay before the first customer has changed a record.

Or poll the table.

Polling repeats work and adds a few seconds of latency. It also has a nice property: the database contains the complete answer. If a worker crashes after writing one file out of three, the next pass does not need to reconstruct what happened from a chain of events. It compares desired and actual state again.

This only stays a good decision because the loop is not welded to everything around it. The API owns desired state. The nameserver owns serving state. The reconciler moves one toward the other.

If polling eventually becomes expensive, put a transactional outbox beside the state update and feed queue workers from it. Keep the full reconciliation loop at a slower interval for repairs.

The nameserver does not care whether a poller or queue worker noticed serial `1042`. The API does not care which one published it. That is the bit I was missing when I thought "simple" meant temporary.

The poller is replaceable without being fake.

## okay, but when do we replace it?

This is where "we can improve it later" usually gets a bit hand-wavy.

Later when?

If the API commits serial `1042`, but one nameserver is still serving `1041`, I need to know that. Every serving cluster should report the serial it actually loaded, and something outside the cluster should query the real DNS address to verify it.

```text
example.com. desired: 1042

cluster 2  applied: 1042
cluster 7  applied: 1042
cluster 9  applied: 1041
```

Now "the poller is fine" is something we can check. We can measure how long publication takes, how often a cluster falls behind and how much load those reconciliation queries put on Postgres.

If almost every change publishes quickly and Postgres barely notices, adding Kafka has not solved a problem. It has moved the same path into a system with more nouns.

If the pollers are hammering the database or the interval is holding latency back, okay. The queue has finally earned its existence.

The same measurements can eventually improve the scheduler too, but that is a separate problem and the DNS post already has enough scheduler in it.

The mistake would be having no applied serials, no publication timings and no idea whether polling is hurting anything, then replacing it because the architecture diagram looked insufficiently distributed.

I have absolutely been attracted to that diagram.

This does not require an interface in front of every function. The useful boundary here exists because desired state, publication and serving fail differently. Inside each part, normal code is fine. A boundary can begin as a package and a table instead of another repository, network call and Kubernetes deployment.

I care much more about what a successful write means, which component owns the state and whether serving continues during a control-plane outage. The first queue library does not deserve the same emotional investment.

So I went back to the DNS post and stopped describing the polling reconciler as failed queue infrastructure. It works, and there is somewhere clear to go if it stops working.

Some of them might never stop working.

Good. We probably had other shit to build.
