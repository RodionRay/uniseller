CREATE TABLE IF NOT EXISTS `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`telegram` text,
	`company` text,
	`task` text,
	`message` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`workspace_owner_id` text NOT NULL,
	`role` text NOT NULL,
	`access` text NOT NULL,
	`expires_at` text NOT NULL,
	`created` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_ws_invites_token` ON `workspace_invites` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ws_invites_owner` ON `workspace_invites` (`workspace_owner_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`access` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_ws_members_owner_user` ON `workspace_members` (`workspace_owner_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ws_members_user` ON `workspace_members` (`user_id`);