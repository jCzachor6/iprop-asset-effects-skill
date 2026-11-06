---
tags: [iprop-asset-effects]
max_turns: 150
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

My Infinite Props torch effect in torch/torch.ips jumps every time its loop wraps around, and when my game sets `frames` to 48 its light twitches much faster than at the default. Fix both without changing the look: keep the size, the origin, the palettes, the stick and the sparks. Rewrite torch/torch.iprop when you're done.
