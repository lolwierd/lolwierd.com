---
title: "Kobo Shenanigans"
summary: "i bought a kobo to read more, then added koreader, a scratchpad, chatgpt and flick-to-turn — somehow it still worked."
date: 2026-08-26T16:50:00
tags: [kobo, koreader]
draft: true
---

I recently bought a Kobo Libra Colour, cause i wanted to read more.. I read on apple books before but increasing my screen time did not sound like a good idea.

As soon as i bought it, i knew i had to install [KOReader](https://koreader.rocks/).

I had stumbled across it years ago, I remember thinking wow, this is sick! Super simple to read in, but also configurable to an incredible extent.

Thanks to the incredible folks who built [NickelMenu](https://pgaskin.net/NickelMenu), installing koreader was a breeze. So...

## Ofc I installed another OS on my e-reader

Ok, KOReader is not actually an OS. But it kinda feels like one.

The reason for it is Lua. Everything inside it is tweakable. Modifying a core feature is as simple as writing a function override for it in a lua file and putting the file in a directory. There is a plugin API, events, widgets, gestures, filesystem access and, if you really want to be stupid about it, access to a surprising amount of the actual hardware underneath.

Perfect.

It is also just a really really really good reader with support for a looottt of formats.

So the original plan was still intact.

I was going to read more.

I just had some small things I had to fix first.

## I just wanted somewhere to write shit down

I am a forgetful man. Even if i put a book down for a mere 2 days i start forgetting the characters and subplots and all.. To fix this I wanted a scratchpad.

A scratchpad to jot down my raw/rough thoughts, so that when i come back to a book - i can pick up right where i left off!

So I made [scratchpad.koplugin](https://github.com/lolwierd/scratchpad.koplugin).

Every book gets a plain text file, identified using the book's partial MD5. There is also one global scratchpad. That's basically it.

```text
book
  |
  +---- partial md5
          |
          v
koreader/scratchpads/<book-id>.txt
```

Later I added sections because scrolling through one massive text file started annoying me.

So now I can do stuff like:

```text
# Characters

Kaladin - depressed bridge man
Dalinar - old guy, probably important

# Things I forgot

what the fuck is a spren again
```

and jump between the headings.

The important part is that the notes are still just `.txt` files. No database. No special format. No sync service. No reason for a scratchpad plugin to become a SaaS. ngl very rare restraint from me.

## Hmm. What if ChatGPT was inside the Kobo?

This thought arrived around the same time.

Sometimes I am reading something technical, historical, philosophical, or just something written by an author who clearly hates normal sentence structure, and I want to ask a question about it.

Normally that means taking my phone out.

Taking my phone out while reading is dangerous.

Twitter is there.

My attention span will simply not survive.

So I made [codex.koplugin](https://github.com/lolwierd/codex.koplugin).

The first version already had device-code login, multi-turn chat, history and actions on highlighted text.

You highlight something in the book and can basically go:

```text
Explain
Summarize
Define terms
Ask about this...
```

and then continue chatting about it.

The slightly cursed part is the authentication.

Instead of requiring an API key, I reused the device-code/OAuth flow used by the Codex tooling, so I can log in with my ChatGPT subscription from another device.

For asking my Kobo why some philosopher decided to use 400 words where 12 would work, it is good enough.

Eventually I added model selection, reasoning settings, web search and self-updates.

At this point I had installed an AI chatbot into an e-reader specifically because I bought the e-reader to avoid distractions.

Excellent.

## I wanted better reading stats

Now, KOReader has a Reading Statistics plugin.

And it is actually very good.

It tracks books, reading time, individual sessions, pages, streaks and a bunch of other stuff.

But I wanted the data outside the Kobo.

I just wanted to interpret it however I wanted.

How much am I reading this week compared to last week?

What time do I normally read?

How long is an average sitting?

Which days do I read the most?

What does an entire year look like?

Which book have I opened eleven times and somehow progressed four percent in?

Fortunately KOReader stores the whole thing in a very normal SQLite database:

```text
statistics.sqlite3
```

There is a `book` table with the aggregate stuff and `page_stat_data` with the actual reading sessions.

Wonderful.

Surely making a little dashboard from a SQLite file would be simple.

## 1 thing I love 2 do is overdo

My first solution was obviously not simple.

I wrote another KOReader plugin.

This one opened `statistics.sqlite3`, walked through the `.sdr` sidecars for books, extracted metadata, progress, highlights and notes, converted the whole thing into my own JSON schema and POSTed it to a server.

The server was a Cloudflare Worker.

The data went into D1.

There was a Svelte frontend.

There were migrations.

There was authentication.

There was full-text search over highlights.

There was eventually an MCP server too because OF COURSE if I had managed to put all my reading data in a database I was going to let an LLM ask questions about it.

The rough architecture looked something like this:

```text
                     statistics.sqlite3
                    /
Kobo -> Lua plugin
                    \
                     .sdr sidecars
                           |
                           v
                     JSON payload
                           |
                           v
                  Cloudflare Worker
                           |
                           v
                           D1
                      /          \
                  dashboard      MCP
```

This worked.

Which is usually the dangerous part.

Because when something works, you can spend a lot of time improving it before noticing the entire idea is dumb.

I had basically built a tiny distributed data pipeline for:

**1 Kobo.**

Used by:

**1 person.**

Me.

KOReader already had the database.

I was reading that database on the weakest machine in the entire architecture, translating it into my own model, pushing it across the internet, validating it, and then reconstructing another database at the other end.

Why????

Eventually I had a better thought.

What if I just moved the fucking SQLite file?

## Oh. KOReader already does WebDAV.

Reading Statistics has cloud sync.

It can sync its own database over WebDAV.

I somehow managed to build an ingest API before properly appreciating that.

Beautiful.

So I deleted almost the entire active architecture.

The current path is basically:

```text
Kobo
 |
 v
KOReader
 |
 | WebDAV
 v
statistics.sqlite3
 |
 v
build-record
 |
 v
record.json
 |
 v
read.lolwierd.com
```

That's it.

Mostly.

KOReader collects the data.

KOReader syncs the database.

My code only starts once that database reaches my server.

A little builder opens it with `bun:sqlite`, filters out garbage, calculates all the weird stats I care about and generates a static `record.json`.

The frontend reads that.

Caddy serves it.

No live database behind the site.

No ingest service.

No API needed for the dashboard.

Much much better.

## Books should have covers. Revolutionary insight.

The plain KOReader database obviously doesn't contain nice cover images.

But the machine generating the dashboard also has my Calibre library.

And Calibre, conveniently, also uses SQLite.

So the builder opens Calibre's `metadata.db`, tries to match each KOReader book with my Calibre library and pulls in covers, tags, publisher, publication year, series info, etc.

ISBN when possible.

Normalized title/author matching otherwise.

If Calibre doesn't have the cover, I try AniList and then Google Books.

Whatever gets found is cached.

So now the actual generated website is almost entirely disposable.

Delete `record.json`?

Build it again.

Delete the covers?

Mostly build them again.

Delete the frontend?

Who cares.

The important thing remains the original KOReader reading database.

I like this setup much more.

I made a tiny `readstatsautosync.koplugin`.

Unlike my original sync plugin, this one barely does anything.

It listens for things like KOReader starting, waking up or Wi-Fi reconnecting and, at most once every 24 hours, triggers KOReader's own `SyncBookStats`.

Before that it removes KOReader's previous sync cache.

For my single-device setup this makes the operation behave much more like a union rather than a deletion-aware reconciliation.

The server is paranoid too.

I first make a clean SQLite snapshot.

Then that gets merged into a canonical copy.

Books are matched by MD5.

Sessions get re-keyed through that MD5 because SQLite row IDs can differ between different copies of the database.

And aggregates basically follow:

```text
canonical = max(canonical, incoming)
```

If I have ever observed 3 hours of reading for a book, a future database claiming 2 hours does not get to win.

This is probably the most serious engineering in the entire project.

Not the Cloudflare Worker.

Not D1.

Not MCP.

Making sure my fucking reading history cannot decrease.

The result is now at [read.lolwierd.com](https://read.lolwierd.com/).

And I am very happy with it.

## Then the home screen annoyed me

Around this point I was also using [Bookshelf](https://github.com/AndyHazz/bookshelf.koplugin), which is a really nice alternative home screen for KOReader.

Covers, series, authors, collections, little modules, basically much nicer than staring at a file browser every time KOReader starts.

I liked it.

There were just some Kobo-specific behaviours around suspend/screensavers/reader state that annoyed me.

So I forked it.

Fixed the stuff bothering me.

Then upstream released new versions.

So I merged upstream.

Then I had more local fixes.

Then upstream released another version.

And now there are commits in my repository called things like:

```text
Merge upstream v3.10.9 into fork; retain local fixes
```

Which is a very funny sentence to exist because I wanted my ebook covers arranged nicely.

I apparently maintain a downstream distribution of my home screen now.

Cool.

## Touching the screen became too much effort

xteink

i saw something cool and I NEED DAT

Everything so far was software.

Naturally I eventually ran out of software problems.

The Libra Colour has an accelerometer.

I knew this because it can rotate the display.

And I had the incredibly important thought:

**Can I flick the Kobo to turn the page?**

Not swipe the screen.

Not press the physical button.

Physically flick the device in my hand.

This became [flickturn.koplugin](https://github.com/lolwierd/flickturn.koplugin).

This one was really fun.

The Libra Colour has a Kionix KX122 accelerometer and its driver exposes the current XYZ readings through sysfs.

So I didn't need to write a kernel module or anything insane.

I could basically read a text file.

At 20 Hz.

The naive version is:

```text
device tilts -> turn page
```

This is unusable.

Because humans move.

You rotate the Kobo into landscape?

Page turns.

Change how you're sitting?

Page turns.

Put it down?

Page turns.

Breathe too enthusiastically?

Probably page turns.

So I recorded actual motion from the device and ended up with a little state machine that looks for an excursion away from the resting orientation and then waits for the device to come back.

The important bit is:

**fire on return, not fire on threshold.**

A deliberate flick goes:

```text
rest -> fast movement -> peak -> back to rest
```

Rotating the reader goes:

```text
rest -> movement -> new rest
```

The first one turns a page.

The second one times out.

Then I found another stupid problem.

If the Kobo is lying flat and you slide it across a table, linear acceleration can look surprisingly similar to rotational motion because the accelerometer alone cannot magically separate every component of movement.

No gyroscope to save me here.

So when the device is flat, I low-pass the gravity vector and require it to show an actual sustained orientation change.

A shove mostly averages out.

A real flick doesn't.

This somehow works shockingly well.

## Ofc it destroyed battery life

Polling an accelerometer 20 times every second requires the Kobo to remain awake.

KOReader normally drops into standby shortly after you stop interacting with it.

My plugin was basically going:

**NO. I NEED TO KNOW IF HE FLICKS.**

Not ideal.

Fortunately the KX122 itself has a hardware tilt interrupt and, even better, it can act as a wake source.

So I added battery saver mode.

The Kobo is allowed to go into normal deep standby.

A sufficiently firm flick triggers the hardware interrupt.

That wakes the device.

Then there is a little post-wake grace window where the software detector catches the gesture that woke it and turns the page when the Kobo returns to its resting position.

I have apparently implemented wake-on-flick.

For an ebook reader.

I regret nothing.

## I should probably read now

So this is where my Kobo currently stands.

I bought it because I wanted a simple dedicated device that would make me read more.

It now has:

- a different reader,
- my own per-book scratchpad,
- ChatGPT,
- a forked home screen with Kobo-specific patches,
- automatic reading-statistics sync,
- a whole reading ledger at [read.lolwierd.com](https://read.lolwierd.com/),
- and a plugin that reads the physical accelerometer because pressing a button apparently became unacceptable.

This sounds like the exact opposite of buying a simple dedicated device.

But weirdly, it worked.

I do read more.

Part of it is definitely the e-ink screen and having a device where there is nothing else I am supposed to be doing.

But I think part of it is also that the Kobo now feels like **my** device.

If something annoys me, there is a reasonable chance I can change it.

If I want some data, I can get it.

If I want some stupid feature that absolutely nobody asked for, I can make it.

There is something very fun about owning hardware that doesn't fight you when you do this.

KOReader deserves most of the credit here. It turns what would otherwise be a nice little appliance into a playground.

Anyway, I bought all of this to read books.

I should probably go do that now.

my reading has definitely decreased.. but thats mostly cause i got fired and i have diverted my reading time to do other things!!
