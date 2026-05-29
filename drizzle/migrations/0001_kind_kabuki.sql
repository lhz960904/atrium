CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text,
	`credentials_encrypted` blob,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
