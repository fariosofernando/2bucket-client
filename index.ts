import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";
import path from "path";

interface ClientConfig {
	server_url: string; // http://xxx.xxx.x.xxx:xxxx/v1/api/2bucket
	token: string;
	queue_dir?: string; // dir volatil (default: ./.2bucket-queue)
	sync_interval_ms?: number;
}

interface UploadData {
	bucket_id: string;
	file_path: string;
	folder?: string;
	rename?: string;
}

export class TwoBucketClient {
	private config: Required<ClientConfig>;
	private is_syncing = false;

	constructor(config: ClientConfig) {
		this.config = {
			queue_dir: "./.2bucket-queue",
			sync_interval_ms: 30000,
			...config,
		};

		if (!existsSync(this.config.queue_dir)) {
			mkdirSync(this.config.queue_dir, { recursive: true });
		}

		setInterval(() => this.process_queue(), this.config.sync_interval_ms);
	}

	public async upload(data: UploadData): Promise<void> {
		const is_online = await this.check_health();

		if (is_online) {
			try {
				await this.send_to_server(data);

				await this.cleanup_original_file(data.file_path);
				return;
			} catch (error) {
				console.warn(
					"[2Bucket-Client] Erro no upload direto, enviando para fila local.",
					error,
				);
			}
		}

		await this.enqueue_upload(data);
		await this.cleanup_original_file(data.file_path);
	}

	private async send_to_server(data: UploadData): Promise<void> {
		const form_data = new FormData();
		form_data.append("bucket_id", data.bucket_id);
		if (data.folder) form_data.append("folder", data.folder);
		if (data.rename) form_data.append("rename", data.rename);

		const file_buffer = await fs.readFile(data.file_path);
		const file_name = path.basename(data.file_path);
		const blob = new Blob([file_buffer]);
		form_data.append("file", blob, file_name);

		const response = await fetch(`${this.config.server_url}/file/upload`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.config.token}`,
			},
			body: form_data,
		});

		if (!response.ok) {
			throw new Error(`Server status: ${response.status}`);
		}
	}

	private async enqueue_upload(data: UploadData): Promise<void> {
		const job_id = crypto.randomUUID();
		const queued_file_path = path.join(this.config.queue_dir, `${job_id}.bin`);
		const queued_meta_path = path.join(this.config.queue_dir, `${job_id}.json`);

		await fs.copyFile(data.file_path, queued_file_path);

		const meta = { ...data, filePath: queued_file_path };
		await fs.writeFile(queued_meta_path, JSON.stringify(meta));

		console.info(`[2Bucket-Client] Arquivo enfileirado localmente: ${job_id}`);
	}

	private async process_queue(): Promise<void> {
		if (this.is_syncing) return;

		const is_online = await this.check_health();
		if (!is_online) return;

		this.is_syncing = true;
		try {
			const files = await fs.readdir(this.config.queue_dir);
			const meta_files = files.filter((f) => f.endsWith(".json"));

			for (const meta_file of meta_files) {
				const meta_path = path.join(this.config.queue_dir, meta_file);
				const job_id = meta_file.replace(".json", "");
				const bin_path = path.join(this.config.queue_dir, `${job_id}.bin`);

				try {
					const meta_content = await fs.readFile(meta_path, "utf-8");
					const data: UploadData = JSON.parse(meta_content);

					console.info(`[2Bucket-Client] Sincronizando arquivo pendente...`);
					await this.send_to_server(data);

					await fs.unlink(meta_path);
					await fs.unlink(bin_path);
					console.info(
						`[2Bucket-Client] Arquivo ${job_id} sincronizado e removido localmente.`,
					);
				} catch (err) {
					console.error(
						`[2Bucket-Client] Falha ao sincronizar item da fila ${job_id}`,
						err,
					);
				}
			}
		} finally {
			this.is_syncing = false;
		}
	}

	private async check_health(): Promise<boolean> {
		try {
			const base_url = this.config.server_url.split("/v1")[0];
			const res = await fetch(`${base_url}/health`);
			return res.status === 200;
		} catch {
			return false;
		}
	}

	private async cleanup_original_file(file_path: string): Promise<void> {
		try {
			if (existsSync(file_path)) {
				await fs.unlink(file_path);
			}
		} catch (err) {
			console.error(
				`[2Bucket-Client] Erro ao limpar arquivo temporário: ${file_path}`,
				err,
			);
		}
	}
}
