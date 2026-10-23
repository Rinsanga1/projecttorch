# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small teams that run work in projects, Basecamp-style. Confirmed audiences:

- Marketing and creative agencies: client campaigns, design feedback, approvals, deadlines, deliverables.
- Software teams and startups: development work, releases, design discussions, internal coordination.
- Consultants and freelancers: each client's messages, files, tasks and schedule in one place.
- Remote and distributed teams: one home for communication, to-dos, docs and schedules instead of scattered email.
- Educators and nonprofits: programs, volunteers, events, collaborative projects.
- Event planners, architects, publishers, logistics teams: vendors, timelines, files, cross-team work.

Roles in the app: owner, admin, member, client. Clients see a reduced view of a project.

## Product Purpose

Every project gets one home: Message Board, Milestones (tasks and subtasks under one progress bar), Docs & Files, Campfire chat, Schedule, Board (after Fizzy). Progress counts itself from the tasks done. Success is a team that knows where things stand without a status meeting and can stop working at the end of the day.

## Positioning

Calm, opinionated project software that leaves features out on purpose (no Gantt charts, custom fields, read receipts, online dots, sprints, automation builders). Work Can Wait holds notifications outside working hours.

## Operating Context

Used all day in a desktop browser alongside email and chat; checked on phones. Keyboard shortcuts exist (Ctrl/⌘+J jump, ? for shortcuts). Every email the app would send lands in `/inbox` during development. Sign in with a password or Google.

## Capabilities and Constraints

- A React app (Vite on Rolldown, React Router) on a Bun + TypeScript + Effect 4 + Postgres API; local-first after Linear (the browser keeps a synced copy and renders from it). See docs/tech_stack/stack.md.
- Styling: StyleX (user decision), compiled by @stylexjs/unplugin in the Vite build.
- People choose Light, Dark or Match my system appearance in `/my/appearance`.
- Pages must keep working without JavaScript.

## Brand Commitments

- Name: Saintsflow. No logo yet; the wordmark is set as text.
- Visual reference pinned by the user: kargul.studio. Full expression on marketing and signup; the app stays calm and dense.
- Accent: kargul orange `#f99c00`.

## Evidence on Hand

Sample data only (Acme HQ, Website Redesign for Northwind, Marketing Plan). No customers, testimonials, metrics or pricing exist; never invent them.

## Product Principles

1. Calm over urgent: nothing shouts unless it needs attention now.
2. The whole picture in one place: a project page shows every tool at a glance.
3. Fewer features, on purpose: don't add UI for what the product chose not to do.
4. Plain words: controls say what they do.
