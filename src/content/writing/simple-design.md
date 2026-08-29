---
title: "Simple is good, Simple is fast."
summary: "how I think about good design"
date: 2026-08-29
tags: [tech, architecture]
draft: true
---

I used to look at a simple design and immediately start fixing all the problems it would have after becoming wildly successful.

One worker?

What happens when we need twenty?

Polling Postgres?

What happens when the database falls over from all the reads?

One region???

The system had no users.

This did not matter to me.

I wanted to design the theoretically perfect version. The first deployment could be small, sure, but the architecture should already know how it was going to become massive. Anything less felt like debt we were knowingly creating.

Then I spent a few years building a cloud. I was soo naive.

## 1 thing I love 2 do is overdo

When I joined Excloud, I did not know how to build a cloud. For the first year I worked closely with Arjun and he reviewed basically everything I built.

I would come into those reviews with the big version already in my head. More services, more abstractions, some distributed problem we definitely did not have yet. Arjun would keep dragging the discussion back to what the system had to do now.

At first I took this as: keep it simple, do not think too much, we will fix it later.

That was not what he meant.

We spent a loooot of time talking about later.

What happens if this worker crashes halfway through? What state survives? Can we run two of these or will they fight over the same resource? If polling becomes too expensive, where does the queue go? If this package becomes a service, does the rest of the codebase have to change with it?

We wanted answers to those questions.

We just did not need to deploy all the answers.

This difference sounds tiny. It is basically the entire thing.

## Postgres and a loop. Again.

A lot of what we built was desired state in Postgres and a reconciliation loop.

```text
desired state in Postgres
          |
          v
      reconciler
          |
          v
       reality
```

The API says what should exist. A worker looks at what actually exists and fixes the difference. If it crashes after doing half the work, the next pass reads the state and tries again.

The first worker can poll every few seconds.

Very impressive.

Ofc we knew polling had problems. Enough pollers would keep reading the same tables even when nothing changed. A long interval meant more latency. A short interval meant more useless database load. One worker would eventually run out of throughput.

But those were future problems.

The problem we had right then was making the operation survive a crash. So desired state had to be durable, and reconciliation had to be safe to run again. That part was not optional.

Kafka was optional.

Later, if polling starts hurting, the transaction which changes desired state can also write an outbox event. Queue workers can wake up from those events. Keep a slow full reconciliation pass running in the background because queues are not magic and missed events are a thing.

If one worker stops being enough, split work by a stable resource ID and let workers claim partitions or leases.

The resource does not change because twenty workers exist now. The API does not change because the worker learned a new way to wake up. Postgres still contains the answer to what should exist.

That is why the simple version can grow. We had already thought about how it would fail, and that changed where we put the boundaries.

We did not build the future solution.

We made sure the future problem had somewhere to be solved.

## Simple can be very very stupid

There is another version of this which people also call simple.

The API writes some state, calls two services, gets halfway through the second call and times out. It returns an error. Maybe the resource exists. Maybe it exists twice. Maybe the first service thinks it owns it and the second service has never heard of it.

Nothing records what should happen next.

But hey, no background workers. Very clean diagram.

"We can add a queue later" does not help here. What event are we putting in it? Which state is correct? Can the consumer safely retry the operation? Nobody knows. The queue will move the confusion around faster.

This design is small. It is not simple.

A good simple design is still annoyingly precise about some things. Who owns the state? What does success mean? What remains after a crash? Can an operation run twice without making two resources?

These decisions get into everything.

Changing polling into events is local. Changing what `deleted` means after three services, a CLI and customers depend on the old meaning is not. Resource identity, ownership, consistency guarantees and public APIs are all very hard to "fix later".

That is where I would rather spend the design time now.

Not on picking the queue we might use in two years.

## I draw the next version

The thing I do now is design one or two steps past what I actually intend to build.

If the first version has one worker, I sketch how two workers would divide ownership.

If it polls, where would an outbox event be committed?

If it runs in one region, which state becomes painful to move?

Sometimes this immediately exposes a bad foundation. The second worker needs a completely different resource model. Adding a queue requires changing what the API promises. Moving regions breaks every identifier because somebody thought putting the machine name in it was convenient.

Better to find that out while the whole system is still a drawing.

Sometimes I sketch the next version and the current one is already fine.

Wonderful.

Then I go back and build the first version.

No lease table while one worker exists unless correctness needs it. No queue while polling is cheap. No separate service because a package might become important one day.

But also no in-memory job pretending to be durable intent. No identifier which only works on this machine. No control-plane write whose failure leaves us guessing what exists.

The future changes today's design.

It does not have to become today's infrastructure.

## Later when???

"We will solve it when we hit scale" is still hand-wavy nonsense without observability.

If polling is the thing we expect to hurt, measure the database load and how long work waits to be noticed. If one worker is the likely limit, measure how much work is waiting and how long reconciliation takes.

Every shortcut has some point where it stops being acceptable. I want that point to show up in a metric before it shows up as a customer asking why their VM has been creating for forty minutes.

Sometimes the metric sits there for two years and proves that the crude version is fine. The supposedly temporary Postgres query barely registers. The single worker spends most of its life asleep.

Good.

We thought about the problem, made space for its solution, and then got to spend those two years building something else.

That is how I think about good design now.

Simple enough to build fast and simple enough that I can hold the whole thing in my head. But I should also know where it is likely to break, how I will notice and which part changes when it does.

I cannot predict the final version. Half the problems I imagine will never happen, and something much dumber will happen instead.

So I do not build the final version.

I build the first one with a clean path to the second.
