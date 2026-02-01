# DAT Group SilverDAT Automation & n8n Integration

Automated form filling and PDF generation for the SilverDAT myClaim portal.

## 🚀 n8n Integration (Option 1: Execute Command)

To trigger this script from **n8n** using the "Execute Command" method (best if n8n is on the same machine):

1.  **n8n Node:** Add a **Webhook** node (Trigger).
2.  **n8n Node:** Add a **Wait** node (Set to 15 seconds as requested).
3.  **n8n Node:** Add an **Execute Command** node.
    -   **Command:** `cd /absolute/path/to/dat-automation && node dat_automation.js`
4.  **Finish:** Whenever the webhook is hit, n8n will wait 15 seconds and then run the script.

## 🌐 Webhook Mode (Option 2: API Wrapper)

If you want the script to run as a background service that n8n can "ping" via HTTP:

1.  **Start the server:**
    ```powershell
    npm run server
    ```
2.  **n8n Node:** Use the **HTTP Request** node.
    -   **Method:** `POST`
    -   **URL:** `http://localhost:3000/webhook/trigger`
3.  **Benefit:** The server stays open, and n8n just "wakes it up" whenever needed.

---

## 🛠 Setup

1.  **Environment Variables:** Create a `.env` file with:
    ```env
    DAT_CUSTOMER_NUMBER=your_number
    DAT_USER_LOGIN=your_login
    DAT_PASSWORD=your_password
    SUPABASE_URL=your_url
    SUPABASE_KEY=your_key
    ```
2.  **Install dependencies:**
    ```powershell
    npm install
    ```

## 📂 Project Structure

- `dat_automation.js`: Core Playwright logic. Processes pending valuations from Supabase.
- `webhook_server.js`: Express wrapper to listen for n8n requests.
- `supabase.js`: Supabase client configuration.

## 🗒 Features
- ✅ **Continuous Loop Mode:** Run `node dat_automation.js` directly.
- ✅ **Webhook Trigger:** Run `npm run server` and trigger via HTTP.
- ✅ **Photo Uploads:** Automatically downloads and uploads up to 10 photos per record.
- ✅ **Automatic Feedback:** Updates Supabase with "Success" or "Failed" status.
