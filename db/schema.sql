-- Saintsflow schema. One file, applied fresh by `bun run db:reset`.
-- Almost everything a person posts is a row in `recordings`:
-- comments, boosts, trash, history, move/copy, bookmarks and search work the same for every type.

create table accounts (
  id          serial primary key,
  name        text not null,
  logo_url    text,
  plan        text not null default 'standard',          -- standard | pro_unlimited
  status      text not null default 'active',            -- trial | active | on_hold | cancelled
  trial_ends_on date,
  cancelled_at timestamptz,
  billing_email text,
  card_last4  text,
  settings    jsonb not null default '{}',                 -- who_can_create_projects, who_can_invite, clients_can_ping, require_2fa
  created_at  timestamptz not null default now()
);

create table companies (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  name        text not null
);

create table people (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  company_id  int references companies on delete set null,
  name        text not null,
  email       text not null,
  title       text,
  bio         text,
  location    text,
  time_zone   text not null default 'UTC',
  avatar_url  text,
  role        text not null default 'member',              -- owner | admin | member | client
  appearance  text not null default 'system',              -- light | dark | system
  prefs       jsonb not null default '{}',                 -- notify_email, notify_desktop, notify_push, wcw{on,days,start,end}, snooze_until, ooo{from,until,message}, recent_searches, two_factor, google
  invited_by  int references people on delete set null,
  invite_token text unique,
  invited_at  timestamptz,
  joined_at   timestamptz,                                 -- null = pending invitation
  removed_at  timestamptz,
  last_active_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (account_id, email)
);

-- A "project" row is any bucket of recordings: a project, a template, HQ, or a Ping conversation.
create table projects (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  kind        text not null default 'project',             -- project | template | ping
  is_hq       boolean not null default false,
  name        text not null default '',
  description text,
  all_access  boolean not null default false,
  clients_see_new boolean not null default false,
  status      text not null default 'active',              -- active | archived | trashed
  trashed_at  timestamptz,
  starts_on   date,
  ends_on     date,
  tools       jsonb not null default '[]',                 -- [{type, name, enabled}] in display order
  created_by  int references people on delete set null,
  created_at  timestamptz not null default now()
);

create table project_people (
  project_id  int not null references projects on delete cascade,
  person_id   int not null references people on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, person_id)
);

create table pins (
  person_id   int not null references people on delete cascade,
  project_id  int not null references projects on delete cascade,
  primary key (person_id, project_id)
);

create table recordings (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  project_id  int not null references projects on delete cascade,
  parent_id   int references recordings on delete cascade,
  type        text not null,  -- message todo folder doc upload cloudfile event column card step line comment
  title       text not null default '',
  body        text not null default '',
  data        jsonb not null default '{}',                 -- type-specific fields, see src/lib/core.ts
  status      text not null default 'active',              -- active | drafted | archived | trashed
  trashed_at  timestamptz,
  position    int not null default 0,
  visible_to_clients boolean not null default false,
  creator_id  int references people on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on recordings (project_id, type, status);
create index on recordings (parent_id);

create table versions (
  id          serial primary key,
  recording_id int not null references recordings on delete cascade,
  title       text not null default '',
  body        text not null default '',
  data        jsonb not null default '{}',
  person_id   int references people on delete set null,
  created_at  timestamptz not null default now()
);

create table subscriptions (
  recording_id int not null references recordings on delete cascade,
  person_id   int not null references people on delete cascade,
  primary key (recording_id, person_id)
);

create table boosts (
  id          serial primary key,
  recording_id int not null references recordings on delete cascade,
  person_id   int not null references people on delete cascade,
  content     text not null check (char_length(content) between 1 and 16),
  created_at  timestamptz not null default now()
);

create table bookmarks (
  id          serial primary key,
  person_id   int not null references people on delete cascade,
  project_id  int references projects on delete cascade,
  recording_id int references recordings on delete cascade,
  created_at  timestamptz not null default now(),
  unique (person_id, project_id, recording_id)
);

create table bubble_ups (
  id          serial primary key,
  person_id   int not null references people on delete cascade,
  recording_id int not null references recordings on delete cascade,
  bubble_at   timestamptz not null,
  surfaced_at timestamptz,
  cancelled_at timestamptz
);

-- Updates: what each person needs to see.
create table notifications (
  id          serial primary key,
  person_id   int not null references people on delete cascade,
  recording_id int references recordings on delete cascade,
  project_id  int references projects on delete cascade,
  actor_id    int references people on delete set null,
  kind        text not null,   -- comment mention assigned completed boost message bubble_up checkin card_added line ping
  summary     text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on notifications (person_id, read_at);

-- Feeds Activity, reports and Mission Control.
create table events (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  project_id  int references projects on delete cascade,
  recording_id int references recordings on delete cascade,
  person_id   int references people on delete set null,
  action      text not null,   -- created completed uncompleted commented edited trashed restored archived moved copied uploaded
  summary     text not null,
  created_at  timestamptz not null default now()
);
create index on events (account_id, created_at desc);

create table categories (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  emoji       text not null default '',
  name        text not null
);

create table markers (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  name        text not null,
  on_date     date not null
);

create table chatbots (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  name        text not null,
  command_url text,
  token       text not null unique,
  created_at  timestamptz not null default now()
);

create table webhooks (
  id          serial primary key,
  project_id  int not null references projects on delete cascade,
  url         text not null,
  types       text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table webhook_deliveries (
  id          serial primary key,
  webhook_id  int not null references webhooks on delete cascade,
  event       text not null,
  status      int,
  error       text,
  created_at  timestamptz not null default now()
);

create table public_links (
  token       text primary key,
  recording_id int not null references recordings on delete cascade,
  created_at  timestamptz not null default now()
);

create table exports (
  id          serial primary key,
  account_id  int not null references accounts on delete cascade,
  person_id   int references people on delete set null,
  status      text not null default 'pending',             -- pending | ready
  file_path   text,
  created_at  timestamptz not null default now()
);

-- Agents (docs/user_agents/plan.md). An app that registered itself so people can connect it (OAuth dynamic client
-- registration: Claude, ChatGPT, Cursor…). Not synced.
create table oauth_clients (
  id            text primary key,
  name          text not null,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

-- An app or agent that works as this person. Made by approving an app, or by hand on /my/agents (client_id null).
create table connected_apps (
  id          serial primary key,
  person_id   int not null references people on delete cascade,
  name        text not null,
  client_id   text references oauth_clients on delete cascade,
  scope       text not null default 'full',                -- full | read
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);

-- What an app gets back once someone approves it: spent once, within 10 minutes, with the PKCE verifier. Not synced.
create table oauth_codes (
  code_hash    text primary key,
  client_id    text not null references oauth_clients on delete cascade,
  person_id    int not null references people on delete cascade,
  scope        text not null,
  redirect_uri text not null,
  challenge    text not null,
  created_at   timestamptz not null default now()
);

-- A connection's keys, as sha256s: access (an hour; no expiry for keys made by hand) and refresh (swapped on use).
-- Not synced. Disconnecting deletes the connection and these with it.
create table agent_tokens (
  token_hash  text primary key,
  app_id      int not null references connected_apps on delete cascade,
  kind        text not null,                               -- access | refresh
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table support_requests (
  id          serial primary key,
  person_id   int references people on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Outside the app: every email we'd send lands here. /inbox shows them.
create table emails (
  id          serial primary key,
  to_email    text not null,
  subject     text not null,
  body        text not null,
  kind        text not null,   -- notification invite checkin signin reset receipt export
  link        text,            -- the main call to action
  reply_to_recording_id int references recordings on delete set null,  -- replying to this email comments/answers here
  reply_person_id int references people on delete set null,
  created_at  timestamptz not null default now()
);

-- Sign-in. One login per email address, shared by every account that address is in. Not synced: never leaves the server.
create table logins (
  email         text primary key,                          -- lower-cased
  password_hash text,                                      -- Bun.password (argon2id); null = Google only
  google_sub    text unique,                               -- Google's id for the person, set the first time they use Google
  created_at    timestamptz not null default now()
);

-- The `sid` cookie holds a random token; only its sha256 is stored. Unused for 30 days = signed out.
create table sessions (
  token_hash   text primary key,
  person_id    int not null references people on delete cascade,
  verified     boolean not null default true,              -- false while two-step verification is pending
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------- sync ----------
-- Every change to a synced table lands here (trigger below); the server streams it to browsers over WebSocket.
-- `epoch` changes on every reset, so browsers holding an older copy start over.
create table sync_meta (epoch text not null, pruned_to bigint not null default 0);
insert into sync_meta (epoch) values (md5(random()::text));

create table sync_log (
  id          bigserial primary key,
  tbl         text not null,
  op          text not null,   -- upsert | delete
  row         jsonb not null,
  created_at  timestamptz not null default now()
);

-- The advisory lock makes writers take ids in commit order, so a reader never skips a row that commits late.
-- ponytail: one global lock serializes writes; per-account locks if write throughput ever matters.
create function log_sync() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(7262);
  if tg_op = 'DELETE' then
    insert into sync_log (tbl, op, row) values (tg_table_name, 'delete', to_jsonb(old));
  else
    insert into sync_log (tbl, op, row) values (tg_table_name, 'upsert', to_jsonb(new));
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','companies','people','projects','project_people','pins','recordings','subscriptions',
    'boosts','bookmarks','bubble_ups','notifications','events','categories','markers',
    'chatbots','webhooks','public_links','exports','connected_apps'] loop
    execute format('create trigger sync after insert or update or delete on %I for each row execute function log_sync()', t);
  end loop;
end $$;
