CREATE TABLE IF NOT EXISTS `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`secret` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_records_owner_kind` ON `records` (`owner`,`kind`);