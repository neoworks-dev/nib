---
color: yellow
---
# Sessions

A session is a harness subprocess and an append-only log. `sessionId` is what the board knows;
`nativeSessionId` is the harness's own handle, needed to resume.

One session is at most one card. A card exists before its session does — a goal written down and
not yet launched — so `sessionId` is optional and is filled in when the session starts. That is
also why a directory with no session yet is still a project you can write in.

A session whose process is gone still has a transcript: it reads as detached, and any command
that needs the harness reattaches first. Nothing in the UI asks to be resumed. See
[[event-log]].
