ALTER TABLE `usenet_jobs` ADD `media_paths` text;--> statement-breakpoint
ALTER TABLE `usenet_jobs` ADD `release_type` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE `usenet_jobs` ADD `episode_count` integer;