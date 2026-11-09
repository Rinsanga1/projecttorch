import { Redacted } from "effect"
import { PgClient } from "@effect/sql-pg"

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/projecttorch_dev"
export const DbLive = PgClient.layer({ url: Redacted.make(DATABASE_URL) })
