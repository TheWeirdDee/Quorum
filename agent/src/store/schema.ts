import type { Knex } from "knex";

/** Cross-dialect bootstrap migration for SQLite (local/tests) and PostgreSQL (Neon). */
export async function migrate(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable("repos"))) {
    await db.schema.createTable("repos", (table) => {
      table.increments("id").primary();
      table.text("github_url").notNullable().unique();
      table.text("risk_policy").notNullable();
      table.double("budget_cap_usdc").nullable();
      table.text("notify_type").nullable();
      table.text("notify_webhook").nullable();
      table.text("created_at").notNullable();
    });
  }

  if (!(await db.schema.hasTable("dependencies"))) {
    await db.schema.createTable("dependencies", (table) => {
      table.increments("id").primary();
      table.integer("repo_id").notNullable().references("id").inTable("repos");
      table.text("name").notNullable();
      table.text("version").nullable();
      table.text("ecosystem").notNullable().defaultTo("npm");
      table.integer("is_production").notNullable().defaultTo(1);
      table.text("github_repo_url").nullable();
      table.text("maintainers_json").nullable();
      table.integer("is_archived").nullable();
      table.text("license").nullable();
      table.text("created_at").notNullable();
      table.unique(["repo_id", "name", "ecosystem"]);
    });
  }

  if (!(await db.schema.hasTable("seen_events"))) {
    await db.schema.createTable("seen_events", (table) => {
      table.increments("id").primary();
      table.integer("repo_id").nullable().references("id").inTable("repos");
      table.text("dependency").notNullable();
      table.text("type").notNullable();
      table.text("ref").notNullable();
      table.text("severity_hint").notNullable();
      table.text("source").notNullable();
      table.text("observed_at").notNullable();
      table.text("context_json").nullable();
      table.text("first_seen_at").notNullable();
      table.unique(["dependency", "type", "ref"]);
    });
  }

  if (!(await db.schema.hasTable("decisions"))) {
    await db.schema.createTable("decisions", (table) => {
      table.increments("id").primary();
      table.integer("event_id").nullable().references("id").inTable("seen_events");
      table.text("payload_json").notNullable();
      table.text("decision").notNullable();
      table.double("confidence").notNullable();
      table.double("total_spend_usdc").notNullable();
      table.text("decided_at").notNullable();
    });
  }

  if (!(await db.schema.hasTable("orders"))) {
    await db.schema.createTable("orders", (table) => {
      table.increments("id").primary();
      table.text("direction").notNullable();
      table.text("order_id").notNullable().unique();
      table.text("negotiation_id").nullable();
      table.text("counterparty").nullable();
      table.integer("decision_id").nullable().references("id").inTable("decisions");
      table.text("status").notNullable().defaultTo("pending");
      table.double("cost_usdc").nullable();
      table.text("tx").nullable();
      table.text("requirements_json").nullable();
      table.text("created_at").notNullable();
    });
  }
}
