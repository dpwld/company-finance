CREATE TABLE `finance_records` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`dedupe` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_record_identity` ON `finance_records` (`owner`,`kind`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_record_dedupe` ON `finance_records` (`owner`,`kind`,`dedupe`);