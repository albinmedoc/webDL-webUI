CREATE TABLE `usenet_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`download_id` text,
	`media_path` text NOT NULL,
	`media_size_bytes` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`failure_state` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`rar_password` text NOT NULL,
	`nzb_path` text,
	`error` text,
	`indexer_response` text,
	`category` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
