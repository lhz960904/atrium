CREATE TABLE `subagents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`system_prompt` text NOT NULL,
	`tool_allow` text,
	`tool_deny` text,
	`provider_id` text,
	`model_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subagents_name_unique` ON `subagents` (`name`);