---
title: "journey"
summary: "svit, the cms app, gate, oracle free tier and how a frontend ticket turned into three years building a cloud."
date: 2026-08-26
tags: [log]
draft: true
---

Studied computer engineering from SVIT, VASAD. Was head of web and design - handled the tech side of things for college annual fest - first year where we made an app. So we were approached by the college department to build an app for a CMS system they were developing. last 1.5 years were spent in building and releasing this. SVIT CMS App - cross platform on ios and android. After college i had 1 goal - i wanted to work on things that people would use to build things - foundational software.

Best way to do this - GATE - Figured out 3 months in - cramming is not for me..

tinkering with linux - raspberry pi - understanding internals of linux - learning languages and paradigms - refocused GATE to understanding rather then cramming. oracle offered free 4ocpu and 24 gb ram lifetime free arm servers. 2 of them - started self hosting everything.

After this i thought i was good enough for my dream job... I did part time consulting for small to medium service based tech companies in vadodara. And was looking for a job alongside. couldn't even get interviews.. at the end i got desperate and started applying to every single job i could find.

Excloud - back then vaultci - they had an opening for frontend... i applied and i did frontend for like 1-2 days!

what happened was arjun was explaining he was going to use firecracker to build this - i took an interest and said i had run some experiments with it in the past.. and i had i had run some experiments for firecracker vs docker on my oracle vm. he was like you want to give it a shot. i said yes. i didnt know go, i didnt know the first thing about designing such a complex system.

For the first year or so I was working very closely with Arjun. He reviewed basically everything I built, and that period changed how I think about engineering. I came in wanting to design the theoretically perfect system. What I learned was to design for the scale and requirements you actually have, while understanding the future failure modes and leaving yourself a clean path to solve them later. We deliberately avoided adding distributed infrastructure just because it was fashionable. A lot of our control-plane architecture was Postgres state plus reconciliation loops, with clear boundaries where we could introduce queues or other mechanisms later if the scale justified them.

One regret i have is - i couldn't spare time to learn DC networking.
