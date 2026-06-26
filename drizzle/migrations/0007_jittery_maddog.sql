CREATE TABLE `usage` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`message_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`kind` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_created_at_idx` ON `usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `usage_thread_idx` ON `usage` (`thread_id`);--> statement-breakpoint
CREATE INDEX `usage_model_idx` ON `usage` (`model_id`);