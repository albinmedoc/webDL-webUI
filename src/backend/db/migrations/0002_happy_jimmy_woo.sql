CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`resolution` integer,
	`all_episodes` integer DEFAULT false NOT NULL,
	`auto_post_usenet` integer DEFAULT false NOT NULL,
	`output` text,
	`error` text,
	`output_dir` text,
	`files` text,
	`logs` text,
	`start_time` integer,
	`end_time` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
