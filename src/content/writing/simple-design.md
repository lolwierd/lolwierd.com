---
title: "Simple is good, Simple is fast."
summary: "how I think about good design"
date: 2026-08-29
tags: [tech, architecture]
draft: true
---

I used to think good system design meant getting as close as possible to the final design on the first try.

Of course the first version would have fewer machines and less traffic, but the architecture should already know what it wanted to become. If we might need a queue later, why not start with one? If a service might need to run across regions, design the distributed version now. Anything less felt like debt we were knowingly creating.

This is a very satisfying way to design software. You get to solve the interesting problems before the boring one of having users. The diagrams look serious. Every box has an answer for the day the company becomes enormous.

Then I spent a few years building a cloud.

## i kept starting at the end

When I joined Excloud, I did not know how to build a cloud. For the first year I worked closely with Arjun and he reviewed basically everything I built.

I would come into those reviews having thought through the theoretically correct version. Usually this involved more services, more abstractions and some distributed problem we did not have yet. Arjun would keep pulling the discussion back to what the system had to do now.

Not "hack it together and worry later." We still had to know what happened after a crash, who owned the state and what a successful operation actually meant. But we did not have to deploy the answer to every future scale problem along with the first answer.

A lot of what we built was Postgres and reconciliation loops.

The desired state lived in a table. A worker looked at what should exist, compared it with what actually existed and fixed the difference. If it crashed halfway through, the next pass looked at the state again. There was no need to reconstruct the world from twelve events and guess which one had been processed before the crash.

It looked almost disappointingly simple. It also kept working.

Over time, I noticed that the systems which were easiest to improve were rarely the ones with the most extension points. They were the ones where the first version had a small job and owned it clearly.

## simple is not the same as boxed in

We used this pattern in a bunch of places: an API stored some desired state and a worker applied it somewhere else.

The small version can poll the database every few seconds. This is not very clever. It repeats reads when nothing changed and adds up to a few seconds of latency. At enough scale, the polling itself might become a problem.

It can still be a good design.

The database owns desired state. The target system owns actual state. The worker moves one toward the other. If those facts are clear, the polling is just how the worker wakes up.

When polling becomes expensive, add an outbox beside the database write and wake workers through a queue. Keep a slower reconciliation pass to repair missed events. If one worker cannot keep up, partition the work. None of this requires changing what the API promises or what the target system stores.

We did not have to predict the final mechanism. We had to stop the mechanism from becoming the meaning of the system.

There is a bad version of "we can add a queue later" too. The API writes half the state, calls two other services, returns success somewhere in the middle and has no durable record of what remains to be done. Adding a queue to that later will not fix the design. It will distribute the confusion.

The queue is not what separates these designs. One has a durable fact to reconcile toward. The other has an operation spread across several places with no component holding the whole answer.

## some decisions really are expensive

"We can change it later" is also not equally true for every decision.

Changing how a worker wakes up is usually local. Changing what `deleted` means after three services, a CLI and customers have learned the old meaning is not. The same goes for resource identity, ownership, consistency guarantees and public APIs. Those decisions leak into stored data and other people's code.

This is where I now want to spend the design time I used to spend choosing infrastructure. What fact is durable? Can two things both own it? What does the caller know when we return success? If the operation stops halfway through, is there enough information left to finish it?

The implementation can be small without being casual about those answers. In fact, a small implementation makes them easier to see. There are fewer moving parts available to hide a confused model.

## extensible does not mean abstract

I also used to confuse extensibility with abstraction.

If something might have two implementations one day, I wanted an interface today. If we might support another backend, I wanted a plugin system. Configuration accumulated switches for futures nobody had agreed to build.

Most of those extension points were guesses, and guesses age badly. The second implementation eventually arrives with a requirement the first interface made impossible, so the abstraction either leaks or gets replaced. We paid for the flexibility early and still had to redesign it later.

The flexibility which turned out to matter was less visible. Durable state could be inspected after something failed. Operations were safe to try again. Background work did not have to finish before the API could do anything useful. Most importantly, it was clear which part was allowed to change which state.

This does not require a repository per concern or an interface in front of every function. A boundary can be a package, a table and a rule about who is allowed to write it. Splitting it into a network service before that buys us anything mostly gives the failure a longer route.

This sounds obvious written down. It did not feel obvious while I was deleting an interface I had spent an afternoon making beautifully generic.

## "later" needs evidence

There is one obvious hole in this philosophy. Teams say "we will fix it when we hit scale" all the time, then discover they have no idea whether they are near it.

Knowing a design's likely failure mode is part of the design.

If we expect a poller to become too expensive, measure its database load and how long work waits to be noticed. If one scheduler might become a bottleneck, measure whether work is piling up. Every shortcut has some condition under which it is no longer acceptable, and that condition should show up somewhere we can see it.

Then the boring version gets to stay while it is boring. We replace it when a limit shows up in the system, not when somebody feels embarrassed by the architecture diagram.

This is also why observability cannot be postponed until the scalable version. Without it, "simple for now" is just hope. With it, we know which assumption is failing and can change that part instead of redesigning the entire system from vibes.

Sometimes the result is mildly funny. You add the metric which will justify replacing a crude component, watch it for two years and learn that the component is fine. The supposedly temporary Postgres query is not hurting anything. The single worker has most of its day free. The scale problem never arrives in the form you expected.

Good. Nothing is awarded for correctly predicting a bottleneck which never happened.

## what i look for now

I no longer think the first version should resemble the final version. Usually we do not know what the final version is, and pretending otherwise just encodes today's guesses more deeply.

The first version should be complete for the problem in front of it. Its important state needs to survive a crash, and I should be able to tell when one of its shortcuts is becoming a problem. Most of all, changing that shortcut should not change the contract of everything around it.

Database polling may become a queue. One worker may eventually become a sharded pool. An in-process package might earn its own service once it genuinely needs to scale or fail independently. I am fine with all of that. I just do not want to pay for it before it has a job.

This is harder than blindly choosing the simplest implementation, because some simple implementations close every exit behind them. It is also harder than designing the enormous version immediately, because we have to admit that we do not know which enormous version we will need.

I still like clever architecture. I have not developed immunity to a nice distributed systems diagram. I am just much less willing to build one as a prediction.

Build the smallest version which is actually correct. Know where you have taken shortcuts and instrument the assumptions behind them. If the boundaries are in the right places, scale usually asks you to replace one boring part with a more serious one.

And sometimes it never asks. The crude worker keeps waking up, finding a little work and going back to sleep. That is not an unfinished system. It is a problem we got to stop thinking about.
