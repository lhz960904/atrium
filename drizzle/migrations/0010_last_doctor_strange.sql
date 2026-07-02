CREATE TABLE `scheduled_task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`message_id` text,
	`status` text NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scheduled_task_runs_task_idx` ON `scheduled_task_runs` (`task_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`thread_id` text,
	`kind` text NOT NULL,
	`cron_expr` text,
	`run_at` integer,
	`timezone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`project_id` text,
	`provider_id` text,
	`model_id` text,
	`permission_mode` text DEFAULT 'full-access' NOT NULL,
	`catch_up_policy` text DEFAULT 'fire_once' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
