CREATE TABLE "ci_installation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_version" text,
	"config_hash" text,
	"outcome" text NOT NULL,
	"pr_url" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "branch" text DEFAULT 'devdigest/ci' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_state" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_state_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "config_hash" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text DEFAULT 'github_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb DEFAULT '["opened","synchronize"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "run_attempt" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "blockers" integer;--> statement-breakpoint
ALTER TABLE "ci_installation_events" ADD CONSTRAINT "ci_installation_events_installation_id_ci_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."ci_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ci_installation_events_installation_at_idx" ON "ci_installation_events" USING btree ("installation_id","at");--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_target_uidx" ON "ci_installations" USING btree ("agent_id","repo","target_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_inst_run_attempt_uidx" ON "ci_runs" USING btree ("ci_installation_id","github_run_id","run_attempt");--> statement-breakpoint
CREATE INDEX "ci_runs_inst_ran_at_idx" ON "ci_runs" USING btree ("ci_installation_id","ran_at");