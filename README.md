# Five9 → Zoho CRM Sync Service

A Node.js service that automatically syncs call log data from **Five9** (cloud contact center) into **Zoho CRM** as leads. The service polls Five9 via SOAP API on a scheduled interval, extracts caller information from reports, deduplicates against existing Zoho leads, and creates new CRM records — all with persistent checkpointing so no calls are missed across restarts.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [AWS Deployment](#aws-deployment)
  - [Option A — EC2 (Recommended)](#option-a--ec2-recommended)
  - [Option B — Elastic Beanstalk](#option-b--elastic-beanstalk)
  - [Option C — AWS App Runner](#option-c--aws-app-runner)
- [API Endpoints](#api-endpoints)
- [Sync State & Checkpointing](#sync-state--checkpointing)
- [Integration Details](#integration-details)
  - [Five9 SOAP API](#five9-soap-api)
  - [Zoho CRM OAuth 2.0](#zoho-crm-oauth-20)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────┐        SOAP / WSDL        ┌──────────────────────┐
│                 │ ────────────────────────▶  │                      │
│   Five9 Cloud   │   runReport (every 2 min)  │   Node.js Service    │
│  Contact Center │ ◀────────────────────────  │   (Express + SOAP)   │
│                 │      CSV Report Data        │                      │
└─────────────────┘                            └──────────┬───────────┘
                                                          │
                                               REST API / OAuth 2.0
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │                      │
                                               │      Zoho CRM        │
                                               │   (Leads Module)     │
                                               │                      │
                                               └──────────────────────┘
```

**Flow:**
1. Every **2 minutes**, the service polls Five9 for new call logs since `lastSyncTime`
2. Five9 generates a CSV report for the time window
3. The service parses each row, extracts email / name / phone / language
4. For each record, it checks whether the lead already exists in Zoho (dedup by email)
5. New leads are created in Zoho CRM with workflow triggers enabled
6. `sync-state.json` is updated with the new checkpoint timestamp

---

## How It Works

### Polling Loop (`server.js`)

```
Startup
  └─▶ loadSyncState()          ← reads lastSyncTime from sync-state.json
  └─▶ setInterval(2 min)
        └─▶ fetchFive9Report()
              ├─▶ createSoapClient(AdminWebService.wsdl)
              ├─▶ runReportAsync({ folderName, reportName, criteria.time })
              ├─▶ poll isReportRunningAsync() until complete
              ├─▶ wait 10s (Five9 report generation buffer)
              ├─▶ getReportResultCsvAsync() → CSV string
              ├─▶ parse CSV rows
              └─▶ for each valid row:
                    ├─▶ leadExistsInZoho(email)   ← GET /crm/v2/Leads/search
                    └─▶ sendLeadToZoho(...)        ← POST /crm/v2/Leads
        └─▶ saveSyncState()    ← update lastSyncTime to end of this window
```

### Webhook Endpoint (`POST /lead`)

A secondary REST endpoint that allows external systems (e.g. Zoho Flow, Zapier, custom apps) to push a lead directly into Zoho CRM without going through Five9.

### CSV Bulk Import (`process.js`)

A one-shot script for bulk importing historical call data from a CSV file (`input.csv`) into Zoho CRM. Run manually when you need to backfill records.

---

## Project Structure

```
five9-zoho-sync/
├── server.js            # Main service: polling loop + Express API
├── process.js           # One-shot bulk CSV import script
├── sync-state.json      # Persistent checkpoint (last synced timestamp)
├── AdminWebService.wsdl # Five9 SOAP WSDL definition (not in repo — download separately)
├── package.json         # NPM dependencies
├── package-lock.json    # Locked dependency versions
├── .env                 # Local secrets (never committed)
├── .env.example         # Template for required environment variables
└── .gitignore
```

> **Note:** `AdminWebService.wsdl` is required at runtime but excluded from the repo due to its size (~962 KB). Download it from Five9's developer portal or your Five9 admin account and place it in the project root.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|---|---|---|
| `REFRESH_TOKEN` | Zoho OAuth 2.0 refresh token | `1000.abc...` |
| `CLIENT_ID` | Zoho API client ID | `1000.XYZ...` |
| `CLIENT_SECRET` | Zoho API client secret | `abc123...` |
| `API_DOMAIN` | Zoho API base URL (region-specific) | `https://www.zohoapis.com` |
| `LANGUAGE_FIELD` | Zoho CRM API name for the Language field | `Language` |
| `FIVE9_USERNAME` | Five9 admin/API username | `api.integration2` |
| `FIVE9_PASSWORD` | Five9 password | `yourpassword` |
| `FIVE9_REPORT_NAME` | Exact report name in Five9 | `Call Log - Zoho(Do not use)` |
| `FIVE9_FOLDER_NAME` | Five9 report folder | `Shared Reports` |
| `PORT` | (Optional) HTTP port, defaults to `8080` | `8080` |

### Getting Zoho OAuth Credentials

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a **Server-based Application**
3. Add scopes: `ZohoCRM.modules.leads.ALL`
4. Generate a **Self Client** grant code, exchange it for a refresh token:

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "code=YOUR_GRANT_CODE" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=https://www.zohoapis.com" \
  -d "grant_type=authorization_code"
```

The `refresh_token` in the response is what you put in `.env`.

---

## Local Development

### Prerequisites

- Node.js v18+
- `AdminWebService.wsdl` in the project root

### Install & Run

```bash
# Install dependencies
npm install

# Start the service
npm start
```

The server starts on port `8080` by default. You'll see output like:

```
✅ Loaded checkpoint: 2026-06-10T20:41:00.000Z
🚀 API running on port 8080
🔄 Fetching Five9...
🔐 Using Five9 user: api.integration2
⏱️ Fetch Window:
START: 2026-06-10T20:41:00.000Z
END:   2026-06-10T20:43:00.000Z
...
```

### Bulk CSV Import (One-Time)

If you need to backfill historical data from a CSV export:

```bash
# Place your CSV file as input.csv in the project root
node process.js
```

The CSV must have columns: `email`, `CUSTOMER NAME`, `Language`.

---

## AWS Deployment

The service is designed to run as a **long-running Node.js process** on AWS. It binds to `0.0.0.0:8080` and is production-ready for EC2, Elastic Beanstalk, or App Runner.

---

### Option A — EC2 (Recommended)

Best for full control, persistent `sync-state.json`, and lowest cost.

#### 1. Launch an EC2 Instance

- **AMI**: Amazon Linux 2023 or Ubuntu 22.04 LTS
- **Instance type**: `t3.micro` (free tier eligible, sufficient for this workload)
- **Security group**: Allow inbound TCP on port `8080` (or `80` if using a load balancer)
- **Storage**: 8 GB gp3 (default is fine)

#### 2. Connect & Set Up the Server

```bash
# SSH into instance
ssh -i your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP

# Install Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install git
sudo yum install git -y   # Amazon Linux
# or
sudo apt install git -y   # Ubuntu
```

#### 3. Clone & Configure

```bash
git clone https://github.com/Sortedsinghal/five9-zoho-sync.git
cd five9-zoho-sync

# Install dependencies
npm install

# Create your .env file
nano .env
# Paste in all your environment variables, save with Ctrl+X
```

> **Important:** You also need to upload `AdminWebService.wsdl` to the server since it's excluded from the repo:
>
> ```bash
> # From your local machine:
> scp -i your-key.pem AdminWebService.wsdl ec2-user@YOUR_EC2_PUBLIC_IP:~/five9-zoho-sync/
> ```

#### 4. Run with PM2 (Process Manager)

PM2 keeps the service running after disconnects and on server reboots:

```bash
# Install PM2 globally
npm install -g pm2

# Start the service
pm2 start server.js --name five9-zoho-sync

# Save process list (so it restarts on reboot)
pm2 save

# Enable PM2 startup on boot
pm2 startup
# Copy and run the command it outputs

# Check status
pm2 status
pm2 logs five9-zoho-sync
```

#### 5. (Optional) Set Up Nginx Reverse Proxy

If you want to serve on port 80/443:

```bash
sudo yum install nginx -y
sudo nano /etc/nginx/conf.d/five9sync.conf
```

Paste:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo systemctl start nginx
sudo systemctl enable nginx
```

#### 6. Updating the Service

```bash
# Pull latest code without losing sync state
cd ~/five9-zoho-sync
git pull origin main
pm2 restart five9-zoho-sync
```

---

### Option B — Elastic Beanstalk

Best if you want AWS to manage the environment, scaling, and health checks automatically.

#### 1. Install EB CLI

```bash
pip install awsebcli
```

#### 2. Create a `Procfile`

Create a `Procfile` in the project root:

```
web: node server.js
```

#### 3. Create `.ebextensions/nodecommand.config`

```yaml
option_settings:
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: "node server.js"
    NodeVersion: 20
```

#### 4. Initialize & Deploy

```bash
eb init five9-zoho-sync --platform node.js --region us-east-1
eb create five9-zoho-sync-env
```

#### 5. Set Environment Variables

In the AWS Console → Elastic Beanstalk → Your Environment → Configuration → Software → Environment properties, add all variables from `.env.example`.

Or via CLI:
```bash
eb setenv REFRESH_TOKEN=xxx CLIENT_ID=xxx CLIENT_SECRET=xxx \
  FIVE9_USERNAME=xxx FIVE9_PASSWORD=xxx \
  FIVE9_REPORT_NAME=xxx FIVE9_FOLDER_NAME=xxx
```

#### 6. Upload WSDL

Since `AdminWebService.wsdl` is not in the repo, include it in your deployment zip or use `.ebextensions` to download it from S3 on startup.

> **Note:** Elastic Beanstalk instances can be recycled, which means `sync-state.json` will reset. Consider storing checkpoint state in **DynamoDB** or **S3** for production EB deployments.

---

### Option C — AWS App Runner

Best for fully managed, auto-scaling, zero-infrastructure deployments directly from GitHub.

#### 1. In AWS Console:

- Go to **App Runner** → **Create service**
- Source: **GitHub repository** → connect your GitHub account → select `Sortedsinghal/five9-zoho-sync`
- Branch: `main`
- Build command: `npm install`
- Start command: `node server.js`
- Port: `8080`
- Instance size: 0.25 vCPU / 0.5 GB (sufficient)

#### 2. Set Environment Variables

In the App Runner configuration panel, add all variables from `.env.example`.

> **Note:** App Runner containers are stateless. `sync-state.json` will reset on each deployment. Use **AWS Parameter Store** or **S3** to persist checkpoint state in production.

---

## API Endpoints

### `POST /lead`

Manually push a single lead into Zoho CRM (webhook endpoint).

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "name": "John Doe",
  "language": "Spanish"
}
```

**Response:**
```json
{ "success": true }
```

**Error Response:**
```json
{ "error": "Email required" }
```

**Example:**
```bash
curl -X POST http://YOUR_SERVER:8080/lead \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","language":"English"}'
```

---

## Sync State & Checkpointing

The service persists its last successful sync time in `sync-state.json`:

```json
{
  "lastSyncTime": "2026-06-10T20:41:00.000Z"
}
```

- On **startup**, the service reads this file and resumes from where it left off
- After each successful poll, it updates this timestamp to the end of the fetched window
- If the file doesn't exist, the service defaults to syncing the last **5 minutes**
- On **EC2/local**, this file is written to disk automatically
- On **stateless platforms** (App Runner, Lambda), you should externalize this to S3 or DynamoDB

### Manual Reset

To re-sync from a specific time:

```bash
echo '{"lastSyncTime":"2026-07-01T00:00:00.000Z"}' > sync-state.json
pm2 restart five9-zoho-sync
```

---

## Integration Details

### Five9 SOAP API

The service connects to Five9's AdminWebService via SOAP using the `soap` npm package.

- **WSDL:** `AdminWebService.wsdl` (local file, must be in project root)
- **Auth:** HTTP Basic Authentication (`FIVE9_USERNAME` / `FIVE9_PASSWORD`)
- **Endpoint:** `https://api.five9.com/wsadmin/v2/AdminWebService`

**Report Flow:**

| Step | SOAP Method | Description |
|------|------------|-------------|
| 1 | `runReportAsync` | Starts the report for a time window, returns an `identifier` |
| 2 | `isReportRunningAsync` | Polls until report is ready |
| 3 | `getReportResultCsvAsync` | Downloads the CSV result |

**CSV Fields Used:**

| CSV Column | Zoho Field |
|------------|-----------|
| `email` | `Email` |
| `first_name` | `First_Name` |
| `last_name` | `Last_Name` |
| `number1` | `Mobile` |
| `Language` | Custom language field |

**Retry Logic:** The `runReport` call retries up to **3 times** with 5-second delays on failure.

---

### Zoho CRM OAuth 2.0

The service uses the **Refresh Token flow** — no user interaction needed at runtime.

- **Token URL:** `https://accounts.zoho.com/oauth/v2/token`
- **Token Lifetime:** 1 hour (Zoho default)
- **Auto-refresh:** Token is refreshed automatically when it is older than 50 minutes
- **Duplicate Check:** Before creating a lead, the service queries `GET /crm/v2/Leads/search?email=...` to avoid duplicates
- **Workflow Trigger:** `trigger: ["workflow"]` is set so Zoho automation rules fire on lead creation

**Fields Written to Zoho:**

| Zoho API Field | Value |
|---------------|-------|
| `First_Name` | From Five9 `first_name` |
| `Last_Name` | From Five9 `last_name` |
| `Customer_Name` | Full name concatenated |
| `Email` | From Five9 `email` |
| `Mobile` | From Five9 `number1` |
| `Language` | Normalized: `"English"` or `"Spanish"` |

---

## Troubleshooting

### Token Error on startup
- Verify `REFRESH_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` are correct in `.env`
- Ensure the Zoho OAuth app has the `ZohoCRM.modules.leads.ALL` scope
- Refresh tokens can expire if unused for 60+ days — regenerate via the API Console

### No report identifier returned from Five9
- Check that `FIVE9_REPORT_NAME` exactly matches the report name in Five9 (case-sensitive)
- Ensure `FIVE9_FOLDER_NAME` is correct
- Verify the Five9 API user has permission to run the report

### WSDL / SOAP connection errors
- Ensure `AdminWebService.wsdl` exists in the project root
- Check Five9 API credentials are valid and the account is not locked

### Duplicate leads appearing in Zoho
- The dedup check uses `email` as the key — ensure email values in Five9 reports are clean
- Check the Zoho duplicate rule is not bypassed by the `trigger: ["workflow"]` setting

### sync-state.json reset after deployment
- On EC2 with PM2: this should not happen — the file persists between `git pull` + restarts
- On App Runner / Elastic Beanstalk: store state externally in S3 or DynamoDB

### Viewing Logs on EC2

```bash
pm2 logs five9-zoho-sync             # tail live logs
pm2 logs five9-zoho-sync --lines 200 # last 200 lines
```
