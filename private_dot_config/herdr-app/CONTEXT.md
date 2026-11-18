# Herdr app

Marc's Herdr setup: layouts and mods (T3, Omarchy) that arrange agent terminals into spaces across machines.

## Language

**Space**:
A named place on one machine, rooted at a folder, holding its tabs.
_Avoid_: Project, workspace

**Machine**:
The computer a space lives on: this computer, or a remote one from `hc machine ls`.
_Avoid_: Environment, host

**Tab**:
A terminal (or mod) inside a space.

**New space**:
Starting a space on a chosen machine at a chosen folder.
_Avoid_: Add project

**New tab**:
Opening a terminal in an existing space.

**Agent status**:
What the core says an agent is doing: working, blocked (needs the person), idle or done. A fixed set; nothing here adds to it.

**Waiting**:
An agent that has handed its next step to a **Watch** and doesn't need the person until it reports back. Not a status: it lies over whatever the status is (working through a long foreground command, idle with its turn parked on a monitor).
_Avoid_: Blocked (that means it needs the person), busy

**Watch**:
An agent's declared wait on an outside thing, such as a long command, a monitor, or a pipeline, with a subject and a start; each terminal has at most one Watch at a time. A pipeline Watch may follow a merge request's current-head pipeline or identify one specific pipeline run.
_Avoid_: Job, task

**Stale Watch**:
A Watch at least two hours old: possibly forgotten, but still shown and counted as waiting. Progress updates do not make it fresh again.

**Pipeline observation**:
The last successfully fetched state of the pipeline followed by a Watch, together with when it was observed. Its freshness is separate from the age of the Watch; a failed refresh leaves an outdated observation, or no observation if none has succeeded.

**Waiting tree**:
An agent with its sub-agents counts as waiting when at least one member has a Watch and no member is working on its own. Needing the person and the root's own unread reply come first. An agent waiting on its own sub-agents has no Watch of its own: it reads as whatever they are doing.

**Open popup**:
The experimental Omarchy inbox popup that offers both: pick a space to get a new tab there, or start a new space.
