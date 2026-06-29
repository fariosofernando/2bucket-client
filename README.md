# 2bucket-client

The official resilient TypeScript client SDK for **2Bucket**. Built natively with Bun, this client implements a robust **Store and Forward** architecture to ensure your microservices never lose an upload, even if your central 2Bucket server goes offline.

## Resilience Architecture (Store & Forward)

When your application triggers an upload, `2bucket-client` performs the following flow:

1. **Direct Upload:** It quickly checks the health of the 2Bucket server. If online, the file is pushed directly.
2. **Volatile Local Fallback:** If the network fails or the server returns a `5xx` error, the client gracefully intercepts the failure. It writes the binary file and its metadata to a persistent, locally mounted cache directory.
3. **Background Daemon Sync:** A reliable interval daemon runs in the background. As soon as the central 2Bucket server recovers health, all queued local files are automatically synchronized sequentially, and wiped securely from the local disk.

---

## Installation

Since this is an internal/open-source package hosted on GitHub, you can install it directly via **Bun** into your microservices.

**Public Repository:**
```bash
bun add github:fariosofernando/2bucket-client

```

**Private Repository (via SSH):**

```bash
bun add git+ssh://git@github.com/fariosofernando/2bucket-client.git

```

or

```bash
bun add github:fariosofernando/2bucket-client
```

---

## Usage Example

Initialize the client inside your microservice controller or configuration file.

### 1. Configuration in Microservices (e.g., Docker Bind Mounts)

Ensure your microservice maps a persistent cache directory (like `.cache`) so that queued uploads survive container restarts.

```typescript
import { TwoBucketClient } from "2bucket-client";
import path from "path";

const queueDirectory = path.join("/app/.cache", "2bucket-queue");

const bucketClient = new TwoBucketClient({
  serverUrl: "[https://your-2bucket-server.com/v1/api/2bucket](https://your-2bucket-server.com/v1/api/2bucket)",
  token: process.env.BUCKET_TOKEN,
  queueDir: queueDirectory,     // Safe, persistent volume directory
  syncIntervalMs: 30000         // Check server health and retry every 30s
});

```

### 2. Performing an Upload inside an Express Controller

Integrating with `express-fileupload` (ensure `useTempFiles: true` is enabled):

```typescript
import { Request, Response } from "express";
import { UploadedFile } from "express-fileupload";

public async uploadDocument(req: Request, res: Response) {
  const documentFile = req.files?.document as UploadedFile;
  const companyId = req.company_id;

  const folder = `companies/${companyId}/documents`;
  const rename = `contract_signed.pdf`;

  // Use the native temp file path from your form-upload middleware
  await bucketClient.upload({
    bucket_id: process.env.BUCKET_ID,
    filePath: documentFile.tempFilePath,
    folder,
    rename,
  });

  // Calculate the deterministic response URL immediately
  const relativePath = `${folder}/${rename}`;
  const finalUrl = `${process.env.TWOBUCKET_SERVER}/v1/api/2bucket/file/${process.env.BUCKET_ID}?path=${relativePath}`;

  return res.status(200).json({
    message: "Upload accepted successfully!",
    data: { url: finalUrl }
  });
}

```

---

## ⚙️ Client Options

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `serverUrl` | `string` | *Required* | Complete endpoint base URL of your 2Bucket API gateway. |
| `token` | `string` | *Required* | Bearer Authorization Token accepted by the server. |
| `queueDir` | `string` | `"./.2bucket-queue"` | Local storage path to write payload assets when server is offline. |
| `syncIntervalMs` | `number` | `30000` | Frequency in milliseconds to check the remote endpoint health status. |
